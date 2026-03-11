# Two-Location E2E (Alice/Bob via Gossipsub)

This setup runs `alice` and `bob` on different hosts and coordinates them via a dedicated libp2p gossipsub topic:

- topic: `orchestrator/<RUN_ID>/v1`
- states: `ready`, `start`, `db_published`, `verified`, `failed`

## Environment

- `ROLE=alice|bob`
- `RUN_ID=<uuid>`
- `PUBLIC_APP_URL=<app url>` (default: `https://simple-todo.le-space.de`)
- `ORCH_TOPIC_PREFIX=<prefix>` (default: `orchestrator`)
- optional `RELAY_MULTIADDRS_URL=<relay /multiaddrs url>` (default: `http://le-space.de:9090/multiaddrs`)
- optional `RELAY_BOOTSTRAP_ADDR=<multiaddr>` (overrides auto-discovery)
- optional `USE_DEDICATED_REMOTE_RELAY=1|0` (default: `0`; uses production/public relay)
- optional `REMOTE_RELAY_PUBLIC_HOST=<dns host>` (default: `le-space.de`)
- optional `REMOTE_RELAY_IMPL=pinner|enhanced` (default: `pinner` in dedicated relay helper)

## New test command

```bash
npm run test:e2e:two-location -- e2e/two-location.spec.js
```

## Install and run on remote `/tmp` host

```bash
REMOTE_HOST=root@le-space.de REMOTE_DIR=/tmp/simple-todo-two-location scripts/two-location/remote-install.sh
REMOTE_HOST=root@le-space.de REMOTE_DIR=/tmp/simple-todo-two-location scripts/two-location/remote-run-role.sh bob <run-id>
```

## One-command local alice + remote bob

```bash
scripts/two-location/run-local-alice-remote-bob.sh
```

This script:

1. installs repo on `le-space.de:/tmp/simple-todo-two-location`
2. optionally starts a dedicated remote relay on separate ports/peerId (only when `USE_DEDICATED_REMOTE_RELAY=1`)
3. starts remote `bob`
4. runs local `alice`
5. tails remote log from `/tmp/simple-todo-two-location-bob-<RUN_ID>.log`

By default it resolves production relay bootstrap from `/multiaddrs` and prefers `best.webrtc`
(`webrtc-direct` with `certhash`) before websocket fallback.
If dedicated relay mode is enabled, local Alice uses a public DNS bootstrap
address while remote Bob uses a local relay address on the same host.

## Dedicated relay control

```bash
REMOTE_HOST=root@le-space.de REMOTE_DIR=/tmp/simple-todo-two-location scripts/two-location/remote-relay.sh start
REMOTE_HOST=root@le-space.de REMOTE_DIR=/tmp/simple-todo-two-location scripts/two-location/remote-relay.sh status
REMOTE_HOST=root@le-space.de REMOTE_DIR=/tmp/simple-todo-two-location scripts/two-location/remote-relay.sh multiaddrs
REMOTE_HOST=root@le-space.de REMOTE_DIR=/tmp/simple-todo-two-location scripts/two-location/remote-relay.sh stop
```

## Artifacts

Timeline artifacts are written to:

`test-results/two-location/<RUN_ID>-<ROLE>-timeline.json`
