'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'bridge', 'config.json');

module.exports = {
  name: 'open_app',
  description:
    'Opens a named application. The app must be registered in the config apps list. ' +
    'Example names: notepad, calculator, terminal, textedit, gedit.',
  parameters: {
    type: 'object',
    properties: {
      app_name: {
        type: 'string',
        description: 'The friendly name of the app to open, e.g. "notepad" or "calculator"',
      },
    },
    required: ['app_name'],
  },
  async run({ app_name }) {
    if (!app_name) return 'Error: app_name is required';

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const apps = config.apps || {};
    const key = String(app_name).toLowerCase().trim();
    const execPath = apps[key];

    if (!execPath) {
      const available = Object.keys(apps).join(', ') || 'none configured';
      return `Error: App "${app_name}" is not in the allowed apps list. Available: ${available}`;
    }

    return new Promise((resolve) => {
      let settled = false;
      const child = spawn(execPath, [], {
        detached: true,
        stdio: 'ignore',
        shell: process.platform === 'win32',
      });

      child.unref();

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          resolve(`Error launching "${app_name}" (${execPath}): ${err.message}`);
        }
      });

      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(`Launched "${app_name}" (${execPath})`);
        }
      }, 600);
    });
  },
};
