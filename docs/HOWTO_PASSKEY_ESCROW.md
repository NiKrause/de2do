# Passkey Escrow How-To (Sepolia + Mainnet)

This guide covers:

- Local testing with Anvil (Foundry)
- Sepolia testing
- Mainnet deployment
- Required environment configuration
- Running the escrow flow end-to-end

## Prerequisites

- Node.js 18+ (for the Svelte app)
- A bundler + entry point for passkey smart accounts
- A WebAuthn-capable browser (Chrome/Safari/Edge)
  - If you use EIP-7702 accounts, you still need a bundler for UserOperations

> NOTE: The escrow contract **does not** verify WebAuthn signatures on-chain. It relies on your passkey smart account to sign and submit transactions.

---

## Local v0.8 Checklist (Host Anvil + Docker Bundler)

**This repo standardizes on ERC-4337 EntryPoint v0.8** for local passkey / 7702 smart accounts (see `src/lib/wallet/openfort/const.js`: `ENTRY_POINT_VERSION = '0.8'`).

| Item                            | Value                                        |
| ------------------------------- | -------------------------------------------- |
| **EntryPoint v0.8 (canonical)** | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| Anvil (host)                    | `http://127.0.0.1:8545`                      |
| Alto bundler (Docker)           | `http://127.0.0.1:4337`                      |

`alto-config.json` may list additional entrypoints for tooling compatibility; **`VITE_ENTRY_POINT_ADDRESS` and `ENTRY_POINT_ADDRESS` for Foundry must still be the v0.8 address above.**

Phased roadmap (dev smoke → E2E Alice/Bob): see **`docs/PLAN_LOCAL_AA_AND_E2E.md`**.

### A) Fresh start order (prevents nonce drift)

```bash
cd /Users/nandi/Documents/projekte/DecentraSol/simple-todo
docker compose -f docker-compose.aa-local.yml down

# terminal 1
anvil

# terminal 2
docker compose -f docker-compose.aa-local.yml up -d
```

### B) Verify bundler EntryPoint support

```bash
curl -s http://127.0.0.1:4337 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}'
```

Expected (checksum casing may vary):

- Response **includes** `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` (EntryPoint **v0.8**).
- You may also see older entrypoints (e.g. v0.6) if `alto-config.json` lists them—that is OK; the app must still use **v0.8** in `VITE_ENTRY_POINT_ADDRESS`.
- If **v0.8** is missing, fix `alto-config.json` / redeploy via `docker-compose.aa-local.yml` (`contract-deployer` + `alto` logs) before debugging the UI.

### C) Verify required on-chain bytecode

```bash
cast code 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108 --rpc-url http://127.0.0.1:8545   # EntryPoint v0.8
cast code <IMPLEMENTATION_ADDRESS> --rpc-url http://127.0.0.1:8545                   # MockOpenfort7702Implementation
cast code <ESCROW_ADDRESS> --rpc-url http://127.0.0.1:8545                           # TodoEscrow
cast code <USDT_ADDRESS> --rpc-url http://127.0.0.1:8545                             # MockUSDT (if used)
```

Expected:

- Non-`0x` output means contract code exists
- `0x` means not deployed on this Anvil instance

### D) Local env expectations

Copy **`.env.development.example`** (repo root) to `.env.development` and fill in deployed contract addresses, or set at least:

```bash
VITE_CHAIN_ID=31337
VITE_RPC_URL=http://127.0.0.1:8545
VITE_BUNDLER_URL=http://127.0.0.1:4337
VITE_ENTRY_POINT_ADDRESS=0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108
VITE_IMPLEMENTATION_CONTRACT=<DEPLOYED_MOCK_OPENFORT_7702_IMPLEMENTATION>
VITE_ESCROW_CONTRACT=<DEPLOYED_TODO_ESCROW_ADDRESS>
VITE_USDT_ADDRESS=<DEPLOYED_MOCK_USDT_ADDRESS>
VITE_ENABLE_PAYMASTER=false
```

Important:

