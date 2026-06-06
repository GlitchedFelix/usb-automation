#!/usr/bin/env node
'use strict';

const net = require('net');
const fs = require('fs');
const path = require('path');

const SUBNET = '192.168.43';
const PORT = 11434;
const TIMEOUT_MS = 800;
const CONFIG_PATH = path.join(__dirname, 'bridge', 'config.json');

function scanHost(ip) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    function done(result) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    }

    socket.setTimeout(TIMEOUT_MS);
    socket.on('connect', () => done(ip));
    socket.on('timeout', () => done(null));
    socket.on('error', () => done(null));
    socket.connect(PORT, ip);
  });
}

async function findPhone() {
  console.log(`Scanning ${SUBNET}.1-254 on port ${PORT} with ${TIMEOUT_MS}ms timeout...`);

  const promises = [];
  for (let i = 1; i <= 254; i++) {
    promises.push(scanHost(`${SUBNET}.${i}`));
  }

  const results = await Promise.all(promises);
  const found = results.find((ip) => ip !== null);

  if (!found) {
    console.error('');
    console.error('ERROR: No device found responding on ' + SUBNET + '.x:' + PORT);
    console.error('');
    console.error('Checklist:');
    console.error('  1. Enable Android WiFi hotspot (Settings > Hotspot)');
    console.error('  2. Connect this PC to the Android hotspot network');
    console.error('  3. Start Ollama in Termux: OLLAMA_HOST=0.0.0.0 ollama serve');
    console.error('     OR llama.cpp server: ./server --host 0.0.0.0 --port 11434 -m model.gguf');
    console.error('  4. Run termux-wake-lock to keep Termux alive');
    console.error('');
    console.error('If you know the phone IP, edit bridge/config.json manually and re-run.');
    process.exit(1);
  }

  console.log('Found LLM server at: ' + found);

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  config.llm.url = `http://${found}:${PORT}`;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log('Updated bridge/config.json with phone IP: ' + found);
}

findPhone().catch((err) => {
  console.error('Fatal error during phone scan:', err.message);
  process.exit(1);
});
