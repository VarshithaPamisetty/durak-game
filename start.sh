#!/usr/bin/env bash
# Convenience launcher that finds Node (handles nvm setups where node isn't on PATH).
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  if [ -d "$HOME/.nvm/versions/node" ]; then
    LATEST=$(ls "$HOME/.nvm/versions/node" | sort -V | tail -1)
    export PATH="$HOME/.nvm/versions/node/$LATEST/bin:$PATH"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install Node 18+ and try again." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install --no-fund --no-audit
fi

echo "Starting Durak on http://localhost:${PORT:-3000}"
exec node server/server.js
