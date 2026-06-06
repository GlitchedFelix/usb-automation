# Portable LLM Agent — USB Runtime

A fully self-contained AI agent runtime that lives on a USB stick. The phone runs the LLM (via Ollama or llama.cpp in Termux), the USB stick bridges the PC to the phone over the Android hotspot, and the PC runs the agent loop, plugin system, and browser UI.

```
┌──────────────┐        WiFi hotspot         ┌──────────────────────┐
│  Android     │  <──────────────────────>   │  USB Stick           │
│  Termux      │  192.168.43.x:11434         │  bridge/bridge.js    │
│  Ollama /    │                             │  runtime/server.js   │
│  llama.cpp   │                             │  static/index.html   │
└──────────────┘                             └──────────────────────┘
                                                       │ localhost
                                                 ┌─────▼─────┐
                                                 │  Browser  │
                                                 │  :3000    │
                                                 └───────────┘
```

---

## Quick Start

1. Enable the Android hotspot and connect the PC to it
2. Start Ollama or llama.cpp in Termux (see below)
3. Run `start.bat` (Windows) or `./start.sh` (macOS/Linux) from the USB stick
4. The browser opens automatically to `http://localhost:3000`

---

## First-Time Setup

```bash
# Inside usb-root/
npm install
```

This installs all Node.js dependencies. You only need to do this once per machine (or pre-install before shipping the USB stick). The `node_modules` folder must exist before running the start scripts.

To use a portable Node.js binary instead of the system one, place it at:
- `usb-root/node/node.exe`       — Windows
- `usb-root/node/mac/node`       — macOS
- `usb-root/node/linux/node`     — Linux

Download portable Node.js from https://nodejs.org/en/download

---

## Phone Setup — Ollama in Termux

