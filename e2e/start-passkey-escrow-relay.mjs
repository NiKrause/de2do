/**
 * Start orbitdb relay for passkey-escrow E2E on HTTP 3001 (mock-paymaster uses host 3002).
 *
 * **Pinning HTTP:** Current `orbitdb-relay-pinner` (see `dist/services/metrics.js` on npm) only exposes
 * `/metrics`, `/health`, `/multiaddrs` on the HTTP port — **no `/pinning/*`**. Global setup records
 * `pinningHttpApi: false` in `relay-info-passkey.json` and the passkey spec skips relay pin steps and
 * relies on **P2P replication** (Alice + Bob online). Older forks may expose pinning; we detect via
 * `GET /pinning/stats`.
 *
 * **CLI `--test`:** In `dist/relay.js`, `testMode` is required for `RELAY_PRIV_KEY` / `TEST_PRIVATE_KEY`
 * hex to replace the libp2p key. Default is **`--test`**; disable with `PASSKEY_RELAY_CLI_TEST=0`.
 *
 * **Ports:** Before spawn we SIGKILL anything listening on **4101,4102,4103,4106** (stale relay from a
 * interrupted run → `EADDRINUSE` and a half-dead relay). Opt out: `PASSKEY_RELAY_SKIP_PORT_CLEANUP=1`.
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { rm } from 'node:fs/promises';

/** Same default libp2p test key as `docker-compose.yml` (relay needs identity in --test mode). */
const DEFAULT_RELAY_TEST_PRIVATE_KEY =
	'08011240821cb6bc3d4547fcccb513e82e4d718089f8a166b23ffcd4a436754b6b0774cf07447d1693cd10ce11ef950d7517bad6e9472b41a927cd17fc3fb23f8c70cd99';

function resolveRelayCliPath(root) {
	const distCli = path.join(root, 'node_modules', 'orbitdb-relay-pinner', 'dist', 'cli.js');
	if (fs.existsSync(distCli)) return distCli;
	const binName =
		process.platform === 'win32' ? 'orbitdb-relay-pinner.cmd' : 'orbitdb-relay-pinner';
	const binPath = path.join(root, 'node_modules', '.bin', binName);
	if (fs.existsSync(binPath)) return binPath;
	return null;
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 */
async function httpGetText(url, { timeoutMs = 8000 } = {}) {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: ac.signal });
		const body = await res.text();
		return { status: res.status, body };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Whether the relay exposes legacy pinning REST (`GET /pinning/stats` → 200 JSON).
 * Current npm `orbitdb-relay-pinner` does not — only `/multiaddrs` etc.
 *
 * @param {number} httpPort
 */
export async function isRelayPinningHttpAvailable(httpPort) {
	try {
		const res = await httpGetText(`http://127.0.0.1:${httpPort}/pinning/stats`, {
			timeoutMs: 6000
		});
		if (res.status !== 200 || !res.body?.trim()) return false;
		const parsed = JSON.parse(res.body);
		return typeof parsed === 'object' && parsed !== null;
	} catch {
		return false;
	}
}

function killListenersOnPasskeyLibp2pPorts() {
	if (process.env.PASSKEY_RELAY_SKIP_PORT_CLEANUP === '1') return;
	if (process.platform === 'win32') {
		console.warn(
			'[passkey-e2e] PASSKEY_RELAY_SKIP_PORT_CLEANUP not set but port cleanup is skipped on win32; EADDRINUSE → set env or free 4101–4106 manually.'
		);
		return;
	}
	try {
		execSync('lsof -ti:4101,4102,4103,4106 2>/dev/null | xargs kill -9 2>/dev/null || true', {
			stdio: 'ignore',
			shell: true
		});
		console.log(
			'[passkey-e2e] Freed libp2p ports 4101–4106 (stale passkey relay / interrupted run → avoids EADDRINUSE)'
		);
	} catch {
		/* ignore */
	}
}

/**
 * Relay can log PeerId before all transports bind; wait briefly and verify HTTP + PID so we do not
 * continue with a crashed process (stderr often appears later as "UnsupportedListenAddressesError").
 *
 * @param {{ httpPort: number; pid: number }} relay
 */
