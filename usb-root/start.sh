#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================"
echo "  Portable LLM Agent - USB Runtime"
echo "============================================"
echo ""

# Detect platform and locate portable Node binary
if [[ "${OSTYPE:-}" == "darwin"* ]]; then
    PLATFORM="mac"
    NODE_BIN="$SCRIPT_DIR/node/mac/node"
    OPEN_CMD="open"
elif [[ "${OSTYPE:-}" == "linux"* || "${OSTYPE:-}" == "linux-gnu"* ]]; then
    PLATFORM="linux"
    NODE_BIN="$SCRIPT_DIR/node/linux/node"
    OPEN_CMD="xdg-open"
else
    PLATFORM="linux"
    NODE_BIN="$SCRIPT_DIR/node/linux/node"
    OPEN_CMD="xdg-open"
fi

# Fall back to system Node if portable binary not present
if [ ! -f "$NODE_BIN" ]; then
    echo "WARNING: Portable Node not found at $NODE_BIN"
    echo "Falling back to system Node.js..."
    if command -v node &>/dev/null; then
        NODE_BIN="$(command -v node)"
        echo "Using system node: $NODE_BIN"
    else
        echo "ERROR: No Node.js found."
        echo "Install Node.js or place a portable binary at:"
        echo "  $SCRIPT_DIR/node/mac/node   (macOS)"
        echo "  $SCRIPT_DIR/node/linux/node (Linux)"
        exit 1
    fi
fi

# Ensure node_modules are installed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "node_modules not found. Running npm install..."
    cd "$SCRIPT_DIR"
    npm install
    cd - >/dev/null
fi

echo "[1/3] Scanning for phone LLM server on 192.168.43.x:11434..."
if ! "$NODE_BIN" "$SCRIPT_DIR/find_phone.js"; then
    echo ""
    echo "Phone not found. You can manually edit bridge/config.json with the phone IP."
    echo "Then run: ./start.sh"
    echo ""
    read -r -p "Press Enter to continue anyway (bridge will use last known IP)..."
fi

echo ""
echo "[2/3] Starting bridge server on port 3000..."
"$NODE_BIN" "$SCRIPT_DIR/bridge/bridge.js" &
BRIDGE_PID=$!
echo "Bridge PID: $BRIDGE_PID"

sleep 2

echo "[3/3] Starting PC runtime on port 3001..."
"$NODE_BIN" "$SCRIPT_DIR/runtime/server.js" &
RUNTIME_PID=$!
echo "Runtime PID: $RUNTIME_PID"

sleep 1

echo ""
echo "============================================"
echo "  Running!"
echo "  Bridge:  http://localhost:3000"
echo "  Runtime: http://localhost:3001"
echo "  Press Ctrl+C to stop all processes."
echo "============================================"
echo ""

# Open browser
"$OPEN_CMD" "http://localhost:3000" &>/dev/null || true

cleanup() {
    echo ""
    echo "Stopping processes..."
    kill "$BRIDGE_PID" 2>/dev/null || true
    kill "$RUNTIME_PID" 2>/dev/null || true
    wait "$BRIDGE_PID" 2>/dev/null || true
    wait "$RUNTIME_PID" 2>/dev/null || true
    echo "Done."
    exit 0
}

trap cleanup INT TERM

wait