- `VITE_IMPLEMENTATION_CONTRACT` must be deployed with **`ENTRY_POINT_ADDRESS` = v0.8** (same address as `VITE_ENTRY_POINT_ADDRESS`) and must **not** equal the EntryPoint address as a mistaken copy-paste.
- Restart `npm run dev` after env changes.
- Deploy implementation with `contracts/script/DeployMockOpenfort7702Implementation.s.sol` and copy the address from `broadcast/.../run-latest.json`.

**Playwright:** copy **`.env.test.example` → `.env.test`**, then run tests. `playwright.config.js` runs **`pnpm run build:test && pnpm run preview:test`** so **`VITE_*` from `.env.test` are embedded at build time** (`vite build --mode test`), not only at preview.

### E) Optional one-shot health check flow

```bash
cd /Users/nandi/Documents/projekte/DecentraSol/simple-todo
docker compose -f docker-compose.aa-local.yml down
docker compose -f docker-compose.aa-local.yml up -d
curl -s http://127.0.0.1:4337 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}'
```

### F) One-command setup (script)

Prerequisites: **Docker**, **Foundry** (`forge`), **Node 18+**. **Anvil** must reach your RPC (start it yourself, or use `--start-anvil`).

```bash
# Terminal 1 — chain
anvil

# Terminal 2 — repo root
cd /Users/nandi/Documents/projekte/DecentraSol/simple-todo
pnpm run setup:local-aa
# or: npm run setup:local-aa
```

The script **`scripts/setup-local-aa.mjs`**:

1. Waits for `eth_chainId` on `http://127.0.0.1:8545`
2. Runs `docker compose -f docker-compose.aa-local.yml up -d` (Pimlico contract-deployer + Alto)
3. Waits until `eth_supportedEntryPoints` on `http://127.0.0.1:4337` includes **EntryPoint v0.8**
4. Broadcasts Foundry scripts (default deployer = Anvil account `#0`, `ENTRY_POINT_ADDRESS` = v0.8):
   - `DeployMockOpenfort7702Implementation.s.sol`
   - `DeployEscrow.s.sol`
   - `DeployMockUSDT.s.sol`
5. Merges addresses into **`.env.development`** (override with `--env-file PATH`)

Useful flags:

| Flag                          | Meaning                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `--start-anvil`               | Spawn detached `anvil` (you stop it when finished)                |
| `--skip-docker`               | Alto/compose already up                                           |
| `--skip-forge`                | Only refresh `.env` from existing `broadcast/.../run-latest.json` |
| `--only-env`                  | Same as refresh only (no Docker, no forge)                        |
| `--rpc-url` / `--bundler-url` | Non-default URLs                                                  |

If you use **Vite bundler/paymaster proxies**, re-edit `VITE_BUNDLER_URL` / `VITE_RPC_URL` in `.env.development` after the script (it writes direct `127.0.0.1` URLs).

### Fresh setup (new Anvil chain, new deploys, or after env mistakes)

Use this when escrow/implementation addresses changed, Anvil was restarted, or the app bundle still points at old `VITE_*` values.

1. **Stop** anything using the old chain: `preview:test`, passkey Playwright, optional relay.
2. **Restart Anvil** (or run `pnpm run setup:local-aa:test`, which can spawn a fresh Anvil with `--start-anvil`). A new chain clears nonces and old contract addresses.
3. **Deploy + write `.env.test`**:  
   `pnpm run setup:local-aa:test`  
   (Docker Alto + forge deploy + `broadcast/.../run-latest.json` → `.env.test`).  
   If Anvil is already running:  
   `pnpm run setup:local-aa --env-file .env.test --skip-docker`
4. **Rebuild the test bundle** (Vite inlines `VITE_*` at build time):  
   `pnpm run build:test`
5. **Serve the new build**:  
   `pnpm run preview:test`  
   (new terminal; keep it running for E2E or manual testing).