export async function ensureRelayHealthyAfterStart(relay, { settleMs = 2800 } = {}) {
	await new Promise((r) => setTimeout(r, settleMs));
	try {
		process.kill(relay.pid, 0);
	} catch {
		throw new Error(
			`[passkey-e2e] Relay PID ${relay.pid} exited shortly after start (common: EADDRINUSE on 4101/4102). ` +
				`Free those ports or run with default port cleanup; see e2e/start-passkey-escrow-relay.mjs.`
		);
	}
	const res = await httpGetText(`http://127.0.0.1:${relay.httpPort}/multiaddrs`, {
		timeoutMs: 8000
	});
	if (res.status !== 200) {
		throw new Error(
			`[passkey-e2e] Relay HTTP :${relay.httpPort} not OK after start (status ${res.status}). Relay may have crashed during libp2p listen.`
		);
	}
	console.log('✅ [passkey-e2e] relay still up (POST-start /multiaddrs check)');
}

async function waitForRelayPeerId(httpPort, { timeoutMs = 45000, intervalMs = 500 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let lastErr = null;
	while (Date.now() < deadline) {
		try {
			const res = await httpGetText(`http://127.0.0.1:${httpPort}/multiaddrs`, { timeoutMs: 8000 });
			if (res.status === 200) {
				const payload = JSON.parse(res.body || '{}');
				const multiaddrs = Array.isArray(payload.all) ? payload.all : [];
				const addrWithPeerId = multiaddrs.find(
					(addr) => typeof addr === 'string' && addr.includes('/p2p/')
				);
				if (addrWithPeerId) {
					return addrWithPeerId.split('/p2p/')[1] || null;
				}
			}
			lastErr = new Error('Relay multiaddrs endpoint did not return a peer id yet');
		} catch (error) {
			lastErr = error;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	throw lastErr || new Error('Timed out waiting for relay multiaddrs endpoint');
}

/**
 * @param {string} rootDir - repo root
 * @returns {Promise<{ pid: number, multiaddr: string, httpPort: number }>}
 */
export async function startPasskeyEscrowRelay(rootDir) {
	const HTTP_PORT = 3001;
	// Must match global-setup.js: HTTP + metrics on the same port (or /multiaddrs never hits 3001).
	const METRICS_PORT = HTTP_PORT;
	const TCP_PORT = '4101';
	const WS_PORT = '4102';
	const WEBRTC_PORT = '4103';
	const WEBRTC_DIRECT_PORT = '4106';
	const STARTUP_TIMEOUT_MS = 120_000;

	killListenersOnPasskeyLibp2pPorts();
	await new Promise((r) => setTimeout(r, 400));

	const testDatastorePath = path.join(rootDir, 'relay', 'test-relay-datastore-passkey-e2e');
	if (fs.existsSync(testDatastorePath)) {
		await rm(testDatastorePath, { recursive: true, force: true });
	}
	fs.mkdirSync(testDatastorePath, { recursive: true });

	const relayCliPath = resolveRelayCliPath(rootDir);
	const usePackageRelay = Boolean(relayCliPath) && process.env.RELAY_IMPL !== 'local';
	const testPrivateKeyHex =
		process.env.TEST_PRIVATE_KEY || process.env.RELAY_PRIV_KEY || DEFAULT_RELAY_TEST_PRIVATE_KEY;

	if (usePackageRelay) {
		console.log('🧩 [passkey-e2e] orbitdb-relay-pinner:', relayCliPath);
	} else {
		console.log('🧩 [passkey-e2e] local relay relay-enhanced.js');
	}

	/** `--test` loads libp2p key from `RELAY_PRIV_KEY` / `TEST_PRIVATE_KEY` (see dist/relay.js). */
	const packageRelayArgs = process.env.PASSKEY_RELAY_CLI_TEST === '0' ? [] : ['--test'];

	return new Promise((resolve, reject) => {
		const relayProcess = usePackageRelay
			? spawn('node', [relayCliPath, ...packageRelayArgs], {
					cwd: testDatastorePath,
					env: {
						...process.env,
						NODE_ENV: 'development',
						RELAY_PRIV_KEY: process.env.RELAY_PRIV_KEY || testPrivateKeyHex,
						TEST_PRIVATE_KEY: testPrivateKeyHex,
						RELAY_TCP_PORT: TCP_PORT,
						RELAY_WS_PORT: WS_PORT,
						RELAY_WEBRTC_PORT: WEBRTC_PORT,
						RELAY_WEBRTC_DIRECT_PORT: WEBRTC_DIRECT_PORT,
						HTTP_PORT: String(HTTP_PORT),
						METRICS_PORT: String(METRICS_PORT),
						DATASTORE_PATH: testDatastorePath,
						PUBSUB_TOPICS: 'todo._peer-discovery._p2p._pubsub',
						RELAY_DISABLE_WEBRTC: 'true',
						STRUCTURED_LOGS: 'false',
						ENABLE_GENERAL_LOGS: 'true'
					},
					stdio: ['ignore', 'pipe', 'pipe']
				})
			: spawn('node', ['relay-enhanced.js'], {
					cwd: path.join(rootDir, 'relay'),
					env: {
						...process.env,
						NODE_ENV: 'development',
						RELAY_PRIV_KEY: process.env.RELAY_PRIV_KEY || testPrivateKeyHex,
						TEST_PRIVATE_KEY: testPrivateKeyHex,
						RELAY_TCP_PORT: TCP_PORT,
						RELAY_WS_PORT: WS_PORT,
						RELAY_WEBRTC_PORT: WEBRTC_PORT,
						RELAY_WEBRTC_DIRECT_PORT: WEBRTC_DIRECT_PORT,
						HTTP_PORT: String(HTTP_PORT),
						METRICS_PORT: String(METRICS_PORT),
						DATASTORE_PATH: './test-relay-datastore-passkey-e2e',
						PUBSUB_TOPICS: 'todo._peer-discovery._p2p._pubsub',
						STRUCTURED_LOGS: 'false'
					},
					stdio: ['ignore', 'pipe', 'pipe']
				});

		let output = '';
		let resolved = false;

		const finalize = (peerId) => {
			if (!peerId || resolved) return;
			if (!peerId.startsWith('12D')) {
				console.warn('[passkey-e2e] peerId unexpected:', peerId);
				return;
			}
			if (peerId.match(/^[0-9a-f]+$/i) && peerId.length > 50) {
				console.warn('[passkey-e2e] peerId looks like hex, skipping:', peerId);
				return;
			}
			resolved = true;
			const multiaddr = `/ip4/127.0.0.1/tcp/${WS_PORT}/ws/p2p/${peerId}`;
			console.log('✅ [passkey-e2e] relay multiaddr:', multiaddr);
			resolve({ pid: relayProcess.pid, multiaddr, httpPort: HTTP_PORT });
		};

		if (usePackageRelay) {
			waitForRelayPeerId(HTTP_PORT, { timeoutMs: STARTUP_TIMEOUT_MS })
				.then((peerId) => finalize(peerId))
				.catch((err) => {
					if (!resolved) console.warn('[passkey-e2e] health poll:', err?.message || err);
				});
		}

		relayProcess.stdout?.on('data', (data) => {
			const text = data.toString();
			output += text;
			process.stdout.write(text);
			const extractPeerId = (s) => {
				let m = s.match(/Relay PeerId[:\s]+([12D][A-HJ-NP-Za-km-z1-9]{50,})/i);
				if (m) return m[1];
				m = s.match(/\/p2p\/([12D][A-HJ-NP-Za-km-z1-9]{50,})/i);
				if (m) return m[1];
				return null;
			};
			finalize(extractPeerId(text) || extractPeerId(output));
		});

		relayProcess.stderr?.on('data', (data) => {
			const t = data.toString();
			output += t;
			process.stderr.write(t);
		});

		relayProcess.on('error', (error) => {
			if (!resolved) reject(error);
		});

		relayProcess.on('exit', (code) => {
			if (code !== 0 && code !== null && !resolved) {
				reject(new Error(`Relay exited ${code}: ${output.slice(-2000)}`));
			}
		});

		setTimeout(() => {
			if (!resolved) {
				relayProcess.kill();
				reject(
					new Error(
						`Relay failed to start within ${STARTUP_TIMEOUT_MS / 1000}s. Output:\n${output.slice(-4000) || '(no stdout/stderr captured)'}`
					)
				);
			}
		}, STARTUP_TIMEOUT_MS);
	});
}
