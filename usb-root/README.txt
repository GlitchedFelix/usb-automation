================================================================================
  PORTABLE LLM AGENT RUNTIME
  Phone brain. USB stick runtime. No install on the laptop.
================================================================================

WHAT IT IS
----------
Your Android phone runs the LLM (via Ollama in Termux).
The USB stick holds everything else: the bridge server, the agent runtime,
the plugin system, and the browser UI.
The laptop only needs a browser. Nothing is installed on it.

When you plug in the USB and run the start script, the browser opens and you
can give the agent tasks. It reasons using the phone's LLM, then executes
actions on the laptop using tools (read files, search the web, run commands,
send notifications, open apps, etc).


--------------------------------------------------------------------------------
ARCHITECTURE
--------------------------------------------------------------------------------

  [Android Phone]                [USB Stick]               [Laptop Browser]
  Termux + Ollama       <-->     bridge.js  :3000  <-->    localhost:3000
  llama3:latest                  runtime/server.js :3001
  192.168.43.x:11434             SQLite task log
                                 10 plugins
                                 static/index.html

The bridge is a pure relay. It proxies /task /plugins /logs to the runtime.
All reasoning and tool execution happens in the runtime on the PC side.
The LLM only lives on the phone.


--------------------------------------------------------------------------------
DIRECTORY STRUCTURE
--------------------------------------------------------------------------------

usb-root/
  start.bat                 Windows launcher
  start.sh                  Mac/Linux launcher
  find_phone.js             Scans 192.168.43.x:11434 to find the phone
  switch_llm.js             Switch between Ollama and llama.cpp configs
  package.json              Node dependencies
  README.txt                This file

  bridge/
    bridge.js               Express relay server (port 3000)
    config.json             All configuration lives here
    logs/
      tasks.db              SQLite database (auto-created)

  runtime/
    server.js               Agent API server (port 3001)
    agent.js                ReAct loop - the brain of the system
    plugin-loader.js        Loads and hot-reloads plugins

    plugins/
      open_app.js           Open an app by name
      read_file.js          Read a file from safe_directory
      write_file.js         Write/append a file to safe_directory
      shell_safe.js         Run an allowed shell command
      run_script.js         Run a pre-registered script
      web_search.js         DuckDuckGo instant answer search
      notify.js             Send a desktop notification
      clipboard.js          Read or write the clipboard
      screenshot.js         Take a screenshot
      browser_open.js       Open a URL in the browser

  static/
    index.html              Full browser UI (single file, no build needed)

  node/
    node.exe                Put portable Node.js binary here (Windows)
    mac/node                Put portable Node.js binary here (macOS)
    linux/node              Put portable Node.js binary here (Linux)


--------------------------------------------------------------------------------
FIRST TIME SETUP
--------------------------------------------------------------------------------

STEP 1 - PHONE SETUP (do once)
  Install Termux from F-Droid (NOT the Play Store version):
    https://f-droid.org/en/packages/com.termux/

  In Termux, install Ollama:
    pkg update && pkg upgrade
    curl -fsSL https://ollama.ai/install.sh | sh

  Download a model:
    ollama pull llama3:latest       (best quality, needs ~5GB RAM)
    ollama pull phi3:mini           (faster, needs ~2.5GB RAM)

  Check the exact model name (use this in the UI):
    ollama list

STEP 2 - USB SETUP (do once on any PC with Node.js)
  Open a terminal inside usb-root/ and run:
    npm install

  This creates node_modules/ on the USB stick.
  Everything is self-contained after this - the USB works on any Windows PC.

  OPTIONAL - Portable Node.js (so target PC needs nothing at all):
    Download from: https://nodejs.org/en/download
    Click "Prebuilt Binaries" then download the .zip for Windows
    Extract node.exe into usb-root/node/node.exe

STEP 3 - SET SAFE DIRECTORY
  Open usb-root/bridge/config.json in any text editor.
  Set safe_directory to the folder the agent can read/write files in:

  Windows:  "safe_directory": "C:\\Users\\YourName\\Documents\\AgentFiles"
  Mac:      "safe_directory": "/Users/yourname/agent-files"
  Linux:    "safe_directory": "/home/yourname/agent-files"

  Create the folder if it does not exist.


--------------------------------------------------------------------------------
RUNNING THE SYSTEM (every time)
--------------------------------------------------------------------------------

