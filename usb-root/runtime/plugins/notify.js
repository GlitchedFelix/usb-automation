'use strict';

const notifier = require('node-notifier');
const path = require('path');

module.exports = {
  name: 'notify',
  description:
    'Sends a desktop notification to the user with a title and message body. ' +
    'Uses the native OS notification system (Windows toast, macOS notification center, Linux libnotify).',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'The notification title (short, shown in bold)',
      },
      message: {
        type: 'string',
        description: 'The notification body text',
      },
    },
    required: ['title', 'message'],
  },
  async run({ title, message }) {
    if (!title) return 'Error: title is required';
    if (!message) return 'Error: message is required';

    return new Promise((resolve) => {
      notifier.notify(
        {
          title: String(title),
          message: String(message),
          sound: false,
          wait: false,
        },
        (err) => {
          if (err) {
            resolve(`Notification error: ${err.message}`);
          } else {
            resolve(`Notification sent — Title: "${title}", Message: "${message}"`);
          }
        }
      );
    });
  },
};
