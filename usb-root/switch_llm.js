#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'bridge', 'config.json');

const PROFILES = {
  ollama: {
    label: 'Ollama',
    mode: 'ollama',
    port: 11434,
    pingPath: '/api/tags',
  },
  llamacpp: {
    label: 'llama.cpp',
    mode: 'llamacpp',
    port: 11435,
    pingPath: '/health',
  },
};

function usage() {
  console.log('Usage: node switch_llm.js <ollama|llamacpp> [phone-ip] [model]');
  console.log('');
  console.log('  node switch_llm.js ollama              # use current IP, switch to Ollama');
  console.log('  node switch_llm.js llamacpp            # use current IP, switch to llama.cpp');
  console.log('  node switch_llm.js ollama 192.168.43.1 llama3');
  console.log('  node switch_llm.js llamacpp 192.168.43.1 phi3-mini');
  process.exit(1);
}

const target = process.argv[2];
if (!target || !PROFILES[target]) {
  console.error('Unknown profile: ' + target);
  usage();
}

const profile = PROFILES[target];
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Extract current IP from existing URL
let currentIp;
try {
  currentIp = new URL(config.llm.url).hostname;
} catch {
  currentIp = '192.168.43.1';
}

const phoneIp = process.argv[3] || currentIp;
const model   = process.argv[4] || config.llm.model;

config.llm.url  = `http://${phoneIp}:${profile.port}`;
config.llm.mode = profile.mode;
config.llm.model = model;

fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

console.log(`Switched to: ${profile.label}`);
console.log(`  URL:   ${config.llm.url}`);
console.log(`  Mode:  ${config.llm.mode}`);
console.log(`  Model: ${config.llm.model}`);
console.log('');
console.log('Restart the bridge and runtime to apply, or just submit a new task.');