PHONE FIRST:
  1. Enable Android WiFi Hotspot
     Settings -> Network & Internet -> Hotspot -> turn on

  2. Connect the laptop to the phone's hotspot WiFi

  3. Open Termux and run:
       termux-wake-lock
       OLLAMA_HOST=0.0.0.0 ollama serve

     Leave Termux running. Do not close it.

  4. Keep the phone screen from sleeping:
     Settings -> Display -> Screen timeout -> set to maximum or Never

PC SIDE:
  Windows: double-click start.bat
  Mac/Linux: open terminal in usb-root/ and run ./start.sh

  The script will:
    1. Scan for the phone on the hotspot network
    2. Update the config with the phone's IP
    3. Start the bridge server (port 3000)
    4. Start the runtime server (port 3001)
    5. Open your browser to http://localhost:3000

EVERY TIME AFTER FIRST SETUP:
  Phone: OLLAMA_HOST=0.0.0.0 ollama serve
  PC:    double-click start.bat (or ./start.sh)


--------------------------------------------------------------------------------
OPENING CMD ON THE USB (Windows)
--------------------------------------------------------------------------------

Method 1:
  Open the usb-root folder in File Explorer
  Click the address bar at the top
  Type: cmd
  Press Enter

Method 2:
  Hold Shift + right-click on empty space inside usb-root
  Click "Open PowerShell window here" or "Open command window here"

If npm is not recognized:
  Use the portable node from the node/ folder:
    node\npm install


--------------------------------------------------------------------------------
CONFIGURATION - bridge/config.json
--------------------------------------------------------------------------------

{
  "llm": {
    "url": "http://192.168.43.1:11434",   <- phone IP, auto-updated by find_phone.js
    "mode": "ollama",                      <- "ollama" or "llamacpp"
    "model": "llama3:latest",              <- must match output of: ollama list
    "max_iterations": 10                   <- max tool calls per task
  },
  "bridge": {
    "port": 3000                           <- browser connects here
  },
  "runtime": {
    "port": 3001,                          <- internal agent API
    "safe_directory": "",                  <- MUST be set before using file tools
    "log_retention_days": 7               <- auto-delete old tasks after N days
  },
  "apps": {
    "notepad":    "notepad.exe",           <- add apps the agent can open
    "calculator": "calc.exe"
  },
  "allowed_commands": [                    <- shell commands the agent can run
    "ls", "dir", "pwd", "echo", "date", "whoami", "ipconfig", "ifconfig",
    "ping", "hostname", "uname", "df", "free"
  ],
  "allowed_scripts": {}                    <- named scripts the agent can run
}

IMPORTANT: After editing config.json, restart the runtime window for changes
to take effect. The bridge reads config live so it does not need restarting.


--------------------------------------------------------------------------------
USING THE UI
--------------------------------------------------------------------------------

STATUS BAR (top)
  Green dot = connected   Red dot = not reachable
  Left dot  = phone LLM   Right dot = PC runtime
  If red: check phone hotspot, check Ollama is running, click Reconnect

SUBMITTING A TASK
  Type your task in the text box
  Set the Model field to match exactly what "ollama list" shows (e.g. llama3:latest)
  Set Iterations (10 is fine for most tasks)
  Press Run or Ctrl+Enter

WATCHING STEPS
  Each tool call appears as a collapsible card showing:
  - Thought: what the model was thinking
  - Action: which tool it called
  - Params: what it passed to the tool
  - Observation: what the tool returned
  The final green Result box shows the agent's conclusion.

PLUGINS PANEL (left)
  Lists all loaded plugins with their descriptions
  Click Reload to hot-reload plugins without restarting

HISTORY PANEL (right)
  Shows last 10 tasks with status
  Click any task to expand and see its result

MODEL FIELD
  The model name must exactly match what Ollama shows.
  Common values: llama3:latest, phi3:mini, llama3:8b, gemma:2b
  Saved to browser localStorage between sessions.


--------------------------------------------------------------------------------
EXAMPLE TASKS
--------------------------------------------------------------------------------

The agent is built for task execution, not conversation.
Good prompts:

  "Search the web for the current Node.js LTS version"
  "Read the file notes.txt and summarize it"
  "Write a shopping list to a file called shopping.txt"
  "What is on my clipboard?"
  "Open Notepad"
  "Take a screenshot"
  "What is my IP address?"  (uses shell_safe with ipconfig/ifconfig)
  "Send me a desktop notification saying the task is done"

Plain conversation also works but the agent always responds via the
finish action - the result field contains the answer.


