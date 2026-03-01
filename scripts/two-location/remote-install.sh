#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@le-space.de}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/simple-todo-two-location}"
REPO_URL="${REPO_URL:-https://github.com/NiKrause/simple-todo.git}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"

ssh "$REMOTE_HOST" "set -euo pipefail; rm -rf '$REMOTE_DIR'; git clone --depth=1 --branch '$BRANCH' '$REPO_URL' '$REMOTE_DIR'; cd '$REMOTE_DIR'; npm install -g npm@11.10.1; if ! npm ci; then echo 'npm ci failed (likely lock mismatch), falling back to npm install'; npm install -g yarn; npm install --no-audit; fi; cd relay; if ! npm ci; then echo 'relay npm ci failed, falling back to npm install'; npm install --no-audit; fi; cd ..; npx playwright install --with-deps chromium"

echo "Remote install completed in $REMOTE_HOST:$REMOTE_DIR (branch: $BRANCH)"
