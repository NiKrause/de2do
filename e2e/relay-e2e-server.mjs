/**
 * Shared E2E relay + Vite dev lifecycle for Playwright.
 * Used by global-setup and by per-test relay restarts (e.g. WebAuthn delegation matrix).
 */
import { spawn } from 'child_process';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import path from 'path';
import http from 'http';

export const E2E_RELAY_PORTS = {
	TCP: '4101',
	WS: '4102',
	WEBRTC: '4103',
	WEBRTC_DIRECT: '4106',
	HTTP: '3000'
};

function httpGet(url) {
	return new Promise((resolve, reject) => {
		const req = http.get(url, (res) => {
			let data = '';
			res.setEncoding('utf8');
			res.on('data', (chunk) => (data += chunk));
			res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
		});
		req.on('error', reject);
		req.end();
	});
}

export async function waitForHttpReady(url, { timeoutMs = 60000, intervalMs = 500 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let lastErr = null;
	while (Date.now() < deadline) {
		try {
			const res = await httpGet(url);
			const body = res.body?.toLowerCase() ?? '';
			const looksLikeApp =
				body.includes('simple todo') || body.includes('de2do');
			if (res.status === 200 && res.body && looksLikeApp) {
				return;
			}
			lastErr = new Error(
				'Unexpected response: status=' + res.status + ', bodyLen=' + (res.body?.length ?? 0)
			);
		} catch (e) {
			lastErr = e;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw lastErr || new Error('Timed out waiting for ' + url);
}

export async function waitForRelayPeerId(httpPort, { timeoutMs = 30000, intervalMs = 500 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let lastErr = null;

	while (Date.now() < deadline) {
		try {
			const res = await httpGet(`http://127.0.0.1:${httpPort}/multiaddrs`);
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

export function resolveRelayCliPath(cwd = process.cwd()) {
	const binName =
		process.platform === 'win32' ? 'orbitdb-relay-pinner.cmd' : 'orbitdb-relay-pinner';
	const binPath = path.join(cwd, 'node_modules', '.bin', binName);
	if (existsSync(binPath)) return binPath;
	return null;
}

export async function cleanRelayDatastore(cwd = process.cwd()) {
	const testDatastorePath = path.join(cwd, 'relay', 'test-relay-datastore');
	if (existsSync(testDatastorePath)) {
		await rm(testDatastorePath, { recursive: true, force: true });
	}
	mkdirSync(testDatastorePath, { recursive: true });
}

export function stopRelayProcess(cwd = process.cwd()) {
	const relayInfoPath = path.join(cwd, 'e2e', 'relay-info.json');
	if (!existsSync(relayInfoPath)) return;
	try {
		const relayInfo = JSON.parse(readFileSync(relayInfoPath, 'utf8'));
		if (relayInfo.pid) {
			process.kill(relayInfo.pid, 'SIGTERM');
		}
	} catch (e) {
		console.warn('⚠️ stopRelayProcess:', e.message);
	}
}

export function stopViteDevServer(cwd = process.cwd()) {
	const webInfoPath = path.join(cwd, 'e2e', 'web-info.json');
	if (!existsSync(webInfoPath)) return;
	try {
		const webInfo = JSON.parse(readFileSync(webInfoPath, 'utf8'));
		if (webInfo.pid) {
			process.kill(webInfo.pid, 'SIGTERM');
		}
	} catch (e) {
		console.warn('⚠️ stopViteDevServer:', e.message);
	}
}

/**
 * Start relay only; writes `.env.development` and `e2e/relay-info.json`.
 */
export async function startRelayOnly(cwd = process.cwd()) {
	const testDatastorePath = path.join(cwd, 'relay', 'test-relay-datastore');
	mkdirSync(testDatastorePath, { recursive: true });

	const { WS, TCP, WEBRTC, WEBRTC_DIRECT, HTTP } = E2E_RELAY_PORTS;
	const relayCliPath = resolveRelayCliPath(cwd);
	const usePackageRelay = Boolean(relayCliPath) && process.env.RELAY_IMPL !== 'local';
	const testPrivateKeyHex = process.env.TEST_PRIVATE_KEY || process.env.RELAY_PRIV_KEY;

	return new Promise((resolve, reject) => {
		const packageRelayArgs = [];
		if (testPrivateKeyHex) packageRelayArgs.push('--test');

		const relayProcess = usePackageRelay
			? spawn('node', [relayCliPath, ...packageRelayArgs], {
					cwd: testDatastorePath,
					env: {
						...process.env,
						NODE_ENV: 'development',
						RELAY_PRIV_KEY: process.env.RELAY_PRIV_KEY,
						TEST_PRIVATE_KEY: testPrivateKeyHex,
						RELAY_TCP_PORT: TCP,
						RELAY_WS_PORT: WS,
						RELAY_WEBRTC_PORT: WEBRTC,
						RELAY_WEBRTC_DIRECT_PORT: WEBRTC_DIRECT,
						HTTP_PORT: HTTP,
						METRICS_PORT: HTTP,
						DATASTORE_PATH: testDatastorePath,
						PUBSUB_TOPICS: 'todo._peer-discovery._p2p._pubsub',
						RELAY_DISABLE_WEBRTC: 'true',
						STRUCTURED_LOGS: 'false',
						ENABLE_GENERAL_LOGS: 'true'
					},
					stdio: ['ignore', 'pipe', 'pipe']
				})
			: spawn('node', ['relay-enhanced.js'], {
					cwd: path.join(cwd, 'relay'),
					env: {
						...process.env,
						NODE_ENV: 'development',
						RELAY_PRIV_KEY: process.env.RELAY_PRIV_KEY,
						TEST_PRIVATE_KEY: testPrivateKeyHex,
						RELAY_TCP_PORT: TCP,
						RELAY_WS_PORT: WS,
						RELAY_WEBRTC_PORT: WEBRTC,
						RELAY_WEBRTC_DIRECT_PORT: WEBRTC_DIRECT,
						HTTP_PORT: HTTP,
						DATASTORE_PATH: './test-relay-datastore',
						PUBSUB_TOPICS: 'todo._peer-discovery._p2p._pubsub',
						STRUCTURED_LOGS: 'false'
					},
					stdio: ['ignore', 'pipe', 'pipe']
				});

		let output = '';
		let relayMultiaddr = null;
		let settled = false;

		const timeoutId = setTimeout(() => {
			if (!settled) {
				console.error('Relay output so far:', output);
				try {
					relayProcess.kill();
				} catch {
					// ignore
				}
				reject(new Error('Relay server failed to start within timeout'));
			}
		}, 30000);

		const finalizeRelayStart = (peerId) => {
			if (settled || !peerId || relayMultiaddr) return;
			if (!peerId.startsWith('12D')) {
				console.warn("⚠️  Extracted peerId doesn't start with 12D: " + peerId + ', skipping...');
				return;
			}
			if (peerId.match(/^[0-9a-f]+$/i) && peerId.length > 50) {
				console.warn(
					'⚠️  Extracted peerId looks like hex (not base58): ' + peerId + ', skipping...'
				);
				return;
			}

			relayMultiaddr = '/ip4/127.0.0.1/tcp/' + WS + '/ws/p2p/' + peerId;

			process.env.VITE_RELAY_BOOTSTRAP_ADDR_DEV = relayMultiaddr;
			console.log('✅ Set VITE_RELAY_BOOTSTRAP_ADDR_DEV=' + relayMultiaddr);

			const envContent =
				'# Generated for e2e tests\n' +
				'NODE_ENV=development\n' +
				'VITE_NODE_ENV=development\n' +
				'VITE_RELAY_BOOTSTRAP_ADDR_DEV=' +
				relayMultiaddr +
				'\n' +
				'VITE_PUBSUB_TOPICS=todo._peer-discovery._p2p._pubsub\n';
			writeFileSync(path.join(cwd, '.env.development'), envContent);
			console.log('✅ Created .env.development with relay: ' + relayMultiaddr);

			writeFileSync(
				path.join(cwd, 'e2e', 'relay-info.json'),
				JSON.stringify({ multiaddr: relayMultiaddr, pid: relayProcess.pid }, null, 2)
			);

			settled = true;
			clearTimeout(timeoutId);
			resolve({ pid: relayProcess.pid, multiaddr: relayMultiaddr });
		};

		if (usePackageRelay) {
			waitForRelayPeerId(HTTP)
				.then((peerId) => finalizeRelayStart(peerId))
				.catch((error) => {
					if (!settled) {
						console.error('Failed to discover relay peer id via health endpoint:', error);
					}
				});
		}

		relayProcess.stdout.on('data', (data) => {
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
			const peerId = extractPeerId(text) || extractPeerId(output);
			finalizeRelayStart(peerId);
		});

		relayProcess.stderr.on('data', (data) => {
			const text = data.toString();
			process.stderr.write(text);
			if (text.match(/error/i) && !text.match(/warn/i)) {
				console.error('Relay stderr:', text);
			}
		});

		relayProcess.on('error', (error) => {
			console.error('Failed to start relay:', error);
			if (!settled) {
				clearTimeout(timeoutId);
				reject(error);
			}
		});

		relayProcess.on('exit', (code) => {
			if (code !== 0 && code !== null && !settled) {
				clearTimeout(timeoutId);
				console.error('Relay process exited with code ' + code);
				console.error('Relay output:', output);
				reject(new Error('Relay server exited with code ' + code));
			}
		});
	});
}

export async function startViteDevServer(cwd = process.cwd()) {
	return new Promise((resolve, reject) => {
		const webProcess = spawn(
			'npm',
			['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4174', '--strictPort'],
			{
				cwd,
				env: {
					...process.env,
					NODE_ENV: 'development',
					VITE_NODE_ENV: 'development'
				},
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);

		webProcess.stdout.on('data', (data) => process.stdout.write(data.toString()));
		webProcess.stderr.on('data', (data) => process.stderr.write(data.toString()));

		waitForHttpReady('http://127.0.0.1:4174/', {
			timeoutMs: 120000,
			intervalMs: 750
		})
			.then(() => {
				writeFileSync(
					path.join(cwd, 'e2e', 'web-info.json'),
					JSON.stringify({ pid: webProcess.pid, url: 'http://127.0.0.1:4174' }, null, 2)
				);
				console.log('✅ Web app dev server ready (PID ' + webProcess.pid + ')');
				resolve({ pid: webProcess.pid });
			})
			.catch((e) => {
				try {
					webProcess.kill('SIGTERM');
				} catch {
					// ignore
				}
				reject(e);
			});
	});
}

async function killPortsForE2E() {
	try {
		const { exec } = await import('child_process');
		const { promisify } = await import('util');
		const execAsync = promisify(exec);
		await execAsync(
			'lsof -ti:4101,4102,4103,4106,3000,4174,9090 2>/dev/null | xargs kill -9 2>/dev/null || true'
		);
		await new Promise((resolve) => setTimeout(resolve, 1000));
	} catch {
		// Ignore errors
	}
}

/**
 * Initial Playwright globalSetup: clean datastore, relay, wait, Vite dev.
 */
export async function runInitialGlobalSetup(cwd = process.cwd()) {
	console.log('🚀 Setting up global test environment...');

	await cleanRelayDatastore(cwd);
	await killPortsForE2E();

	const relayCliPath = resolveRelayCliPath(cwd);
	const usePackageRelay = Boolean(relayCliPath) && process.env.RELAY_IMPL !== 'local';

	if (usePackageRelay) {
		console.log('🧩 Using orbitdb-relay-pinner from ' + relayCliPath);
	} else {
		console.log('🧩 Using local relay (relay/relay-enhanced.js)');
		if (!relayCliPath) {
			console.warn(
				'⚠️ orbitdb-relay-pinner not installed; falling back to local relay. Run: npm i -D orbitdb-relay-pinner'
			);
		}
	}

	await startRelayOnly(cwd);
	console.log('✅ Relay server started successfully');

	await new Promise((r) => setTimeout(r, 2000));

	console.log('🚀 Starting web app dev server for e2e on http://127.0.0.1:4174 ...');
	await startViteDevServer(cwd);
}

/**
 * Stop relay, wipe relay datastore, start relay again.
 * Restarts Vite only if the bootstrap multiaddr changed (e.g. new libp2p identity).
 */
export async function restartRelayBetweenTests(cwd = process.cwd()) {
	const relayInfoPath = path.join(cwd, 'e2e', 'relay-info.json');
	let previousMultiaddr = null;
	if (existsSync(relayInfoPath)) {
		try {
			previousMultiaddr = JSON.parse(readFileSync(relayInfoPath, 'utf8')).multiaddr;
		} catch {
			// ignore
		}
	}

	console.log('🔄 [e2e] Restarting relay before test (clean datastore)...');
	stopRelayProcess(cwd);
	await new Promise((r) => setTimeout(r, 750));
	await cleanRelayDatastore(cwd);

	const { multiaddr } = await startRelayOnly(cwd);
	const needViteRestart = previousMultiaddr != null && previousMultiaddr !== multiaddr;

	if (needViteRestart) {
		console.log('🔄 [e2e] Relay bootstrap changed; restarting Vite dev server...');
		stopViteDevServer(cwd);
		await new Promise((r) => setTimeout(r, 500));
		await new Promise((r) => setTimeout(r, 2000));
		await startViteDevServer(cwd);
	} else {
		console.log('✅ [e2e] Relay restarted (bootstrap unchanged; Vite unchanged)');
	}
}
