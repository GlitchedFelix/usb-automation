'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'bridge', 'config.json');

module.exports = {
  name: 'shell_safe',
  description:
    'Runs a shell command that is explicitly listed in the allowed_commands configuration. ' +
    'Will NOT run arbitrary commands — the base command must match an allowlist entry exactly. ' +
    'Arguments after the command are permitted but the command binary itself must be pre-approved.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'The full command to run, e.g. "ls -la /tmp". The first word must be in the allowed_commands list.',
      },
    },
    required: ['command'],
  },
  async run({ command }) {
    if (!command || typeof command !== 'string') return 'Error: command is required';

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const allowedCommands = Array.isArray(config.allowed_commands) ? config.allowed_commands : [];

    const trimmed = command.trim();
    const baseCommand = trimmed.split(/\s+/)[0];

    if (!allowedCommands.includes(baseCommand)) {
      return (
        `Error: Command "${baseCommand}" is not in the allowed list.\n` +
        `Allowed: ${allowedCommands.join(', ') || 'none configured'}\n` +
        'Add it to allowed_commands in bridge/config.json to enable it.'
      );
    }

    return new Promise((resolve) => {
      exec(trimmed, { timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const out = ((stdout || '') + (stderr || '')).trim();

        if (err && !out) {
          resolve(`Error (exit ${err.code}): ${err.message}`);
          return;
        }

        resolve(out || '(no output)');
      });
    });
  },
};
