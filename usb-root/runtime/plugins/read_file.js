'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'bridge', 'config.json');

function getSafeDir() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return config.runtime.safe_directory || '';
}

function resolveAndValidate(safeDir, filename) {
  const safeDirAbs = path.resolve(safeDir);
  const resolved = path.resolve(safeDirAbs, filename);

  // Ensure the resolved path is inside the safe directory
  const relative = path.relative(safeDirAbs, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path traversal detected: filename escapes safe_directory');
  }

  return resolved;
}

module.exports = {
  name: 'read_file',
  description:
    'Reads the text contents of a file within the configured safe_directory. ' +
    'Filename can include subdirectories relative to safe_directory.',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'File path relative to the safe_directory, e.g. "notes.txt" or "data/report.csv"',
      },
    },
    required: ['filename'],
  },
  async run({ filename }) {
    if (!filename) return 'Error: filename is required';

    const safeDir = getSafeDir();
    if (!safeDir) return 'Error: runtime.safe_directory is not set in bridge/config.json';

    let resolved;
    try {
      resolved = resolveAndValidate(safeDir, filename);
    } catch (err) {
      return `Error: ${err.message}`;
    }

    try {
      const content = fs.readFileSync(resolved, 'utf8');
      return content || '(empty file)';
    } catch (err) {
      return `Error reading file: ${err.message}`;
    }
  },
};
