#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@le-space.de}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/simple-todo-two-location}"
REPO_URL="${REPO_URL:-https://github.com/NiKrause/simple-todo.git}"
BRANCH="${BRANCH:-main}"

ssh "$REMOTE_HOST" "set -euo pipefail; rm -rf '$REMOTE_DIR'; git clone --depth=1 --branch '$BRANCH' '$REPO_URL' '$REMOTE_DIR'; cd '$REMOTE_DIR'; npm ci"

echo "Remote install completed in $REMOTE_HOST:$REMOTE_DIR"
