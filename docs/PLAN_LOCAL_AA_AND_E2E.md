# Plan: Local AA (EntryPoint v0.8) + E2E (future)

This document is the **implementation roadmap** for a reproducible local dev/test stack aligned with **`docs/HOWTO_PASSKEY_ESCROW.md`**.

## Canonical choices (locked for this repo)

| Topic                 | Choice                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EntryPoint            | **v0.8** `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`                                                                                                                                                     |
| Bundler               | **Pimlico Alto** via `docker-compose.aa-local.yml`                                                                                                                                                        |
| Chain (local)         | **Anvil** `31337` on host `8545`                                                                                                                                                                          |
| App env (dev)         | `.env.development` (template: **`.env.development.example`**)                                                                                                                                             |
| App env (E2E preview) | `.env.test` + `pnpm run build:test` then **`pnpm run preview:test`** (static **`sirv build`** on `127.0.0.1:4174`; avoid `vite preview` after adapter-static when `.svelte-kit/output/client` is missing) |

`alto-config.json` may list multiple entrypoints; the **app and Foundry deploy** must use **v0.8** only.

---

## Phase 0 — Documentation & env wiring (done / baseline)

- [x] HOWTO updated for v0.8 only (bundler check, `cast code`, `VITE_*`, forge `ENTRY_POINT_ADDRESS`).
- [x] `.env.development.example` and `.env.test.example` at repo root.
- [x] `build:test` (`vite build --mode test`) + `preview:test` + Playwright `webServer` runs both so **`VITE_*` from `.env.test` are compiled into the client bundle** (Vite inlines env at build, not preview-only).
- [x] **`pnpm run setup:local-aa`** — `scripts/setup-local-aa.mjs`: Anvil RPC → Docker AA stack → forge deploys three app contracts → merge **`broadcast/.../run-latest.json`** into `.env.development` (see HOWTO §F).

---

## Phase 1 — Human smoke test (local)

1. `anvil` → `docker compose -f docker-compose.aa-local.yml up -d`
2. Watch `docker compose ... logs -f contract-deployer alto` until deployer exits **0** and Alto listens on **4337**.
3. `curl eth_supportedEntryPoints` → confirm **v0.8** present.
4. `export ENTRY_POINT_ADDRESS=0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` + deploy MockOpenfort7702, Escrow, MockUSDT (`HOWTO` §1B).
5. Fill `.env.development`, `pnpm dev`, run passkey wallet + one escrow action.

---

## Phase 2 — E2E infrastructure (no Alice/Bob yet)

1. **CI script** (or documented Makefile): start Anvil + compose + wait for RPC + bundler JSON-RPC.
2. **`.env.test` in CI**: copy from `.env.test.example`, inject addresses from `broadcast/*/run-latest.json` (script) or fixed fixture.
3. **Playwright `global-setup`**: optional health `curl` to bundler + `cast code` EntryPoint v0.8 (fail fast).
4. **Passkey-escrow suite:** relay on **3001** (`e2e/start-passkey-escrow-relay.mjs`) so **3000** stays free for mock-paymaster in `docker-compose.aa-local.yml`.

**Implemented:** `playwright.passkey-escrow.config.js` + `e2e/global-setup-passkey-escrow.mjs` runs `node scripts/setup-local-aa.mjs --env-file .env.test --start-anvil --write-anvil-pid`, merges relay + funder into `.env.test`, then `npm run build:test && preview:test`. Run: `pnpm run test:e2e:passkey-escrow`. Skip AA stack: `E2E_SKIP_LOCAL_AA_SETUP=1` (relay still starts; you manage Anvil/docker/forge).

---

## Phase 3 — E2E: Alice & Bob (incremental)

**Goal:** two browser contexts, virtual WebAuthn (Chromium), shared Anvil, relay for P2P completion.

| Step | Scope                                                                             |
| ---- | --------------------------------------------------------------------------------- |
| 3a   | Single context: virtual authenticator + create smart account + assert UI address  |
| 3b   | Fund account (funder key or `cast` in setup) + assert balance in UI               |
| 3c   | Second context as Bob: separate storage, passkey, DID + wallet field              |
| 3d   | Alice: delegated todo + lock escrow; Bob: mark complete (P2P); Alice: confirm pay |
| 3e   | Assert USDT/ETH balances (UI or RPC from test)                                    |

**Implemented (passkey + ETH path):** `e2e/passkey-wallet-escrow.spec.js` — order: **Lock → Bob completes → Confirm & Pay**; Bob beneficiary fixed Anvil EOA `0x3C44…93BC`; balance assert via `eth_getBalance`.

**Risks:** flakiness (P2P sync), WebAuthn prompts, long timeouts. Mitigations: `data-testid`s, generous waits, optional test-only hooks.

---

## Phase 4 — Hardening

- Pin Docker images or digests for `alto` / `mock-contract-deployer`.
- Optional Anvil state dump after deploy for faster CI.
- Sepolia parity checklist (separate env file; same v0.8 + implementation addresses from provider docs).

---

## References

- `docker-compose.aa-local.yml` — Alto + contract-deployer
- `alto-config.json` — bundler entrypoint list (must include v0.8)
- `contracts/script/DeployMockOpenfort7702Implementation.s.sol` — requires `ENTRY_POINT_ADDRESS` v0.8
- `src/lib/wallet/openfort/const.js` — `ENTRY_POINT_VERSION = '0.8'`
