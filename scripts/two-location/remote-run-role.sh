#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
	echo "Usage: $0 <role:alice|bob> <run-id>"
	exit 1
fi

ROLE="$1"
RUN_ID="$2"
REMOTE_HOST="${REMOTE_HOST:-root@le-space.de}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/simple-todo-two-location}"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-https://simple-todo.le-space.de}"
ORCH_TOPIC_PREFIX="${ORCH_TOPIC_PREFIX:-orchestrator}"
ORCH_TOPIC="${ORCH_TOPIC:-todo._peer-discovery._p2p._pubsub}"
RELAY_BOOTSTRAP_ADDR="${RELAY_BOOTSTRAP_ADDR:-}"
RELAY_MULTIADDRS_URL="${RELAY_MULTIADDRS_URL:-http://le-space.de:9090/multiaddrs}"

if [[ -z "$RELAY_BOOTSTRAP_ADDR" ]]; then
	RELAY_BOOTSTRAP_ADDR="$(
		curl -fsS "$RELAY_MULTIADDRS_URL" | node -e '
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const all = Array.isArray(data?.all) ? data.all : [];
  const bestWebrtc = data?.best?.webrtc || "";
  const firstWebrtc = all.find((a) => String(a).includes("/webrtc-direct/")) || "";
  const firstWss = data?.best?.websocket || "";
  const pick = bestWebrtc || firstWebrtc || firstWss || "";
  if (!pick) process.exit(1);
  process.stdout.write(pick);
});
' 2>/dev/null
	)" || true
fi

if [[ -n "$RELAY_BOOTSTRAP_ADDR" ]]; then
	echo "Using relay bootstrap: $RELAY_BOOTSTRAP_ADDR"
fi

REMOTE_CMD="set -euo pipefail; cd '$REMOTE_DIR'; ROLE='$ROLE' RUN_ID='$RUN_ID' PUBLIC_APP_URL='$PUBLIC_APP_URL' ORCH_TOPIC_PREFIX='$ORCH_TOPIC_PREFIX' ORCH_TOPIC='$ORCH_TOPIC'"
if [[ -n "$RELAY_BOOTSTRAP_ADDR" ]]; then
	REMOTE_CMD="$REMOTE_CMD VITE_RELAY_BOOTSTRAP_ADDR_DEV='$RELAY_BOOTSTRAP_ADDR'"
fi
REMOTE_CMD="$REMOTE_CMD npm run test:e2e:two-location -- e2e/two-location.spec.js"

ssh "$REMOTE_HOST" "$REMOTE_CMD"
