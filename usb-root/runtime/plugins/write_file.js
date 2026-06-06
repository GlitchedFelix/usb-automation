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

  const relative = path.relative(safeDirAbs, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path traversal detected: filename escapes safe_directory');
  }

  return resolved;
}

module.exports = {
  name: 'write_file',
  description:
    'Writes or appends text content to a file within the configured safe_directory. ' +
    'Creates intermediate directories as needed. Set append=true to add to an existing file.',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'File path relative to the safe_directory, e.g. "output.txt" or "logs/run.log"',
      },
      content: {
        type: 'string',
        description: 'The text content to write',
      },
      append: {
        type: 'boolean',
        description: 'If true, append to the existing file instead of overwriting it (default: false)',
      },
    },
    required: ['filename', 'content'],
  },
  async run({ filename, content, append = false }) {
    if (!filename) return 'Error: filename is required';
    if (content === undefined || content === null) return 'Error: content is required';

    const safeDir = getSafeDir();
    if (!safeDir) return 'Error: runtime.safe_directory is not set in bridge/config.json';

    let resolved;
    try {
      resolved = resolveAndValidate(safeDir, filename);
    } catch (err) {
      return `Error: ${err.message}`;
    }

    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });

      if (append) {
        fs.appendFileSync(resolved, content, 'utf8');
        return `Appended ${content.length} characters to ${filename}`;
      } else {
        fs.writeFileSync(resolved, content, 'utf8');
        return `Wrote ${content.length} characters to ${filename}`;
      }
    } catch (err) {
      return `Error writing file: ${err.message}`;
    }
  },
};
