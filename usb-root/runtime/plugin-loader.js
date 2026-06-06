'use strict';

const fs = require('fs');
const path = require('path');

let _plugins = [];
let _pluginsDir = '';

function loadPlugins(dir) {
  _pluginsDir = dir;
  _plugins = [];

  if (!fs.existsSync(dir)) {
    console.warn('[PluginLoader] Plugins directory not found:', dir);
    return;
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const plugin = require(filePath);

      if (!plugin.name || typeof plugin.name !== 'string') {
        throw new Error('Missing or invalid "name" export (must be a string)');
      }
      if (!plugin.description || typeof plugin.description !== 'string') {
        throw new Error('Missing or invalid "description" export (must be a string)');
      }
      if (!plugin.parameters || typeof plugin.parameters !== 'object') {
        throw new Error('Missing or invalid "parameters" export (must be a JSON Schema object)');
      }
      if (typeof plugin.run !== 'function') {
        throw new Error('Missing or invalid "run" export (must be an async function)');
      }

      _plugins.push(plugin);
      console.log(`[PluginLoader] Loaded: ${plugin.name}`);
    } catch (err) {
      console.error(`[PluginLoader] Failed to load ${file}: ${err.message}`);
    }
  }

  console.log(`[PluginLoader] ${_plugins.length} plugin(s) ready`);
}

function reloadPlugins(dir) {
  const targetDir = dir || _pluginsDir;
  if (!targetDir) {
    console.warn('[PluginLoader] reloadPlugins called before loadPlugins');
    return;
  }

  // Clear require cache for all plugin files so re-require picks up changes
  if (fs.existsSync(targetDir)) {
    const files = fs.readdirSync(targetDir).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      const filePath = path.join(targetDir, file);
      const resolved = require.resolve(filePath);
      if (require.cache[resolved]) {
        delete require.cache[resolved];
      }
    }
  }

  loadPlugins(targetDir);
}

function getPlugins() {
  return _plugins;
}

module.exports = { loadPlugins, reloadPlugins, getPlugins };
