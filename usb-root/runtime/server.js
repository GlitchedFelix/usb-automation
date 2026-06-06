'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const { loadPlugins, reloadPlugins, getPlugins } = require('./plugin-loader');
const { runAgent } = require('./agent');

const CONFIG_PATH = path.join(__dirname, '..', 'bridge', 'config.json');
const DB_DIR = path.join(__dirname, '..', 'bridge', 'logs');
const DB_PATH = path.join(DB_DIR, 'tasks.db');
const PLUGINS_DIR = path.join(__dirname, 'plugins');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// Ensure log directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Initialize SQLite
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT    PRIMARY KEY,
    prompt      TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'running',
    result      TEXT,
    model       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    thought     TEXT,
    action      TEXT,
    params      TEXT,
    observation TEXT,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE INDEX IF NOT EXISTS idx_steps_task_id ON steps(task_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_created  ON tasks(created_at DESC);
`);

// Prepared statements (reused for performance)
const insertTask = db.prepare(
  'INSERT INTO tasks (id, prompt, status, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const insertStep = db.prepare(
  'INSERT INTO steps (task_id, type, thought, action, params, observation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const updateTaskStatus = db.prepare(
  'UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?'
);
const touchTask = db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?');
const getTask = db.prepare('SELECT * FROM tasks WHERE id = ?');
const getTaskSteps = db.prepare('SELECT * FROM steps WHERE task_id = ? ORDER BY id ASC');
const getNewSteps = db.prepare('SELECT * FROM steps WHERE task_id = ? AND id > ? ORDER BY id ASC');
const getRecentTasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 20');

function cleanupOldTasks() {
  const config = loadConfig();
  const retentionDays = config.runtime.log_retention_days || 7;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const oldTasks = db.prepare('SELECT id FROM tasks WHERE created_at < ?').all(cutoff);
  if (oldTasks.length === 0) return;

  const ids = oldTasks.map((t) => t.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM steps WHERE task_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...ids);
  console.log(`[Runtime] Cleaned up ${oldTasks.length} expired task(s)`);
}

// --- Express app ---
const app = express();
app.use(express.json({ limit: '10mb' }));

// POST /task
app.post('/task', (req, res) => {
  const config = loadConfig();
  const { prompt, model, max_iterations } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const id = uuidv4();
  const now = Date.now();
  const selectedModel = model || config.llm.model;
  const maxIterations = parseInt(max_iterations, 10) || config.llm.max_iterations || 10;

  insertTask.run(id, prompt.trim(), 'running', selectedModel, now, now);
  res.json({ id });

  // Run agent asynchronously (non-blocking)
  setImmediate(() => {
    runAgent({
      id,
      prompt: prompt.trim(),
      llmUrl: config.llm.url,
      llmMode: config.llm.mode || 'ollama',
      model: selectedModel,
      maxIterations,
      config,
      onStep(step) {
        insertStep.run(
          id,
          step.type || 'step',
          step.thought || null,
          step.action || null,
          step.params != null ? JSON.stringify(step.params) : null,
          step.observation || null,
          Date.now()
        );
        touchTask.run(Date.now(), id);
      },
      onFinish(result) {
        updateTaskStatus.run('done', result, Date.now(), id);
        console.log(`[Runtime] Task ${id} finished`);
      },
      onError(err) {
        updateTaskStatus.run('error', err.message || String(err), Date.now(), id);
        console.error(`[Runtime] Task ${id} error:`, err.message);
      },
    }).catch((err) => {
      updateTaskStatus.run('error', err.message || String(err), Date.now(), id);
      console.error(`[Runtime] Task ${id} uncaught:`, err.message);
    });
  });
});

// GET /task/:id/stream — Server-Sent Events
app.get('/task/:id/stream', (req, res) => {
  const { id } = req.params;
  const task = getTask.get(id);

  if (!task) {
    res.status(404).end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let lastStepId = 0;
  let closed = false;

  req.on('close', () => {
    closed = true;
    clearInterval(pollInterval);
  });

  function send(event, data) {
    if (!closed) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }

  const pollInterval = setInterval(() => {
    if (closed) return;

    const current = getTask.get(id);
    if (!current) {
      send('error', { error: 'Task not found' });
      clearInterval(pollInterval);
      res.end();
      return;
    }

    const newSteps = getNewSteps.all(id, lastStepId);
    for (const step of newSteps) {
      lastStepId = step.id;
      send('step', {
        type: step.type,
        thought: step.thought,
        action: step.action,
        params: step.params ? JSON.parse(step.params) : null,
        observation: step.observation,
      });
    }

    if (current.status === 'done' || current.status === 'error') {
      send('end', { status: current.status, result: current.result });
      clearInterval(pollInterval);
      if (!closed) res.end();
    }
  }, 300);
});

// GET /task/:id — full task with steps
app.get('/task/:id', (req, res) => {
  const { id } = req.params;
  const task = getTask.get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const steps = getTaskSteps.all(id).map((s) => ({
    ...s,
    params: s.params ? JSON.parse(s.params) : null,
  }));

  res.json({ ...task, steps });
});

// GET /plugins
app.get('/plugins', (req, res) => {
  const plugins = getPlugins().map((p) => ({
    name: p.name,
    description: p.description,
    parameters: p.parameters,
  }));
  res.json(plugins);
});

// POST /plugins/reload
app.post('/plugins/reload', (req, res) => {
  reloadPlugins(PLUGINS_DIR);
  res.json({ ok: true, count: getPlugins().length });
});

// GET /logs — recent tasks
app.get('/logs', (req, res) => {
  res.json(getRecentTasks.all());
});

// GET /ping
app.get('/ping', (req, res) => {
  res.json({ ok: true });
});

// Startup
loadPlugins(PLUGINS_DIR);
cleanupOldTasks();

const config = loadConfig();
const RUNTIME_PORT = config.runtime.port || 3001;

app.listen(RUNTIME_PORT, () => {
  console.log(`[Runtime] Running on http://localhost:${RUNTIME_PORT}`);
  console.log(`[Runtime] Plugins: ${getPlugins().length} loaded`);
  console.log(`[Runtime] Database: ${DB_PATH}`);
});
