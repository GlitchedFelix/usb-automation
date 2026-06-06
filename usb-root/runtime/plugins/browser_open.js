'use strict';

const { exec } = require('child_process');

module.exports = {
  name: 'browser_open',
  description:
    'Opens a URL in the system default web browser. ' +
    'Uses "start" on Windows, "open" on macOS, and "xdg-open" on Linux.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full URL to open, e.g. "https://example.com"',
      },
    },
    required: ['url'],
  },
  async run({ url }) {
    if (!url || typeof url !== 'string') return 'Error: url is required';

    // Validate URL to prevent command injection
    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      return `Error: "${url}" is not a valid URL. Include the protocol, e.g. "https://example.com"`;
    }

    // Only allow http/https to avoid opening dangerous protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `Error: Only http and https URLs are allowed, got "${parsed.protocol}"`;
    }

    const safeUrl = parsed.toString();
    const platform = process.platform;
    let command;

    if (platform === 'win32') {
      // Use cmd /c start to avoid shell injection — URL is passed as a separate argument
      command = `cmd /c start "" "${safeUrl.replace(/"/g, '')}"`;
    } else if (platform === 'darwin') {
      command = `open "${safeUrl.replace(/"/g, '')}"`;
    } else {
      command = `xdg-open "${safeUrl.replace(/"/g, '')}"`;
    }

    return new Promise((resolve) => {
      exec(command, { timeout: 8000 }, (err) => {
        if (err && err.code && err.code !== 0 && !err.killed) {
          resolve(`Error opening browser: ${err.message}`);
        } else {
          resolve(`Opened in browser: ${safeUrl}`);
        }
      });
    });
  },
};
