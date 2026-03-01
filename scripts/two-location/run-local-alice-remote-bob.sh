#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@le-space.de}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/simple-todo-two-location}"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-https://simple-todo.le-space.de}"
ORCH_TOPIC_PREFIX="${ORCH_TOPIC_PREFIX:-orchestrator}"
ORCH_TOPIC="${ORCH_TOPIC:-todo._peer-discovery._p2p._pubsub}"
RUN_ID="${RUN_ID:-$(node -e "console.log(crypto.randomUUID())")}"
RELAY_BOOTSTRAP_ADDR="${RELAY_BOOTSTRAP_ADDR:-}"
REMOTE_BOB_BOOTSTRAP_ADDR="${REMOTE_BOB_BOOTSTRAP_ADDR:-}"
RELAY_MULTIADDRS_URL="${RELAY_MULTIADDRS_URL:-http://le-space.de:9090/multiaddrs}"
USE_DEDICATED_REMOTE_RELAY="${USE_DEDICATED_REMOTE_RELAY:-1}"
REMOTE_RELAY_PUBLIC_HOST="${REMOTE_RELAY_PUBLIC_HOST:-le-space.de}"
STOP_DEDICATED_REMOTE_RELAY_ON_EXIT="${STOP_DEDICATED_REMOTE_RELAY_ON_EXIT:-1}"
REMOTE_RELAY_STARTED=0
RELAY_BOOTSTRAP_ADDR_RESOLVED=""

resolve_bootstrap_addr() {
	if [[ -n "$RELAY_BOOTSTRAP_ADDR" ]]; then
		if [[ -z "$REMOTE_BOB_BOOTSTRAP_ADDR" ]]; then
			REMOTE_BOB_BOOTSTRAP_ADDR="$RELAY_BOOTSTRAP_ADDR"
		fi
		RELAY_BOOTSTRAP_ADDR_RESOLVED="$RELAY_BOOTSTRAP_ADDR"
		return 0
	fi

	local json
	if [[ "$USE_DEDICATED_REMOTE_RELAY" == "1" ]]; then
		if ! json="$(REMOTE_HOST="$REMOTE_HOST" REMOTE_DIR="$REMOTE_DIR" scripts/two-location/remote-relay.sh multiaddrs)"; then
			return 1
		fi
	else
		if ! json="$(curl -fsS "$RELAY_MULTIADDRS_URL")"; then
			return 1
		fi
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

	if [[ "$USE_DEDICATED_REMOTE_RELAY" == "1" ]]; then
		if [[ -z "$REMOTE_BOB_BOOTSTRAP_ADDR" ]]; then
			REMOTE_BOB_BOOTSTRAP_ADDR="$(
				node -e "
const data = JSON.parse(process.argv[1]);
const all = Array.isArray(data?.all) ? data.all : [];
const picks = [
  all.find((a) => String(a).includes('/webrtc-direct/') && String(a).includes('/ip4/127.0.0.1/')),
  all.find((a) => String(a).includes('/webrtc-direct/') && String(a).includes('/ip4/10.')),
  all.find((a) => String(a).includes('/webrtc-direct/')),
  all.find((a) => String(a).includes('/ws/') && String(a).includes('/ip4/127.0.0.1/')),
  all.find((a) => String(a).includes('/ws/'))
].filter(Boolean);
if (picks[0]) process.stdout.write(picks[0]);
" "$json" 2>/dev/null || true
			)"
		fi

		resolved="$(
			node -e "
