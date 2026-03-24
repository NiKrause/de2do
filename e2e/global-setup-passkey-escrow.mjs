/**
 * Playwright global setup for passkey-wallet-escrow E2E:
 * - Optional port cleanup (relay UI 3001, preview 4174, libp2p ports)
 * - `.env.test` from example if missing
 * - `scripts/setup-local-aa.mjs` (Anvil + docker AA + forge → merge .env.test)
 * - Anvil #1 private key as `VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY` for "Fund 2 ETH"
 * - Relay on HTTP 3001; probes `GET /pinning/stats` and writes `pinningHttpApi` into `relay-info-passkey.json`
 * - Merge `VITE_RELAY_BOOTSTRAP_ADDR_DEV` into `.env.test`
 * - `rm -rf build .svelte-kit`, `svelte-kit sync`, then `vite build --mode test` here (then exit) so RAM drops before Playwright starts `preview:test`
 * - `assert-static-build-assets.mjs` ensures HTML and `/_app/immutable/*` files are consistent (avoids 404 + hang)
 *   — avoids OOM / `zsh: killed` from Docker + forge + Vite build in parallel.
 *
 * Skip stack: `E2E_SKIP_LOCAL_AA_SETUP=1` (you must run Anvil + compose + forge yourself).
 * Skip Vite build: `PW_REUSE_PREVIEW=1` (reuse preview + existing `build/`; iterate faster) or
 * `E2E_SKIP_VITE_BUILD=1` (you must run `pnpm run build:test` with current `.env.test` first).
 *
 * Stale ports: `E2E_KILL_STALE_PORTS=1` runs `lsof | xargs kill -9` on relay/preview ports (off by default).
 */
import { execSync, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ensureRelayHealthyAfterStart,
	isRelayPinningHttpAvailable,
	startPasskeyEscrowRelay
} from './start-passkey-escrow-relay.mjs';
import { assertStaticBuildAssets } from './assert-static-build-assets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const execAsync = promisify(exec);

/** Anvil account #1 — used to fund smart accounts in UI */
const ANVIL_ACCOUNT1_FUNDER_PK =
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function mergeEnvFile(envPath, updates) {
	let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
	for (const [key, value] of Object.entries(updates)) {
		const line = `${key}=${value}`;
		const re = new RegExp(`^${key}=.*$`, 'm');
		if (re.test(content)) {
			content = content.replace(re, line);
		} else {
			if (content && !content.endsWith('\n')) content += '\n';
			content += `${line}\n`;
		}
	}
	fs.writeFileSync(envPath, content, 'utf8');
	console.log('[global-setup-passkey-escrow] Updated', envPath);
}

function ensureEnvTest() {
	const envTest = path.join(ROOT, '.env.test');
	const example = path.join(ROOT, '.env.test.example');
	if (!fs.existsSync(envTest)) {
		if (!fs.existsSync(example)) {
			throw new Error(
				'Missing .env.test and .env.test.example — add .env.test.example to the repo'
			);
		}
		fs.copyFileSync(example, envTest);
		console.log('[global-setup-passkey-escrow] Created .env.test from .env.test.example');
	}
}

/** Match `playwright.passkey-escrow.config.js` webServer package manager choice. */
function getPackageManager() {
	const preferPnpm =
		fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml')) && process.env.PW_WEBSERVER_USE_NPM !== '1';
	if (process.env.CI === 'true' && process.env.PW_WEBSERVER_USE_NPM !== '0') return 'npm';
	return preferPnpm ? 'pnpm' : 'npm';
}