--------------------------------------------------------------------------------
SWITCHING BETWEEN OLLAMA AND LLAMA.CPP
--------------------------------------------------------------------------------

If you have both running on different ports:

  Ollama default:    port 11434
  llama.cpp:         port 11435 (recommended)

Start llama.cpp in Termux:
  cd ~/llama.cpp
  ./llama-server --host 0.0.0.0 --port 11435 -m ~/models/your-model.gguf

Switch the config from the PC:
  node switch_llm.js ollama              <- use Ollama on port 11434
  node switch_llm.js llamacpp           <- use llama.cpp on port 11435
  node switch_llm.js ollama 192.168.43.1 llama3:latest   <- with IP and model

Takes effect on the next task submitted. No restart needed.


--------------------------------------------------------------------------------
ADDING NEW PLUGINS
--------------------------------------------------------------------------------

Create a file in runtime/plugins/myplugin.js with this structure:

  'use strict';

  module.exports = {
    name: 'my_plugin',
    description: 'What it does. Be specific - this is injected into the LLM prompt.',
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'What this parameter is for',
        },
      },
      required: ['input'],
    },
    async run({ input }) {
      if (!input) return 'Error: input is required';
      // your logic here
      return 'result as a string';
    },
  };

Rules:
  - run() MUST always return a string
  - CommonJS only (require not import)
  - Validate inputs at the top, return error strings instead of throwing
  - Never call another plugin directly
  - Config path: require('path').join(__dirname, '..', '..', 'bridge', 'config.json')
  - For file access: validate paths against safe_directory using path.relative()
  - For shell: check against config.allowed_commands before any exec()
  - Available packages: node-fetch (v2), node-notifier, clipboardy (v3), uuid

After adding: click Reload in the UI plugins panel. No restart needed.

PROMPT TO GENERATE NEW PLUGINS WITH ANY AI CHAT:
  Paste this into Claude, ChatGPT, or any chat to get a ready-made plugin:

  ---
  I'm building plugins for a portable Node.js LLM agent runtime. Each plugin
  is a CommonJS module (.js file) that the agent can call as a tool.
  Give me a complete, immediately runnable plugin file for:

  [DESCRIBE WHAT YOU WANT]

  Structure required:
  'use strict';
  module.exports = {
    name: 'plugin_name',
    description: 'Plain English - injected into LLM system prompt.',
    parameters: { type: 'object', properties: { param: { type: 'string',
      description: '...' } }, required: ['param'] },
    async run({ param }) { return 'always a string'; },
  };

  Rules: CommonJS only. run() always returns string. Validate inputs.
  No arbitrary shell exec. Config at: require('path').join(__dirname,
  '..', '..', 'bridge', 'config.json'). Safe dir in config.runtime.
  safe_directory - validate with path.relative(). Available packages:
  node-fetch v2, node-notifier, clipboardy v3 (sync), child_process,
  fs, path, os. Return complete file only, no explanation outside code.
  ---


--------------------------------------------------------------------------------
ADDING APPS TO THE ALLOWLIST
--------------------------------------------------------------------------------

In bridge/config.json, add to "apps":
  "vscode":   "C:\\Users\\Name\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"
  "chrome":   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  "terminal": "wt.exe"

Then ask the agent: "Open vscode"


--------------------------------------------------------------------------------
ADDING SHELL COMMANDS TO THE ALLOWLIST
--------------------------------------------------------------------------------

In bridge/config.json, add to "allowed_commands":
  "curl", "git", "python", "node"

Then ask: "Run the command: git status"
The base command (first word) is checked. Arguments are allowed.


--------------------------------------------------------------------------------
ADDING SCRIPTS TO THE ALLOWLIST
--------------------------------------------------------------------------------

In bridge/config.json, add to "allowed_scripts":
  "backup": "C:\\Users\\Name\\scripts\\backup.bat",
  "sync":   "C:\\Users\\Name\\scripts\\sync.bat"

Then ask: "Run the backup script"


--------------------------------------------------------------------------------
PERFORMANCE TIPS
--------------------------------------------------------------------------------

THE MODEL IS THE BIGGEST FACTOR:
  llama3:latest (8B)  - best quality, ~3-5 min per response on phone CPU
  phi3:mini (3.8B)    - good quality, ~1-2 min per response, recommended
  gemma:2b            - fast, ~30-60s, but often produces bad JSON for tools

