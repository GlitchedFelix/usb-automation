'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'bridge', 'config.json');

function getSafeDir() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return config.runtime.safe_directory || os.tmpdir();
  } catch {
    return os.tmpdir();
  }
}

function buildCommand(outputPath) {
  const platform = process.platform;
  const quoted = outputPath.replace(/"/g, '\\"');

  if (platform === 'win32') {
    // PowerShell screenshot using .NET
    return (
      `powershell -NoProfile -NonInteractive -Command "` +
      `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
      `$s = [System.Windows.Forms.Screen]::PrimaryScreen; ` +
      `$b = New-Object System.Drawing.Bitmap($s.Bounds.Width,$s.Bounds.Height); ` +
      `$g = [System.Drawing.Graphics]::FromImage($b); ` +
      `$g.CopyFromScreen($s.Bounds.Location,[System.Drawing.Point]::Empty,$s.Bounds.Size); ` +
      `$b.Save('${quoted.replace(/'/g, "''")}'); ` +
      `$g.Dispose(); $b.Dispose()"`
    );
  }

  if (platform === 'darwin') {
    return `screencapture -x "${quoted}"`;
  }

  // Linux: try scrot, then gnome-screenshot, then import (ImageMagick)
  return (
    `scrot "${quoted}" 2>/dev/null || ` +
    `gnome-screenshot -f "${quoted}" 2>/dev/null || ` +
    `import -window root "${quoted}"`
  );
}

module.exports = {
  name: 'screenshot',
  description:
    'Takes a full-screen screenshot and saves it as a PNG file in the safe_directory. ' +
    'Returns the saved file path. Requires scrot on Linux, screencapture on macOS, or PowerShell on Windows.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async run() {
    const safeDir = getSafeDir();

    try {
      fs.mkdirSync(safeDir, { recursive: true });
    } catch {
      // ignore
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    const outputPath = path.join(safeDir, filename);
    const command = buildCommand(outputPath);

    return new Promise((resolve) => {
      exec(command, { timeout: 20000 }, (err, stdout, stderr) => {
        if (fs.existsSync(outputPath)) {
          const size = fs.statSync(outputPath).size;
          resolve(`Screenshot saved: ${outputPath} (${Math.round(size / 1024)} KB)`);
        } else {
          const detail = err ? err.message : (stderr || 'unknown error');
          resolve(
            `Error taking screenshot: ${detail}\n` +
            'Linux: install scrot with "sudo apt install scrot"\n' +
            'macOS: screencapture is built-in\n' +
            'Windows: PowerShell is required'
          );
        }
      });
    });
  },
};
