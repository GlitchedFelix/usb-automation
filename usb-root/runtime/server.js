'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const initSqlJs = require('sql.js');
const { loadPlugins, reloadPlugins, getPlugins } = require('./plugin-loader');
const { runAgent } = require('./agent');

const CONFIG_PATH = path.join(__dirname, '..', 'bridge', 'config.json');
const DB_DIR = path.join(__dirname, '..', 'bridge', 'logs');
const DB_PATH = path.join(DB_DIR, 'tasks.db');
const PLUGINS_DIR = path.join(__dirname, 'plugins');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// ── sql.js wrapper ────────────────────────────────────────────────────────────
let db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Debounced save — batches rapid writes into one disk flush
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDb, 80);
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  scheduleSave();
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbExec(sql) {
  db.run(sql);
  scheduleSave();
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanupOldTasks() {
  const config = loadConfig();
  const retentionDays = config.runtime.log_retention_days || 7;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const old = dbAll('SELECT id FROM tasks WHERE created_at < ?', [cutoff]);
  if (old.length === 0) return;

  const placeholders = old.map(() => '?').join(',');
  const ids = old.map((t) => t.id);
  dbRun(`DELETE FROM steps WHERE task_id IN (${placeholders})`, ids);
  dbRun(`DELETE FROM tasks WHERE id IN (${placeholders})`, ids);
  console.log(`[Runtime] Cleaned up ${old.length} expired task(s)`);
}

// ── Express app ───────────────────────────────────────────────────────────────
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

  dbRun(
    'INSERT INTO tasks (id, prompt, status, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, prompt.trim(), 'running', selectedModel, now, now]
  );

  res.json({ id });

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
        dbRun(
          'INSERT INTO steps (task_id, type, thought, action, params, observation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            id,
            step.type || 'step',
            step.thought || null,
            step.action || null,
            step.params != null ? JSON.stringify(step.params) : null,
            step.observation || null,
            Date.now(),
          ]
        );
        dbRun('UPDATE tasks SET updated_at = ? WHERE id = ?', [Date.now(), id]);
      },
      onFinish(result) {
        dbRun('UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?', [
          'done', result, Date.now(), id,
        ]);
        console.log(`[Runtime] Task ${id} finished`);
      },
      onError(err) {
        dbRun('UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?', [
          'error', err.message || String(err), Date.now(), id,
        ]);
        console.error(`[Runtime] Task ${id} error:`, err.message);
      },
    }).catch((err) => {
      dbRun('UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?', [
        'error', err.message || String(err), Date.now(), id,
      ]);
    });
  });
});

// GET /task/:id/stream — SSE
app.get('/task/:id/stream', (req, res) => {
  const { id } = req.params;
  if (!dbGet('SELECT id FROM tasks WHERE id = ?', [id])) {
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

  req.on('close', () => { closed = true; clearInterval(poll); });

  function send(event, data) {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const poll = setInterval(() => {
    if (closed) return;

    const task = dbGet('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!task) {
      send('error', { error: 'Task not found' });
      clearInterval(poll);
      res.end();
      return;
    }

    const newSteps = dbAll(
      'SELECT * FROM steps WHERE task_id = ? AND id > ? ORDER BY id ASC',
      [id, lastStepId]
    );

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

    if (task.status === 'done' || task.status === 'error') {
      send('end', { status: task.status, result: task.result });
      clearInterval(poll);
      if (!closed) res.end();
    }
  }, 300);
});

// GET /task/:id
app.get('/task/:id', (req, res) => {
  const task = dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const steps = dbAll('SELECT * FROM steps WHERE task_id = ? ORDER BY id ASC', [req.params.id])
    .map((s) => ({ ...s, params: s.params ? JSON.parse(s.params) : null }));

  res.json({ ...task, steps });
});

// GET /plugins
app.get('/plugins', (req, res) => {
  res.json(getPlugins().map((p) => ({
    name: p.name,
    description: p.description,
    parameters: p.parameters,
  })));
});

// POST /plugins/reload
app.post('/plugins/reload', (req, res) => {
  reloadPlugins(PLUGINS_DIR);
  res.json({ ok: true, count: getPlugins().length });
});

// GET /logs
app.get('/logs', (req, res) => {
  res.json(dbAll('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 20'));
});

// GET /ping
app.get('/ping', (req, res) => {
  res.json({ ok: true });
});

// ── Startup ───────────────────────────────────────────────────────────────────
async function main() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('[Runtime] Loaded existing database');
  } else {
    db = new SQL.Database();
    console.log('[Runtime] Created new database');
  }

  db.run(`
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
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_steps_task ON steps(task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_time ON tasks(created_at DESC);
  `);
  saveDb();

  loadPlugins(PLUGINS_DIR);
  cleanupOldTasks();

  const config = loadConfig();
  const PORT = config.runtime.port || 3001;

  app.listen(PORT, () => {
    console.log(`[Runtime] Running on http://localhost:${PORT}`);
    console.log(`[Runtime] Plugins: ${getPlugins().length} loaded`);
    console.log(`[Runtime] Database: ${DB_PATH}`);
  });
}

main().catch((err) => {
  console.error('[Runtime] Startup failed:', err);
  process.exit(1);
});