export default async function globalSetup() {
	console.log('🚀 passkey-escrow global setup…');

	if (process.env.E2E_KILL_STALE_PORTS === '1') {
		console.log(
			'[global-setup-passkey-escrow] E2E_KILL_STALE_PORTS=1 — killing PIDs on relay/preview ports…'
		);
		try {
			await execAsync(
				'lsof -ti:4101,4102,4103,4106,3001,4174 2>/dev/null | xargs kill -9 2>/dev/null || true'
			);
			await new Promise((r) => setTimeout(r, 500));
		} catch {
			// ignore
		}
	}

	ensureEnvTest();

	if (process.env.E2E_SKIP_LOCAL_AA_SETUP === '1') {
		console.log('⚠️ E2E_SKIP_LOCAL_AA_SETUP=1 — skipping setup-local-aa (Anvil/docker/forge)');
	} else {
		console.log(
			'[global-setup-passkey-escrow] Running setup-local-aa (Docker + Anvil + forge) — needs several GB free RAM; if `zsh: killed`, start stack separately then E2E_SKIP_LOCAL_AA_SETUP=1'
		);
		execSync(
			'node scripts/setup-local-aa.mjs --env-file .env.test --start-anvil --write-anvil-pid',
			{
				cwd: ROOT,
				stdio: 'inherit',
				env: {
					...process.env,
					NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=4096']
						.filter(Boolean)
						.join(' ')
						.trim()
				}
			}
		);
	}

	const envTestPath = path.join(ROOT, '.env.test');
	mergeEnvFile(envTestPath, {
		VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY: ANVIL_ACCOUNT1_FUNDER_PK
	});

	const relay = await startPasskeyEscrowRelay(ROOT);
	await ensureRelayHealthyAfterStart(relay);
	const pinningHttpApi = await isRelayPinningHttpAvailable(relay.httpPort);
	if (pinningHttpApi) {
		console.log(
			'[global-setup-passkey-escrow] Relay exposes GET /pinning/stats — passkey E2E will use relay pin steps.'
		);
	} else {
		console.warn(
			'[global-setup-passkey-escrow] Relay has no pinning HTTP API (expected for current orbitdb-relay-pinner). Passkey E2E skips /pinning/* and relies on P2P sync.'
		);
	}
	mergeEnvFile(envTestPath, {
		VITE_RELAY_BOOTSTRAP_ADDR_DEV: relay.multiaddr,
		VITE_PUBSUB_TOPICS: 'todo._peer-discovery._p2p._pubsub'
	});

	const relayInfoPath = path.join(ROOT, 'e2e', 'relay-info-passkey.json');
	fs.writeFileSync(
		relayInfoPath,
		JSON.stringify(
			{ pid: relay.pid, multiaddr: relay.multiaddr, httpPort: relay.httpPort, pinningHttpApi },
			null,
			2
		)
	);

	const skipViteBuild =
		process.env.PW_REUSE_PREVIEW === '1' || process.env.E2E_SKIP_VITE_BUILD === '1';
	if (skipViteBuild) {
		console.log(
			'[global-setup-passkey-escrow] Skipping vite build:test (PW_REUSE_PREVIEW or E2E_SKIP_VITE_BUILD). Ensure build/ matches .env.test.'
		);
	} else {
		const buildDir = path.join(ROOT, 'build');
		const svelteKitDir = path.join(ROOT, '.svelte-kit');
		if (fs.existsSync(buildDir)) {
			console.log(
				'[global-setup-passkey-escrow] rm -rf build/ (avoid index.html vs chunk hash mismatch → 404)'
			);
			fs.rmSync(buildDir, { recursive: true, force: true });
		}
		if (fs.existsSync(svelteKitDir)) {
			console.log(
				'[global-setup-passkey-escrow] rm -rf .svelte-kit/ (stale Kit output can reference missing immutable chunks)'
			);
			fs.rmSync(svelteKitDir, { recursive: true, force: true });
		}
		const pm = getPackageManager();
		const nodeOpts = [process.env.NODE_OPTIONS, '--max-old-space-size=8192']
			.filter(Boolean)
			.join(' ')
			.trim();
		const envWithNode = { ...process.env, NODE_OPTIONS: nodeOpts };
		console.log(`[global-setup-passkey-escrow] ${pm} exec svelte-kit sync (after clean)…`);
		execSync(`${pm} exec svelte-kit sync`, { cwd: ROOT, stdio: 'inherit', env: envWithNode });
		console.log(
			`[global-setup-passkey-escrow] Running ${pm} run build:test (frees RAM before preview)…`
		);
		execSync(`${pm} run build:test`, {
			cwd: ROOT,
			stdio: 'inherit',
			env: envWithNode
		});
	}

	console.log('[global-setup-passkey-escrow] Verifying static build assets match HTML…');
	assertStaticBuildAssets();

	console.log('✅ passkey-escrow global setup complete');
}