6. **Browsers**: new passkey profiles are created per run in E2E; for manual testing, use a fresh profile or clear site data so old smart-account keys / OrbDB state don’t confuse you.
7. **Passkey E2E**: after any `.env.test` or contract change, run **one** full test **without** `PW_REUSE_PREVIEW` (or restart preview after step 5) so Playwright doesn’t hit an old `build/` on disk.

---

## 1) Deploy Contracts (Foundry)

### 1A) Install Foundry + deps

```bash
foundryup
forge install foundry-rs/forge-std
```

### 1B) Local (Anvil)

```bash
anvil
```

In a second terminal:

```bash
cd /Users/nandi/Documents/projekte/DecentraSol/simple-todo
export PRIVATE_KEY=0x... # use the first Anvil private key
export ENTRY_POINT_ADDRESS=0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108
forge script contracts/script/DeployMockOpenfort7702Implementation.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
forge script contracts/script/DeployEscrow.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
forge script contracts/script/DeployMockUSDT.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

Use the deployed mock implementation address as `VITE_IMPLEMENTATION_CONTRACT`.

> `MockOpenfort7702Implementation` is for local testing only and intentionally permissive. Do not use it in production.

### 1C) Sepolia

**Recommended — escrow + mock implementation in one go** (fills `VITE_ESCROW_CONTRACT` and `VITE_IMPLEMENTATION_CONTRACT` in the script output):

```bash
cd /path/to/simple-todo
# Copy `.env.sepolia.example` → `.env.sepolia`, set PRIVATE_KEY, SEPOLIA_RPC_URL / VITE_RPC_URL, optional ETHERSCAN_API_KEY
npm run deploy:sepolia
```

By default this deploys `TodoEscrow` and **`MockOpenfort7702Implementation`** (dev-only). To skip the mock and use OpenFort’s implementation in `VITE_IMPLEMENTATION_CONTRACT` instead, set `SEPOLIA_SKIP_MOCK_IMPLEMENTATION=1` in `.env.sepolia` or run `SEPOLIA_SKIP_MOCK_IMPLEMENTATION=1 npm run deploy:sepolia`.

**Mock implementation only** (e.g. escrow already deployed, you only need `VITE_IMPLEMENTATION_CONTRACT`):

```bash
cd /path/to/simple-todo
export PRIVATE_KEY=0x... # deployer with Sepolia ETH
export ENTRY_POINT_ADDRESS=0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108
forge script contracts/script/DeployMockOpenfort7702Implementation.s.sol \
  --rpc-url "$SEPOLIA_RPC_URL" --broadcast
# Copy the implementation address from the console or broadcast/.../run-latest.json → VITE_IMPLEMENTATION_CONTRACT
```

**Escrow only** (older path — does not deploy the mock):

```bash
cd /path/to/simple-todo
export PRIVATE_KEY=0x...     # deployer key
export RPC_URL_SEPOLIA=...   # your Sepolia RPC

forge script contracts/script/DeployEscrow.s.sol --rpc-url $RPC_URL_SEPOLIA --broadcast

