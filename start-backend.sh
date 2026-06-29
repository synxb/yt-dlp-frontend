#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting YT-DLP Frontend Backend..."
cd "$SCRIPT_DIR/backend"

# Activate virtual environment if present
if [ -f "$SCRIPT_DIR/.venv/bin/activate" ]; then
    source "$SCRIPT_DIR/.venv/bin/activate"
elif [ -f "$SCRIPT_DIR/venv/bin/activate" ]; then
    source "$SCRIPT_DIR/venv/bin/activate"
fi

# Public base URL of the deployed service — used for the Google OAuth redirect.
# Comment this out (or set to empty) when running this script for local dev.
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://ytdlp.lan.hackinginstyle.com}"

# Ensure the Deno JS runtime (used by yt-dlp's EJS challenge solver) is on PATH.
# Deno's default install location is ~/.deno/bin.
if [ -d "$HOME/.deno/bin" ]; then
    export PATH="$HOME/.deno/bin:$PATH"
fi

python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
