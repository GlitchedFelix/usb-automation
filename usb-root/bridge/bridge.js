'use strict';

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATIC_DIR = path.join(__dirname, '..', 'static');
const LOGS_DIR = path.join(__dirname, 'logs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) console.log('Could not open browser automatically. Visit: ' + url);
  });
}

function pingEndpoint(urlStr, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch {
      return resolve(false);
    }

    const port = parsed.port
      ? parseInt(parsed.port, 10)
      : parsed.protocol === 'https:' ? 443 : 80;

    const options = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname || '/',
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });

    req.on('error', () => resolve(false));
    req.end();
  });
}

const config = loadConfig();
const BRIDGE_PORT = config.bridge.port || 3000;
const RUNTIME_PORT = config.runtime.port || 3001;
const RUNTIME_URL = `http://localhost:${RUNTIME_PORT}`;

const app = express();
app.use(express.json());

// Serve static UI
app.use(express.static(STATIC_DIR));

// Proxy middleware for PC runtime - created once, targets localhost:3001
const runtimeProxy = createProxyMiddleware({
  target: RUNTIME_URL,
  changeOrigin: true,
  ws: false,
  proxyTimeout: 0,
  timeout: 0,
  logLevel: 'silent',
  on: {
    error: (err, req, res) => {
      console.error('Proxy error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'PC runtime not reachable', detail: err.message });
      }
    },
  },
});

// Route all agent API paths to the runtime
app.use('/task', runtimeProxy);
app.use('/plugins', runtimeProxy);
app.use('/logs', runtimeProxy);
app.use('/ping', runtimeProxy);

// GET /status — concurrent health check of both endpoints
app.get('/status', async (req, res) => {
  const cfg = loadConfig();
  const llmUrl = cfg.llm.url;
  const runtimePingUrl = `${RUNTIME_URL}/ping`;

  const llmTestPath = cfg.llm.mode === 'llamacpp'
    ? `${llmUrl}/health`
    : `${llmUrl}/api/tags`;

  const [llmOk, runtimeOk] = await Promise.all([
    pingEndpoint(llmTestPath, 3000),
    pingEndpoint(runtimePingUrl, 3000),
  ]);

  res.json({
    llm: { ok: llmOk, url: llmUrl, mode: cfg.llm.mode },
    runtime: { ok: runtimeOk, url: RUNTIME_URL },
  });
});

// POST /config — update phone IP
app.post('/config', (req, res) => {
  const { phoneIp } = req.body;
  if (!phoneIp || typeof phoneIp !== 'string') {
    return res.status(400).json({ error: 'phoneIp string is required' });
  }

  const ip = phoneIp.trim();
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    return res.status(400).json({ error: 'phoneIp must be a valid IPv4 address' });
  }

  const cfg = loadConfig();
  const port = new URL(cfg.llm.url).port || 11434;
  cfg.llm.url = `http://${ip}:${port}`;
  saveConfig(cfg);

  res.json({ ok: true, url: cfg.llm.url });
});

// GET /bridge-config — return current config
app.get('/bridge-config', (req, res) => {
  res.json(loadConfig());
});

app.listen(BRIDGE_PORT, () => {
  console.log(`[Bridge] Running on http://localhost:${BRIDGE_PORT}`);
  console.log(`[Bridge] Proxying /task /plugins /logs /ping -> ${RUNTIME_URL}`);
  console.log(`[Bridge] Serving UI from ${STATIC_DIR}`);
  setTimeout(() => openBrowser(`http://localhost:${BRIDGE_PORT}`), 1500);
});
