#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting YT-DLP Frontend..."
cd "$SCRIPT_DIR/frontend"
npm run dev
