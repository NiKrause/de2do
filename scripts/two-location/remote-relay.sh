#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
if [[ -z "$ACTION" ]]; then
	echo "Usage: $0 <start|stop|status|multiaddrs>"
	exit 1
fi

REMOTE_HOST="${REMOTE_HOST:-root@le-space.de}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/simple-todo-two-location}"
REMOTE_RELAY_INSTANCE="${REMOTE_RELAY_INSTANCE:-two-location}"
REMOTE_RELAY_IMPL="${REMOTE_RELAY_IMPL:-pinner}"
REMOTE_RELAY_TCP_PORT="${REMOTE_RELAY_TCP_PORT:-19101}"
REMOTE_RELAY_WS_PORT="${REMOTE_RELAY_WS_PORT:-19102}"
REMOTE_RELAY_WEBRTC_PORT="${REMOTE_RELAY_WEBRTC_PORT:-19103}"
REMOTE_RELAY_WEBRTC_DIRECT_PORT="${REMOTE_RELAY_WEBRTC_DIRECT_PORT:-19106}"
REMOTE_RELAY_HTTP_PORT="${REMOTE_RELAY_HTTP_PORT:-19090}"
REMOTE_RELAY_DATASTORE_PATH="${REMOTE_RELAY_DATASTORE_PATH:-/tmp/simple-todo-two-location-relay-${REMOTE_RELAY_INSTANCE}-datastore}"
REMOTE_RELAY_PID_FILE="${REMOTE_RELAY_PID_FILE:-/tmp/simple-todo-two-location-relay-${REMOTE_RELAY_INSTANCE}.pid}"
REMOTE_RELAY_LOG_FILE="${REMOTE_RELAY_LOG_FILE:-/tmp/simple-todo-two-location-relay-${REMOTE_RELAY_INSTANCE}.log}"
REMOTE_RELAY_START_TIMEOUT_SEC="${REMOTE_RELAY_START_TIMEOUT_SEC:-40}"

start_relay() {
	if [[ "$REMOTE_RELAY_IMPL" != "pinner" ]]; then
		echo "REMOTE_RELAY_IMPL='$REMOTE_RELAY_IMPL' is not supported (removed relay/ tree). Use REMOTE_RELAY_IMPL=pinner (default)."
		exit 1
	fi

	ssh "$REMOTE_HOST" "set -euo pipefail;
cd '$REMOTE_DIR';
if [[ -f '$REMOTE_RELAY_PID_FILE' ]] && kill -0 \"\$(cat '$REMOTE_RELAY_PID_FILE')\" 2>/dev/null; then
  echo 'Relay already running (pid '\"\$(cat '$REMOTE_RELAY_PID_FILE')\"')';
  exit 0;
fi;
rm -f '$REMOTE_RELAY_PID_FILE';
nohup env \
  RELAY_TCP_PORT='$REMOTE_RELAY_TCP_PORT' \
  RELAY_WS_PORT='$REMOTE_RELAY_WS_PORT' \
  RELAY_WEBRTC_PORT='$REMOTE_RELAY_WEBRTC_PORT' \
  RELAY_WEBRTC_DIRECT_PORT='$REMOTE_RELAY_WEBRTC_DIRECT_PORT' \
  HTTP_PORT='$REMOTE_RELAY_HTTP_PORT' \
  DATASTORE_PATH='$REMOTE_RELAY_DATASTORE_PATH' \
  ./node_modules/.bin/orbitdb-relay-pinner --test \
  > '$REMOTE_RELAY_LOG_FILE' 2>&1 &
echo \$! > '$REMOTE_RELAY_PID_FILE'"

	local i
	for ((i = 0; i < REMOTE_RELAY_START_TIMEOUT_SEC; i++)); do
		if ssh "$REMOTE_HOST" "curl -fsS 'http://127.0.0.1:$REMOTE_RELAY_HTTP_PORT/multiaddrs' >/dev/null 2>&1"; then
			echo "Dedicated remote relay is healthy on $REMOTE_HOST (orbitdb-relay-pinner, http:$REMOTE_RELAY_HTTP_PORT, pid $(ssh "$REMOTE_HOST" "cat '$REMOTE_RELAY_PID_FILE'"))"
			return 0
		fi
		if ssh "$REMOTE_HOST" "test -f '$REMOTE_RELAY_PID_FILE' && kill -0 \$(cat '$REMOTE_RELAY_PID_FILE') 2>/dev/null && grep -q \"p2p addr:\" '$REMOTE_RELAY_LOG_FILE'"; then
			echo "Dedicated remote relay is healthy on $REMOTE_HOST (log shows p2p addr, pid $(ssh "$REMOTE_HOST" "cat '$REMOTE_RELAY_PID_FILE'"))"
			return 0
		fi
		sleep 1
	done

	echo "Relay did not become healthy within ${REMOTE_RELAY_START_TIMEOUT_SEC}s. Last log lines:"
	ssh "$REMOTE_HOST" "tail -n 120 '$REMOTE_RELAY_LOG_FILE' || true"
	return 1
}

stop_relay() {
	ssh "$REMOTE_HOST" "set -euo pipefail;
if [[ -f '$REMOTE_RELAY_PID_FILE' ]]; then
  pid=\$(cat '$REMOTE_RELAY_PID_FILE');
  kill \"\$pid\" 2>/dev/null || true;
  rm -f '$REMOTE_RELAY_PID_FILE';
  echo \"Stopped relay pid \$pid\";
else
  echo 'No relay pid file found';
fi"
}

status_relay() {
	ssh "$REMOTE_HOST" "set -euo pipefail;
if [[ -f '$REMOTE_RELAY_PID_FILE' ]] && kill -0 \"\$(cat '$REMOTE_RELAY_PID_FILE')\" 2>/dev/null; then
  echo \"running pid=\$(cat '$REMOTE_RELAY_PID_FILE')\";
else
  echo 'not-running';
fi"
}

multiaddrs_relay() {
	if out="$(ssh "$REMOTE_HOST" "curl -fsS 'http://127.0.0.1:$REMOTE_RELAY_HTTP_PORT/multiaddrs' 2>/dev/null")" && [[ -n "$out" ]]; then
		echo "$out"
		return 0
	fi

	# Fallback: parse addresses from relay logs if HTTP is not up yet.
	local lines
	lines="$(
		ssh "$REMOTE_HOST" "tail -n 220 '$REMOTE_RELAY_LOG_FILE' | grep -Eo \"'/[^']+'\" | tr -d \"'\""
	)"

	if [[ -z "$lines" ]]; then
		return 1
	fi

	node -e "
const lines = process.argv[1].split('\n').map((s) => s.trim()).filter(Boolean);
const list = [...new Set(lines.filter((a) => a.startsWith('/')))];
const bestWebrtc = list.find((a) => a.includes('/webrtc-direct/')) || null;
const bestWs = list.find((a) => a.includes('/ws/')) || null;
const bestTcp = list.find((a) => a.includes('/tcp/') && !a.includes('/ws/')) || null;
const peerId = (bestWebrtc || bestWs || bestTcp || list[0] || '').split('/p2p/')[1] || null;
const out = { peerId, all: list, best: { webrtc: bestWebrtc, websocket: bestWs, tcp: bestTcp } };
process.stdout.write(JSON.stringify(out));
" "$lines"
}

case "$ACTION" in
start)
	start_relay
	;;
stop)
	stop_relay
	;;
status)
	status_relay
	;;
multiaddrs)
	multiaddrs_relay
	;;
*)
	echo "Unknown action: $ACTION"
	exit 1
	;;
esac
