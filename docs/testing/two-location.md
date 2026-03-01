# Two-Location E2E (Alice/Bob via Gossipsub)

This setup runs `alice` and `bob` on different hosts and coordinates them via a dedicated libp2p gossipsub topic:

- topic: `orchestrator/<RUN_ID>/v1`
- states: `ready`, `start`, `db_published`, `verified`, `failed`

## Environment

- `ROLE=alice|bob`
- `RUN_ID=<uuid>`
- `PUBLIC_APP_URL=<app url>` (default: `https://simple-todo.le-space.de`)
- `ORCH_TOPIC_PREFIX=<prefix>` (default: `orchestrator`)
- optional `VITE_RELAY_BOOTSTRAP_ADDR_DEV=<multiaddr>`

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
2. starts remote `bob`
3. runs local `alice`
4. tails remote log from `/tmp/simple-todo-two-location-bob-<RUN_ID>.log`

## Artifacts

Timeline artifacts are written to:

`test-results/two-location/<RUN_ID>-<ROLE>-timeline.json`
