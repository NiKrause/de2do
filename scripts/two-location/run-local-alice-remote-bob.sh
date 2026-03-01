#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@le-space.de}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/simple-todo-two-location}"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-https://simple-todo.le-space.de}"
ORCH_TOPIC_PREFIX="${ORCH_TOPIC_PREFIX:-orchestrator}"
ORCH_TOPIC="${ORCH_TOPIC:-todo._peer-discovery._p2p._pubsub}"
RUN_ID="${RUN_ID:-$(node -e "console.log(crypto.randomUUID())")}"
RELAY_BOOTSTRAP_ADDR="${RELAY_BOOTSTRAP_ADDR:-}"
RELAY_MULTIADDRS_URL="${RELAY_MULTIADDRS_URL:-http://le-space.de:9090/multiaddrs}"

resolve_bootstrap_addr() {
	if [[ -n "$RELAY_BOOTSTRAP_ADDR" ]]; then
		echo "$RELAY_BOOTSTRAP_ADDR"
		return 0
	fi

	local json
	if ! json="$(curl -fsS "$RELAY_MULTIADDRS_URL")"; then
		return 1
	fi

	local resolved
	resolved="$(
		node -e "
const data = JSON.parse(process.argv[1]);
const all = Array.isArray(data?.all) ? data.all : [];
const bestWebrtc = data?.best?.webrtc || '';
const firstWebrtc = all.find((a) => String(a).includes('/webrtc-direct/')) || '';
const firstWss = data?.best?.websocket || '';
const pick = bestWebrtc || firstWebrtc || firstWss || '';
if (!pick) process.exit(1);
process.stdout.write(pick);
" "$json" 2>/dev/null
	)" || return 1

	echo "$resolved"
}

if RELAY_BOOTSTRAP_ADDR="$(resolve_bootstrap_addr)"; then
	echo "Using relay bootstrap: $RELAY_BOOTSTRAP_ADDR"
else
	echo "Warning: failed to resolve relay bootstrap from $RELAY_MULTIADDRS_URL, continuing with app defaults"
	RELAY_BOOTSTRAP_ADDR=""
fi

echo "RUN_ID=$RUN_ID"
echo "Installing remote workspace on $REMOTE_HOST:$REMOTE_DIR ..."
REMOTE_HOST="$REMOTE_HOST" REMOTE_DIR="$REMOTE_DIR" scripts/two-location/remote-install.sh

echo "Starting remote bob role ..."
REMOTE_BOB_CMD="set -euo pipefail; cd '$REMOTE_DIR'; ROLE='bob' RUN_ID='$RUN_ID' PUBLIC_APP_URL='$PUBLIC_APP_URL' ORCH_TOPIC_PREFIX='$ORCH_TOPIC_PREFIX' ORCH_TOPIC='$ORCH_TOPIC'"
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
ROLE=alice RUN_ID="$RUN_ID" PUBLIC_APP_URL="$PUBLIC_APP_URL" ORCH_TOPIC_PREFIX="$ORCH_TOPIC_PREFIX" ORCH_TOPIC="$ORCH_TOPIC" VITE_RELAY_BOOTSTRAP_ADDR_DEV="$RELAY_BOOTSTRAP_ADDR" "${LOCAL_CMD[@]}"
echo "Done. Remote log file: /tmp/simple-todo-two-location-bob-$RUN_ID.log"