const addr = process.argv[1];
const host = process.argv[2];
if (String(addr).includes('/webrtc-direct/')) {
  const rewritten = String(addr).replace(/^\/ip4\/(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|[0-9.]+)\/udp\//, '/dns4/' + host + '/udp/');
  process.stdout.write(rewritten);
} else {
  process.stdout.write(String(addr).replace(/^\/ip4\/(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|[0-9.]+)\/tcp\//, '/dns4/' + host + '/tcp/'));
}
" "$resolved" "$REMOTE_RELAY_PUBLIC_HOST"
		)"
	fi

	RELAY_BOOTSTRAP_ADDR_RESOLVED="$resolved"
}

echo "RUN_ID=$RUN_ID"
echo "Installing remote workspace on $REMOTE_HOST:$REMOTE_DIR ..."
REMOTE_HOST="$REMOTE_HOST" REMOTE_DIR="$REMOTE_DIR" scripts/two-location/remote-install.sh

if [[ "$USE_DEDICATED_REMOTE_RELAY" == "1" ]]; then
	echo "Starting dedicated remote relay instance ..."
	REMOTE_HOST="$REMOTE_HOST" REMOTE_DIR="$REMOTE_DIR" scripts/two-location/remote-relay.sh start
	REMOTE_RELAY_STARTED=1
fi

if resolve_bootstrap_addr; then
	RELAY_BOOTSTRAP_ADDR="$RELAY_BOOTSTRAP_ADDR_RESOLVED"
	echo "Using relay bootstrap: $RELAY_BOOTSTRAP_ADDR"
	if [[ -n "$REMOTE_BOB_BOOTSTRAP_ADDR" ]]; then
		echo "Using remote bob bootstrap: $REMOTE_BOB_BOOTSTRAP_ADDR"
	fi
else
	echo "Warning: failed to resolve relay bootstrap, continuing with app defaults"
	RELAY_BOOTSTRAP_ADDR=""
fi

echo "Starting remote bob role ..."
REMOTE_BOB_CMD="set -euo pipefail; cd '$REMOTE_DIR'; ROLE='bob' RUN_ID='$RUN_ID' PUBLIC_APP_URL='$PUBLIC_APP_URL' ORCH_TOPIC_PREFIX='$ORCH_TOPIC_PREFIX' ORCH_TOPIC='$ORCH_TOPIC'"
REMOTE_BOOTSTRAP="${REMOTE_BOB_BOOTSTRAP_ADDR:-$RELAY_BOOTSTRAP_ADDR}"
if [[ -n "$REMOTE_BOOTSTRAP" ]]; then
	REMOTE_BOB_CMD="$REMOTE_BOB_CMD VITE_RELAY_BOOTSTRAP_ADDR_DEV='$REMOTE_BOOTSTRAP'"
fi
REMOTE_BOB_CMD="$REMOTE_BOB_CMD nohup npm run test:e2e:two-location -- e2e/two-location.spec.js > /tmp/simple-todo-two-location-bob-$RUN_ID.log 2>&1 & echo \$! > /tmp/simple-todo-two-location-bob-$RUN_ID.pid"
ssh "$REMOTE_HOST" "$REMOTE_BOB_CMD"

cleanup() {
	echo "Fetching remote bob log tail ..."
	ssh "$REMOTE_HOST" "tail -n 160 /tmp/simple-todo-two-location-bob-$RUN_ID.log || true"
	if [[ "$USE_DEDICATED_REMOTE_RELAY" == "1" && "$STOP_DEDICATED_REMOTE_RELAY_ON_EXIT" == "1" && "$REMOTE_RELAY_STARTED" == "1" ]]; then
		echo "Stopping dedicated remote relay ..."
		REMOTE_HOST="$REMOTE_HOST" REMOTE_DIR="$REMOTE_DIR" scripts/two-location/remote-relay.sh stop || true
	fi
}
trap cleanup EXIT

echo "Running local alice role ..."
LOCAL_CMD=(npm run test:e2e:two-location -- e2e/two-location.spec.js)
ROLE=alice RUN_ID="$RUN_ID" PUBLIC_APP_URL="$PUBLIC_APP_URL" ORCH_TOPIC_PREFIX="$ORCH_TOPIC_PREFIX" ORCH_TOPIC="$ORCH_TOPIC" VITE_RELAY_BOOTSTRAP_ADDR_DEV="$RELAY_BOOTSTRAP_ADDR" "${LOCAL_CMD[@]}"
echo "Done. Remote log file: /tmp/simple-todo-two-location-bob-$RUN_ID.log"
