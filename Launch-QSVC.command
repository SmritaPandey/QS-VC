#!/usr/bin/env bash
# ==============================================================================
# QS-VC Auto-Launcher for macOS (Double-Clickable)
# Automatically checks prerequisites, database, migrations, and opens browser.
# ==============================================================================
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Ensure standard Node.js / Docker paths are in PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "=================================================="
echo "          Starting QS-VC Platform                 "
echo "=================================================="

if ! command -v node >/dev/null 2>&1; then
    osascript -e 'display alert "Node.js is Required" message "Please install Node.js (v20 or newer) from https://nodejs.org or run: brew install node"'
    exit 1
fi

node start-intranet.js