Install [Termux from F-Droid](https://f-droid.org/en/packages/com.termux/) (not the Play Store version).

```bash
# 1. Update packages
pkg update && pkg upgrade

# 2. Install curl and wget
pkg install curl wget

# 3. Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# 4. Pull a model (llama3 recommended for 8GB+ RAM phones)
ollama pull llama3
# Or a smaller model for less RAM:
ollama pull phi3:mini
ollama pull gemma:2b

# 5. Bind to all interfaces so the PC can reach it, then start
OLLAMA_HOST=0.0.0.0 ollama serve &

# 6. Test it's listening
curl http://localhost:11434/api/tags
```

To make Ollama always bind to 0.0.0.0, add to your `~/.bashrc`:
```bash
export OLLAMA_HOST=0.0.0.0
```

---

## Phone Setup — llama.cpp in Termux (Alternative)

llama.cpp uses less RAM and supports GGUF models from HuggingFace.

```bash
# 1. Install build tools
pkg install clang make cmake git

# 2. Clone and build (this takes several minutes on-phone)
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make -j$(nproc)

# 3. Download a GGUF model (example: Phi-3 Mini Q4)
mkdir -p ~/models
wget -O ~/models/phi3-mini.gguf \
  https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf

# 4. Start the server bound to all interfaces
./llama-server --host 0.0.0.0 --port 11434 --ctx-size 4096 -m ~/models/phi3-mini.gguf
```

When using llama.cpp, set `llm.mode` to `"llamacpp"` in `bridge/config.json`.

---

## Keeping Termux Alive — Hotspot & Wake Lock

### Enable Android WiFi Hotspot

1. Go to **Settings → Network & Internet → Hotspot & tethering**
2. Enable **WiFi Hotspot**
3. Connect the PC to the hotspot SSID
4. The phone's hotspot IP (as seen from the PC) is usually `192.168.43.1`

**Tips for stability:**
- Keep the phone plugged in while acting as a hotspot
- Set the hotspot band to **2.4 GHz** for better range (5 GHz drops easily)
- Disable "Auto-hotspot timeout" in hotspot settings if available
- On Samsung: turn off "Timeout setting" in hotspot advanced options

### Prevent Termux from Being Killed

Termux is aggressively killed by Android's battery optimizer on many devices.

```bash
# In Termux, acquire a CPU wake lock
termux-wake-lock
```

This requires the **Termux:API** companion app from F-Droid.

Alternatively, long-press the Termux notification and set it to **"No interruptions"** or **"Persistent"**. You can also go to **Settings → Apps → Termux → Battery → Unrestricted**.

To keep the LLM server running after you close Termux:
```bash
# Run everything in a tmux session
pkg install tmux
tmux new-session -s llm
OLLAMA_HOST=0.0.0.0 ollama serve
# Detach with Ctrl+B, then D
```

---

## Running from the USB Stick

### Windows

```
Double-click start.bat
```

The script will:
1. Scan `192.168.43.x:11434` for the phone
2. Start the bridge server (port 3000)
3. Start the PC runtime (port 3001)
4. Open your browser to `http://localhost:3000`

### macOS / Linux

```bash
chmod +x start.sh
./start.sh
```

Press **Ctrl+C** to stop both processes cleanly.

### Manual Start (if scripts fail)

```bash
# Terminal 1 — find phone and start bridge
node find_phone.js
node bridge/bridge.js

# Terminal 2 — start runtime
node runtime/server.js
```

---

## Configuration — bridge/config.json

| Field | Description |
|---|---|
| `llm.url` | Full URL to the phone LLM server (updated automatically by find_phone.js) |
| `llm.mode` | `"ollama"` or `"llamacpp"` |
| `llm.model` | Default model name sent to the LLM |
| `llm.max_iterations` | Max ReAct loop iterations per task |
| `bridge.port` | Port for the bridge + UI server (default 3000) |
| `runtime.port` | Port for the PC runtime API (default 3001) |
| `runtime.safe_directory` | Absolute path that file plugins are restricted to |
| `runtime.log_retention_days` | Days to keep task history in SQLite |
| `apps` | Map of friendly name → executable path for open_app |
| `allowed_commands` | List of shell commands shell_safe may run |
| `allowed_scripts` | Map of name → absolute path for run_script |

Example `safe_directory` values:
```json
"safe_directory": "C:\\Users\\Alice\\AgentFiles"   // Windows
"safe_directory": "/Users/alice/agent-files"         // macOS
"safe_directory": "/home/alice/agent-files"          // Linux
```

---

## Adding a New Plugin

Create `runtime/plugins/your_plugin.js` with these four exports:

```js
'use strict';

module.exports = {
  // Unique tool name — the agent uses this exact string to call it
  name: 'your_plugin',

  // Plain English description injected into the LLM system prompt
  description: 'Does something useful. Accepts X and returns Y.',

  // JSON Schema describing the expected parameters
  parameters: {
    type: 'object',
    properties: {
      input_value: {
        type: 'string',
        description: 'What the tool should act on',
      },
    },
    required: ['input_value'],
  },

  // Async function that receives the params object and returns a string
  async run({ input_value }) {
    if (!input_value) return 'Error: input_value is required';
    // ... your logic ...
    return `Result: processed "${input_value}"`;
  },
};
```

Then reload without restarting:
```bash
curl -X POST http://localhost:3001/plugins/reload
```

Or click **↻ Reload** in the plugins panel.

**Rules:**
- Always return a string from `run()`
- Never call another plugin directly — the agent loop orchestrates all calls
- Never execute arbitrary code — validate all inputs at the top of `run()`

---

## Adding Apps to the Allowlist

Edit `bridge/config.json`:

```json
"apps": {
  "notepad":    "notepad.exe",
  "vscode":     "C:\\Users\\Alice\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
  "terminal":   "wt.exe",
  "textedit":   "/System/Applications/TextEdit.app/Contents/MacOS/TextEdit",
  "gedit":      "/usr/bin/gedit"
}
```

## Adding Shell Commands to the Allowlist

```json
"allowed_commands": ["ls", "dir", "pwd", "echo", "date", "whoami", "ipconfig"]
```

Only the base command (first word) is checked — arguments are allowed.

## Adding Scripts to the Allowlist

```json
"allowed_scripts": {
  "backup": "/home/alice/scripts/backup.sh",
  "sync":   "C:\\Users\\Alice\\scripts\\sync.bat"
}
```

---

## Troubleshooting

### Phone not found on scan

```
ERROR: No device found on 192.168.43.x:11434
```

1. Confirm the Android hotspot is active and the PC is connected to it
2. Confirm Ollama is running with `OLLAMA_HOST=0.0.0.0` (not just `localhost`)
3. Test from the PC: `curl http://192.168.43.1:11434/api/tags`
4. Check Android firewall — some ROMs block connections from hotspot clients
5. Try pinging `192.168.43.1` from the PC — if it fails, the hotspot isn't connected
6. Manually set the IP: edit `bridge/config.json` and set `llm.url` directly, then skip the scan by running `node bridge/bridge.js` and `node runtime/server.js` directly

### PC runtime not reachable

Status bar shows Runtime ✕:

1. Check the runtime process is running (`node runtime/server.js`)
2. Make sure port 3001 is not blocked by a firewall
3. Check `bridge/config.json` → `runtime.port` matches what the runtime started on
4. Look for errors in the terminal where `server.js` is running
5. Try: `curl http://localhost:3001/ping` — should return `{"ok":true}`

### LLM returning malformed JSON

The agent gets stuck in parse-failure loops:

1. **Switch to a larger model** — smaller models (< 3B params) often cannot follow strict JSON-only instructions reliably. Try `llama3`, `mistral`, or `phi3` instead of very small models.
2. **Check llm.mode** — if using llama.cpp, set `"mode": "llamacpp"` in config.json; if using Ollama, set `"mode": "ollama"`. The wrong endpoint returns unparseable responses.
3. **Reduce max_iterations** — a busy or overloaded phone may return partial responses
4. **Check Termux memory** — if the model is too large for the phone's RAM, it may produce garbled output. Use `ollama ps` to see current memory usage.
5. **Increase timeout** — edit `agent.js` and increase the `timeout` value in `callOllama` / `callLlamaCpp` from 180000 to a larger value

### Plugins failing to load

```
[PluginLoader] Failed to load myplugin.js: ...
```

1. Make sure the plugin exports all four required fields: `name`, `description`, `parameters`, `run`
2. Check for syntax errors: `node runtime/plugins/myplugin.js`
3. Check that all `require()` calls in the plugin resolve — dependencies must be in `usb-root/node_modules`
4. View the plugin list in the UI or hit `GET http://localhost:3001/plugins` to see what loaded
5. After fixing, use the **↻ Reload** button or `POST /plugins/reload` — no restart needed

### better-sqlite3 fails on new machine

`better-sqlite3` contains a native `.node` binary compiled for a specific Node.js version. If you see an error like `The module was compiled against a different Node.js version`:

```bash
npm rebuild better-sqlite3
```

This recompiles it for the currently-installed Node version. If you're using a portable Node binary, set `npm_config_nodedir` to point to the portable Node headers, or use `pkg` to create a fully-bundled executable.

---

## Architecture Notes

- **Bridge** (`bridge/bridge.js`): Pure relay. No agent logic. Proxies `/task`, `/plugins`, `/logs` to the runtime. Serves the static UI. Exposes `/status` and `/config`.
- **Runtime** (`runtime/server.js`): All agent logic lives here. SQLite for persistence. Plugin hot-reload.
- **Agent** (`runtime/agent.js`): ReAct loop. Sends full conversation history to the LLM each iteration. Supports Ollama and llama.cpp endpoints. Retries JSON parse failures up to 3×.
- **Plugins**: Isolated CommonJS modules. Cannot call each other. The agent loop is the sole orchestrator.
- **Security**: Shell commands checked against allowlist before execution. File paths validated against `safe_directory`. Apps validated against `apps` map. Scripts validated against `allowed_scripts` map.