# Optional: mint mock USDT to yourself after deploy
export MINT_TO=0xYourAddress
export MINT_AMOUNT=1000000000 # 1,000 USDT with 6 decimals
forge script contracts/script/DeployMockUSDT.s.sol --rpc-url $RPC_URL_SEPOLIA --broadcast
```

---

## 2) Configure the App (.env for Vite)

Create a local `.env` in the repo root with:

```bash
VITE_CHAIN_ID=11155111
VITE_RPC_URL=https://sepolia.your-rpc
VITE_BUNDLER_URL=https://your-bundler
VITE_ENTRY_POINT_ADDRESS=0x...      # EntryPoint v0.8
VITE_IMPLEMENTATION_CONTRACT=0x...  # Openfort 7702 implementation
VITE_PAYMASTER_URL=https://your-paymaster  # optional, for gas sponsorship
VITE_ESCROW_CONTRACT=0x...          # deployed TodoEscrow
VITE_USDT_ADDRESS=0x...             # test ERC20 address (mock USDT)
```

### Notes

- `VITE_USDT_ADDRESS` should be a test ERC20 on Sepolia.
- If you don’t have a test USDT, deploy a mock ERC20 and use its address.
- If you’re using a paymaster, your bundler should be configured accordingly.

### Openfort vs Own Implementation (Sepolia/Mainnet)

Use Openfort implementation by default when:

- You want the current app flow to work without changing wallet adapter code.
- `src/lib/wallet/openfort/*` remains your account abstraction integration path.
- You prefer provider-maintained account logic over maintaining your own account contract stack.

Use your own implementation when:

- You need custom account validation rules, permissions, or upgrade governance.
- You want full ownership of audits, upgrades, and backward compatibility guarantees.
- You plan to remove dependency on Openfort-specific account behavior and APIs.

Important:

- `VITE_IMPLEMENTATION_CONTRACT` must implement the methods expected by this app (`initialize`, `execute`, `executeBatch`, account validation path via EntryPoint).
- `VITE_IMPLEMENTATION_CONTRACT` must be different from `VITE_ENTRY_POINT_ADDRESS`.
- For local Anvil this repo uses a dev-only mock implementation contract; for Sepolia/Mainnet use a real production implementation address.

---

## 3) Run the App Locally

```bash
cd /Users/nandi/Documents/projekte/DecentraSol/simple-todo
npm install
npm run dev
```

Open the dev URL shown in the terminal.

### Relay for local development

Use the **`orbitdb-relay-pinner`** package (installed with the app):

```bash
cd /Users/nandi/Documents/projekte/DecentraSol/simple-todo
npm run relay
# alias: npm run relay:local  →  same as npm run relay (no separate relay/ folder)
```

To work off a **local fork** of the relay, see **`docs/LOCAL_RELAY.md`**.

The relay reads these port env vars from your shell / env files:

```bash
RELAY_TCP_PORT=4101
RELAY_WS_PORT=4102
RELAY_WEBRTC_PORT=4106
RELAY_WEBRTC_DIRECT_PORT=4006
HTTP_PORT=3001
```

---

## 4) Create Passkey + Wallet Profile

1. Create/Recover your WebAuthn identity in the app.
2. In **Passkey Wallet Profile**:
   - Click **Create Passkey Smart Account** to generate a new EIP-7702 smart account and bind a passkey.
   - The wallet address field updates to the new smart account address.
   - Confirm the warning checkbox to proceed (it will override the wallet address).
   - You can also click **Create Passkey** later to rotate the credential.

> The passkey credential is stored in local storage and reused for signing UserOperations.

### Current account-layer boundary

The current integration intentionally separates the first 7702 bootstrap operation from later app actions:

- **Bootstrap / registration**:
  - Generates a fresh EOA owner locally.
  - Signs the EIP-7702 authorization with that owner.
  - Sends the first `initialize(...)` user operation with `eip7702Auth`.
- **Later wallet actions**:
  - Reuse the delegated account address.
  - Prepare the user operation with a WebAuthn-shaped stub signature.
  - Replace the stub with a real WebAuthn signature before `eth_sendUserOperation`.

This mirrors the structure used by the `sample-7702-WebAuthn` example more closely than the earlier all-in-one flow.

Phase 1 intentionally does **not** port full session-key or sponsored-transaction parity yet.
Those features should be layered on top of a stable bootstrap + explicit WebAuthn execution path.

---

## 5) Create a Delegated Todo + Lock Funds

1. Add a todo with:
   - Delegate DID (Bob)
   - Delegate Wallet (Bob’s 0x address)
   - Estimated Cost (USD or ETH)
2. Click **Lock Funds** (Alice only).
   - ETH uses `lockEth`.
   - USD uses `lockToken` (and performs ERC20 `approve` first).

The todo now stores `escrow.status = locked`.

### Funding the local smart account

Before `Lock Funds` can succeed, the creator smart account must hold the assets required by the chosen payout mode:

- **ETH payout**: the smart account needs enough ETH for the escrow amount plus gas.
- **USD/USDT payout**: the smart account needs enough USDT plus some ETH for gas.

In local Anvil development, the **Passkey Wallet Profile** now shows:

- the smart account ETH balance
- the latest matching transactions found in recent local blocks
- a local-only `Fund 2 ETH (Anvil #2)` button on chain `31337` when `VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY` is configured

You can also fund the account manually from Anvil:

```bash
cast send 0xYourSmartAccount \
  --value 2ether \
  --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  --rpc-url http://127.0.0.1:8545
```

If you want the in-app funding button, set:

```bash
VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY=0x...
```

Use this only for disposable local development chains like Anvil.

---

## 6) Completion + Confirmation Flow

- Bob completes the todo (libp2p only).
- Alice clicks **Confirm & Pay**.
- Escrow contract releases funds to Bob.

If the deadline passes, Alice can also click **Refund**.

---

## Mainnet Deployment

1. Deploy `TodoEscrow.sol` on mainnet using Foundry:

```bash
export PRIVATE_KEY=0x...     # deployer key
export RPC_URL_MAINNET=...   # mainnet RPC
forge script contracts/script/DeployEscrow.s.sol --rpc-url $RPC_URL_MAINNET --broadcast
```

2. Update `.env`:

```bash
VITE_CHAIN_ID=1
VITE_RPC_URL=https://mainnet.your-rpc
VITE_ESCROW_CONTRACT=0x...    # mainnet deployment
VITE_USDT_ADDRESS=0x...       # mainnet USDT
VITE_IMPLEMENTATION_CONTRACT=0x...  # Openfort 7702 implementation
VITE_PAYMASTER_URL=https://your-paymaster  # optional, for gas sponsorship
```

3. Ensure your passkey smart account is deployed on mainnet and funded (or configured with a paymaster).
4. Run the app with `npm run build` and deploy your static output.

---

## Playwright E2E (passkey wallet + Alice/Bob escrow)

Automated flow: **global setup** runs `scripts/setup-local-aa.mjs` (Anvil + `docker-compose.aa-local.yml` + forge deploys) targeting **`.env.test`**, starts a relay on **port 3001** (mock paymaster is on host **3002**), then Playwright runs **`build:test`** and **`preview:test`** (`sirv build --single` — **`vite preview`** can crash with `ENOENT … .svelte-kit/output/client/manifest.json` after a static export).

```bash
# Requires: Docker, Foundry (forge), Playwright browsers, Chromium
pnpm run test:e2e:passkey-escrow
```

**`zsh: killed` right after `🚀 passkey-escrow global setup…`:** the OS is almost certainly **SIGKILL-ing** the Playwright process during **`setup-local-aa`** (Docker + Anvil + `forge` spikes RAM). **Two-terminal workflow** (start the stack when the machine is idle, then run tests without redoing AA):

```bash
# Terminal 1 — once, or when contracts / chain need refresh
pnpm run setup:local-aa:test

# Terminal 2 — relay + build + preview still run inside Playwright global setup
pnpm run test:e2e:passkey-escrow:skip-aa
```

Stale relay/preview ports: `E2E_KILL_STALE_PORTS=1 pnpm run test:e2e:passkey-escrow` (optional; default is **no** `lsof`/`kill`).

**White screen + 404 on `/_app/immutable/entry/*.js` in `preview:test`:** often **cached `index.html`** (browser disk cache) pointing at **old** hashed chunks while `build/` has **new** files — or **stale `.svelte-kit/`** / **partial `build/`** so `index.html` references chunks that were never copied. Passkey Playwright config uses a **fresh `--disk-cache-dir` per run**, **`serviceWorkers: 'block'`**, and global setup does **`rm -rf build/` and `rm -rf .svelte-kit/`** before each `build:test`, then **`pnpm exec svelte-kit sync`**, then **`assert-static-build-assets`** (fail fast). Manual fix: `rm -rf build .svelte-kit && pnpm exec svelte-kit sync && pnpm run build:test && pnpm run verify:static-build`. Test builds **omit `vite-plugin-pwa`**; `virtual:pwa-register` is stubbed in `src/lib/browser-stubs/pwa-register.js`. **`ERR_CONTENT_LENGTH_MISMATCH` on `/`** often shows up alongside broken chunk loads; fixing the 404s usually clears it.

**Debug a hanging passkey test** (often stuck on first `page.goto`): run **headed** and/or verbose browser console:

```bash
pnpm run test:e2e:passkey-escrow:skip-aa:headed
# or
PW_HEADED=1 PW_PASSKEY_VERBOSE=1 PW_SLOW_MO=250 pnpm run test:e2e:passkey-escrow:skip-aa
```

**Playwright Inspector (`--debug`) without rebuilding / without “site not found”:**

| Goal                                                                                              | What to run                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skip Docker/Anvil setup only** (global setup still runs `build:test` unless you add more flags) | `pnpm run test:e2e:passkey-escrow:skip-aa:debug`                                                                                                               |
| **Skip build + reuse the same flow as headed reuse-preview**                                      | **Terminal 1:** `pnpm run build:test && pnpm run preview:test` (leave running). **Terminal 2:** `pnpm run test:e2e:passkey-escrow:reuse-preview:skip-aa:debug` |
| **Skip build; let Playwright start `preview:test` for you** (no second terminal)                  | Once: `pnpm run build:test`. Then: `pnpm run test:e2e:passkey-escrow:skip-aa:skip-build:debug`                                                                 |

`PW_REUSE_PREVIEW=1` means **do not start** the preview server — Playwright assumes **`pnpm run preview:test` is already listening on `127.0.0.1:4174`**. If nothing is running, the browsers will fail to load the app. To avoid a full Vite build in global setup, set **`PW_REUSE_PREVIEW=1`** or **`E2E_SKIP_VITE_BUILD=1`** (see `e2e/global-setup-passkey-escrow.mjs`).

- `PW_HEADED=1` — non-headless Chromium (see consent / WebAuthn / loading).
- `PW_PASSKEY_VERBOSE=1` — forward **all** `page.console` lines (default: only `console.error` + `pageerror` + failed requests).
- `PW_SLOW_MO=250` — slow down UI actions (ms).

- Spec: `e2e/passkey-wallet-escrow.spec.js` (both Alice and Bob create a **passkey smart account**; Alice delegates using Bob’s **visible** profile address; **Lock → complete → Confirm & Pay**; Bob’s smart-account balance + recent txs via RPC/UI refresh). The spec resolves **`VITE_ESCROW_CONTRACT` / `VITE_RPC_URL` from the running bundle** via `window.__PASSKEY_E2E_CHAIN__` (`+layout.svelte`, **`vite build --mode test`** only) so Node-side `eth_call` matches the contract the app locked on—reading `.env.test` alone is not enough if the build is stale.
- Skip Anvil/docker/forge if your stack is already up: `E2E_SKIP_LOCAL_AA_SETUP=1 pnpm run test:e2e:passkey-escrow`
- Passkey Playwright **`baseURL`** is **`http://localhost:4174`** (not `127.0.0.1` in the address bar): Chrome throws **WebAuthn `SecurityError: This is an invalid domain`** for numeric hosts because `rpId` comes from `window.location.hostname`. Chromium is launched with `--host-resolver-rules=MAP localhost 127.0.0.1` so TCP still hits `sirv` bound to **127.0.0.1**. **`webServer.url`** in `playwright.passkey-escrow.config.js` uses **`http://127.0.0.1:4174`** so Node’s readiness probe does not resolve **`localhost` → `::1`** and time out while sirv listens on IPv4 only. For **manual** passkey testing in the browser, open **`http://localhost:4174`** (or use the same flag once).
- Reuse an already running `preview:test` (faster iteration): `PW_REUSE_PREVIEW=1 pnpm run test:e2e:passkey-escrow` (Playwright still expects the app at **localhost:4174**). Start preview first: `pnpm run preview:test` (sirv on **127.0.0.1:4174** is fine; Chromium maps **localhost** → **127.0.0.1** in the passkey config). Convenience: `pnpm run test:e2e:passkey-escrow:reuse-preview:skip-aa:headed`.
- **`E2E_SKIP_VITE_BUILD=1` is redundant** if you already set **`PW_REUSE_PREVIEW=1`**: both skip the global-setup `build:test` (see `e2e/global-setup-passkey-escrow.mjs`). Use **`E2E_SKIP_VITE_BUILD=1` alone** when you want Playwright to **spawn** `preview:test` but skip rebuilding (you already ran `pnpm run build:test`).
- **Caveat (reuse + skip build):** `VITE_*` is inlined at **build** time. Global setup still appends a **fresh** relay multiaddr to `.env.test` each run; the **running bundle** will not pick that up until you **`pnpm run build:test`** again. If OrbitDB/P2P looks wrong, run **one full** passkey test (no reuse) after env/relay changes.
- **Local relay vs public bootstrap:** `vite build --mode test` sets **`import.meta.env.DEV === false`**. `src/lib/libp2p-config.js` therefore treats **`MODE === 'test'`** like “development” for relay selection so **`VITE_RELAY_BOOTSTRAP_ADDR_DEV`** (and the multiaddr global-setup merges into `.env.test`) is used. Without that, the client fell through to **`VITE_RELAY_BOOTSTRAP_ADDR_PROD` / `VITE_SEED_NODES`** and could join **public** relays instead of **127.0.0.1:4102**. After changing this logic, **rebuild** (`pnpm run build:test`).
- **Relay `GET /pinning/stats` → 404:** normal for **current** `orbitdb-relay-pinner` on npm: the HTTP server only serves **`/metrics`**, **`/health`**, **`/multiaddrs`** (see `dist/services/metrics.js`). There is **no `/pinning/*` REST API** in that build. Global setup sets **`pinningHttpApi: false`** in `e2e/relay-info-passkey.json` and the passkey spec **skips relay pinning** and relies on **live P2P replication** between Alice and Bob. If you use a **fork** that adds pinning HTTP, the spec will use it when `pinningHttpApi` is true.
- **CLI `--test`:** the passkey relay starter uses **`--test` by default** so `RELAY_PRIV_KEY` / `TEST_PRIVATE_KEY` hex is applied (`dist/relay.js`). Set **`PASSKEY_RELAY_CLI_TEST=0`** to omit the flag (storage-generated key on empty datastore).
- **`EADDRINUSE` on 4101/4102 / `UnsupportedListenAddressesError`:** usually a **stale passkey relay** (or other libp2p process) still bound after Ctrl+C. `e2e/start-passkey-escrow-relay.mjs` **SIGKILLs listeners on 4101–4106** before starting the test relay; global setup then **`ensureRelayHealthyAfterStart`** (delayed `/multiaddrs` check). To keep your own relay on those ports: **`PASSKEY_RELAY_SKIP_PORT_CLEANUP=1`** (may break E2E if ports stay taken).
- **Headed: “only Alice’s browser runs”:** the spec used to open **Bob’s tab only after** Alice’s long **Create Passkey Smart Account** flow. It now **initializes Bob (WebAuthn + P2P) right after Alice identity**, then funds Alice’s wallet — you should see **two** Chromium windows early. **`PW_HEADED=1`** also **`bringToFront()`** each page before `goto`.
- If the shell prints **`zsh: killed`**, the OS usually **SIGKILL’d** the process for **memory** (Docker + Anvil + a large Vite build at once). The passkey suite runs **`build:test` inside global setup** and exits that Node process **before** starting `preview:test`, so peak RAM is lower than bundling build + preview under Playwright’s webServer. Still tight? Close other apps, or pre-build and skip: `E2E_SKIP_VITE_BUILD=1` only if you already ran `pnpm run build:test` with the **current** `.env.test` (after relay merge, run a full passkey test once, or copy env and build manually).
- CI uses **`npm`** for the webServer command unless you set `CI` differently; force npm locally with `PW_WEBSERVER_USE_NPM=1`, or force pnpm on CI with `PW_WEBSERVER_USE_NPM=0` when `pnpm` is on `PATH`.
- Details: `docs/PLAN_LOCAL_AA_AND_E2E.md`

---

## Local Tests (Foundry)

```bash
cd /Users/nandi/Documents/projekte/DecentraSol/simple-todo
forge test -vv
```

---

## Troubleshooting

- **`cast run` shows `execute(TodoEscrow, 1 ETH, lockEth…)` then `← [Stop]` with no child `CALL`, `logs []`, ~48k gas**: On **Anvil**, EIP-7702 **self-call** + delegated **`execute` → external `CALL`** is often broken (tx succeeds, **no** `EscrowLocked`). **Escrow lock/release/refund** on **chain 31337** therefore sends **normal type-2 txs from the stored owner EOA** to TodoEscrow / ERC20 (`sendLocalAnvilDirectOwnerCalls` in `src/lib/wallet/passkey-wallet.js`) — same address as the passkey “smart account” in the UI. Bootstrap / `initialize` still uses the 7702 self-tx path. Rebuild **`build:test`** after wallet changes; **`PW_REUSE_PREVIEW` skips the build** — restart preview from a fresh build.
- **E2E “hangs” after lock / endless `on-chain escrow after lock (waiting)` with `amount=0`**: Check the lines **above** the poll. If you see **`No EscrowLocked log from TodoEscrow`** and **`TodoEscrow contract ETH balance after lock …: 0`**, the lock transaction **did not** call `lockEth` on the configured contract (or logs are missing). The UI can still show **Escrow: locked** because OrbDB was updated after the wallet reported success — **rebuilding preview alone does not fix** that if `window.__PASSKEY_E2E_CHAIN__` already matches Anvil. The spec now **fails fast** with a clear error instead of waiting the full poll. Fix the **7702 `execute` → TodoEscrow** path (including **gas** above), **`VITE_ESCROW_CONTRACT`**, and that Anvil actually has that deployment at the same RPC.
- **Wallet “Balance” ~3 ETH on both Alice and Bob, but I locked 1 ETH / Bob should have ~4 ETH**: The line **Balance (native ETH at this address)** is only `eth_getBalance(yourPasskeyAddress)`. It does **not** include ETH sitting in **`TodoEscrow`**. After **Lock funds**, Alice’s balance should fall by about the lock amount (plus gas); that ETH is now in the escrow contract — use **Refresh balance + txs** and check **TodoEscrow contract (network total)**. Bob’s balance **does not** increase when Alice locks; it increases after **Confirm & Pay** (release) pays his **delegate wallet** beneficiary. Local funding is often **~1 ETH auto-prefund** (if balance was low at account creation) **+ 2 ETH** from **Fund 2 ETH** ≈ **3 ETH** before escrow actions — so **~2.99 ETH** after small gas is normal **until** you lock (Alice drops) or receive a release (Bob rises).
- **ERC20 lock fails**: check allowance and token decimals (USDT uses 6).
- **No passkey credential**: open Passkey Wallet Profile and create the credential.
- **Bundler errors**: verify `VITE_BUNDLER_URL` and that **`VITE_ENTRY_POINT_ADDRESS` is v0.8** (`0x4337…`) and appears in `eth_supportedEntryPoints`.
- **Wrong EntryPoint (v0.6 vs v0.8)**: redeploy `MockOpenfort7702Implementation` with `ENTRY_POINT_ADDRESS` set to v0.8; old implementations tied to v0.6 will not match the app (`ENTRY_POINT_VERSION` in `src/lib/wallet/openfort/const.js`).
- **Local Anvil still reverts during 7702 registration**: the local mock implementation and Alto stack are only an approximation of the full Openfort-style environment. If account bootstrap continues to fail after env and deployment checks, verify the same flow on Sepolia before changing business logic.
- **RP ID issues**: your passkey works only for the current hostname.
