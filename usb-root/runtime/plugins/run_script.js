'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'bridge', 'config.json');

module.exports = {
  name: 'run_script',
  description:
    'Runs a named script that is pre-registered in the allowed_scripts configuration map. ' +
    'Scripts must be added by name and absolute path in bridge/config.json before they can be used.',
  parameters: {
    type: 'object',
    properties: {
      script_name: {
        type: 'string',
        description: 'The registered name of the script to run, as it appears in the allowed_scripts config',
      },
    },
    required: ['script_name'],
  },
  async run({ script_name }) {
    if (!script_name || typeof script_name !== 'string') return 'Error: script_name is required';

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const allowedScripts = config.allowed_scripts || {};

    const scriptPath = allowedScripts[script_name.trim()];
    if (!scriptPath) {
      const available = Object.keys(allowedScripts).join(', ') || 'none configured';
      return (
        `Error: Script "${script_name}" is not in the allowed_scripts list.\n` +
        `Available: ${available}\n` +
        'Add entries to allowed_scripts in bridge/config.json.'
      );
    }

    if (!fs.existsSync(scriptPath)) {
      return `Error: Script file not found at path: ${scriptPath}`;
    }

    // Quote the path to handle spaces
    const quotedPath = `"${scriptPath.replace(/"/g, '\\"')}"`;

    return new Promise((resolve) => {
      exec(quotedPath, { timeout: 60000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const out = ((stdout || '') + (stderr || '')).trim();

        if (err && !out) {
          resolve(`Script error (exit ${err.code}): ${err.message}`);
          return;
        }

        resolve(out || '(script produced no output)');
      });
    });
  },
};