KEEP THE PHONE ALIVE:
  termux-wake-lock prevents Android from killing Ollama mid-response
  Keep the phone plugged in
  Set screen timeout to maximum
  Go to Settings -> Apps -> Termux -> Battery -> set to Unrestricted

USE TMUX TO MANAGE TERMUX SESSIONS:
  pkg install tmux
  tmux new -s llm
  OLLAMA_HOST=0.0.0.0 ollama serve
  Detach: Ctrl+B then D
  Reattach later: tmux attach -t llm

REDUCE ITERATIONS FOR SIMPLE TASKS:
  Change max iterations to 3-5 for simple one-tool tasks
  Only use 10+ for complex multi-step tasks


--------------------------------------------------------------------------------
TROUBLESHOOTING
--------------------------------------------------------------------------------

"npm is not recognized"
  Node.js is not installed on the PC.
  Download the Windows portable zip from nodejs.org/en/download
  Extract node.exe into usb-root/node/
  Then run: node\npm install

"Phone not found on scan"
  Check Android hotspot is enabled and PC is connected to it
  Check Ollama is running: should show "Listening on 0.0.0.0:11434"
  Make sure OLLAMA_HOST=0.0.0.0 is set (not just ollama serve)
  Test from PC CMD: curl http://192.168.43.1:11434/api/tags
  If curl fails, hotspot subnet may differ from 192.168.43.x
  Manual fix: edit bridge/config.json and set llm.url to the correct IP

"LLM dot is red in the UI"
  Ollama is not reachable - check it is running on the phone
  Check the IP in config.json is still correct (hotspot IPs can change)
  Enter the phone IP in the status bar field and click Reconnect

"Runtime dot is red"
  The runtime process crashed or was not started
  Check the USB-LLM-Runtime CMD window for errors
  Restart it: node runtime\server.js
  Test: curl http://localhost:3001/ping  (should return {"ok":true})

"Error: Tool undefined not found"
  The model returned a bad action. Fixed in latest version.
  Pull latest from git and restart runtime.

"LLM call failed: network timeout"
  Phone took too long to respond (slow CPU inference)
  Fix in runtime\agent.js: change timeout: 180000 to timeout: 600000
  Switch to phi3:mini for faster responses
  Make sure phone is not sleeping (termux-wake-lock)

"BadRequestError: request aborted" in runtime window
  express.json() in bridge.js is consuming the POST body before the proxy.
  Fix: open bridge\bridge.js, delete the line: app.use(express.json());
  Also change: app.post('/config', to: app.post('/config', express.json(),
  Restart the bridge window.

"Ollama returning 500 errors"
  Model name mismatch. Run: ollama list
  Use the exact name shown (e.g. llama3:latest not llama3)
  Update the Model field in the UI to match exactly.

"better-sqlite3 error about wrong Node version"
  This version uses sql.js (pure JS) so this should not happen.
  If you have an old version: git pull && npm install

"Plugin not loading"
  Check runtime window for [PluginLoader] error messages
  Test syntax: node runtime\plugins\myplugin.js
  Make sure all four exports exist: name, description, parameters, run
  Click Reload in UI after fixing

"Agent loops without finishing"
  Model is confused by the task. Try rephrasing more specifically.
  Reduce max_iterations to prevent long loops.
  Check the model name is correct in the Model field.

"start.bat shows Unicode escape error"
  Old version of start.bat. Pull latest from git.
  Or manually: open start.bat, find and delete the line starting with
  "start USB-LLM-Bridge /min cmd /c" (the long logging line).
  Keep only: start "USB-LLM-Bridge" /min "%NODE_BIN%" ...bridge.js


--------------------------------------------------------------------------------
SECURITY NOTES
--------------------------------------------------------------------------------

This system is designed for personal use on a trusted local network.
Do not expose port 3000 or 3001 to the internet.
The hotspot network is private - only devices connected to your phone can reach it.

Built-in protections:
  - File plugins reject any path that escapes safe_directory
  - Shell plugin checks every command against allowed_commands before running
  - Script plugin checks every script name against allowed_scripts before running
  - App plugin only launches executables listed in the apps config
  - browser_open only allows http/https URLs

Do not add sensitive commands to allowed_commands.
Set safe_directory to a dedicated folder, not your entire home directory.


--------------------------------------------------------------------------------
REPOSITORY
--------------------------------------------------------------------------------

  https://github.com/GlitchedFelix/usb-automation
  Branch: main

To update the USB stick with latest fixes:
  git pull
  (no npm install needed unless package.json changed)


================================================================================
END OF README
================================================================================
