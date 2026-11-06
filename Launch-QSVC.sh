#!/usr/bin/env bash
# ==============================================================================
# QS-VC Auto-Launcher for Linux Desktops (Double-Clickable / Executable)
# Automatically checks prerequisites, database, migrations, and opens browser.
# ==============================================================================
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=================================================="
echo "          Starting QS-VC Platform                 "
echo "=================================================="

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is required to run QS-VC."
    if command -v zenity >/dev/null 2>&1; then
        zenity --error --text="Node.js is required. Please install Node.js (v20+) from https://nodejs.org"
    fi
    exit 1
fi

node start-intranet.js

