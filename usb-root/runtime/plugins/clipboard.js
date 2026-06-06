'use strict';

const clipboardy = require('clipboardy');

module.exports = {
  name: 'clipboard',
  description:
    'Reads from or writes to the system clipboard. ' +
    'Use action="read" to get current clipboard content, or action="write" with text to copy text.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write'],
        description: '"read" to get clipboard contents, "write" to put text on the clipboard',
      },
      text: {
        type: 'string',
        description: 'The text to write to the clipboard (only used when action is "write")',
      },
    },
    required: ['action'],
  },
  async run({ action, text }) {
    if (!action) return 'Error: action is required ("read" or "write")';

    if (action === 'read') {
      try {
        const content = clipboardy.readSync();
        if (!content || content.trim() === '') return '(clipboard is empty)';
        return content;
      } catch (err) {
        return `Error reading clipboard: ${err.message}`;
      }
    }

    if (action === 'write') {
      if (text === undefined || text === null) {
        return 'Error: text parameter is required for write action';
      }
      try {
        clipboardy.writeSync(String(text));
        const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
        return `Copied to clipboard: "${preview}"`;
      } catch (err) {
        return `Error writing clipboard: ${err.message}`;
      }
    }

    return `Error: action must be "read" or "write", got "${action}"`;
  },
};
