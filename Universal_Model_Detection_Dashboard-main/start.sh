#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  ASNN Detection Dashboard — Setup & Start Script
#  Run this on your aarch64 device
# ═══════════════════════════════════════════════════════════

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       ASNN Detection Dashboard Setup             ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Check Node.js ────────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo "[!] Node.js not found. Installing via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

NODE_VER=$(node --version)
echo "[✓] Node.js: $NODE_VER"

# ── Install npm dependencies ─────────────────────────────
if [ ! -d "node_modules" ]; then
    echo "[*] Installing dependencies..."
    npm install
    echo "[✓] Dependencies installed"
else
    echo "[✓] Dependencies already installed"
fi

# ── Create models directory structure (demo) ─────────────
mkdir -p models uploads public

# If no models yet, create placeholder info
if [ -z "$(ls -A models 2>/dev/null)" ]; then
    echo ""
    echo "[!] No models found in ./models/"
    echo "    Create subdirectories like: ./models/car/"
    echo "    Each must contain: <name>.nb, libnn_<name>.so, data.yaml"
    echo ""
fi

# ── Parse args ───────────────────────────────────────────
PORT=${PORT:-8080}
MODELS_DIR=${MODELS_DIR:-"$SCRIPT_DIR/models"}
DETECT_SCRIPT=${DETECT_SCRIPT:-"$SCRIPT_DIR/detect.py"}

# ── Print network info ───────────────────────────────────
echo ""
echo "Network interfaces:"
if command -v hostname &>/dev/null; then
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' | while read ip; do
        echo "   http://$ip:$PORT"
    done || true
fi
echo ""

# ── Start server ─────────────────────────────────────────
echo "[*] Starting dashboard on port $PORT..."
echo "[*] Models directory: $MODELS_DIR"
echo "[*] Detect script:    $DETECT_SCRIPT"
echo ""

PORT="$PORT" \
MODELS_DIR="$MODELS_DIR" \
DETECT_SCRIPT="$DETECT_SCRIPT" \
node server.js
