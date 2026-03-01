#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@le-space.de}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/simple-todo-two-location}"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-https://simple-todo.le-space.de}"
ORCH_TOPIC_PREFIX="${ORCH_TOPIC_PREFIX:-orchestrator}"
RUN_ID="${RUN_ID:-$(node -e "console.log(crypto.randomUUID())")}"
RELAY_BOOTSTRAP_ADDR="${RELAY_BOOTSTRAP_ADDR:-}"

echo "RUN_ID=$RUN_ID"
echo "Installing remote workspace on $REMOTE_HOST:$REMOTE_DIR ..."
REMOTE_HOST="$REMOTE_HOST" REMOTE_DIR="$REMOTE_DIR" scripts/two-location/remote-install.sh

echo "Starting remote bob role ..."
REMOTE_BOB_CMD="set -euo pipefail; cd '$REMOTE_DIR'; ROLE='bob' RUN_ID='$RUN_ID' PUBLIC_APP_URL='$PUBLIC_APP_URL' ORCH_TOPIC_PREFIX='$ORCH_TOPIC_PREFIX'"
if [[ -n "$RELAY_BOOTSTRAP_ADDR" ]]; then
	REMOTE_BOB_CMD="$REMOTE_BOB_CMD VITE_RELAY_BOOTSTRAP_ADDR_DEV='$RELAY_BOOTSTRAP_ADDR'"
fi
REMOTE_BOB_CMD="$REMOTE_BOB_CMD nohup npm run test:e2e:two-location -- e2e/two-location.spec.js > /tmp/simple-todo-two-location-bob-$RUN_ID.log 2>&1 & echo \$! > /tmp/simple-todo-two-location-bob-$RUN_ID.pid"
ssh "$REMOTE_HOST" "$REMOTE_BOB_CMD"

cleanup() {
	echo "Fetching remote bob log tail ..."
	ssh "$REMOTE_HOST" "tail -n 160 /tmp/simple-todo-two-location-bob-$RUN_ID.log || true"
}
trap cleanup EXIT

echo "Running local alice role ..."
LOCAL_CMD=(npm run test:e2e:two-location -- e2e/two-location.spec.js)
ROLE=alice RUN_ID="$RUN_ID" PUBLIC_APP_URL="$PUBLIC_APP_URL" ORCH_TOPIC_PREFIX="$ORCH_TOPIC_PREFIX" VITE_RELAY_BOOTSTRAP_ADDR_DEV="$RELAY_BOOTSTRAP_ADDR" "${LOCAL_CMD[@]}"
echo "Done. Remote log file: /tmp/simple-todo-two-location-bob-$RUN_ID.log"
