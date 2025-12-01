import { spawn } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { rm } from 'fs/promises';
import path from 'path';

let relayProcess = null;

export default async function globalSetup() {
	console.log('🚀 Setting up global test environment...');

	// Clean up test datastore
	const testDatastorePath = path.join(process.cwd(), 'relay', 'test-relay-datastore');
	if (existsSync(testDatastorePath)) {
		try {
			await rm(testDatastorePath, { recursive: true, force: true });
		} catch (error) {
			console.warn('⚠️ Could not clean up test datastore:', error.message);
		}
	}

	// Kill any processes holding ports
	try {
		const { exec } = await import('child_process');
		const { promisify } = await import('util');
		const execAsync = promisify(exec);
		await execAsync(
			'lsof -ti:4001,4002,4003,4006,3000 2>/dev/null | xargs kill -9 2>/dev/null || true'
		);
		await new Promise((resolve) => setTimeout(resolve, 1000));
	} catch {
		// Ignore errors
	}

	// Port configuration for relay server
	const TCP_PORT = '4101';
	const WS_PORT = '4102';
	const WEBRTC_PORT = '4103';
	const WEBRTC_DIRECT_PORT = '4106';
	const HTTP_PORT = '3000';

	// Start relay server
	return new Promise((resolve, reject) => {
		relayProcess = spawn('node', ['relay-enhanced.js'], {
			cwd: path.join(process.cwd(), 'relay'),
			env: {
				...process.env,
				NODE_ENV: 'development',
				RELAY_PRIV_KEY: process.env.RELAY_PRIV_KEY, // Explicitly pass it
				RELAY_TCP_PORT: TCP_PORT,
				RELAY_WS_PORT: WS_PORT,
				RELAY_WEBRTC_PORT: WEBRTC_PORT,
				RELAY_WEBRTC_DIRECT_PORT: WEBRTC_DIRECT_PORT,
				HTTP_PORT: HTTP_PORT,
				DATASTORE_PATH: './test-relay-datastore',
				PUBSUB_TOPICS: 'todo._peer-discovery._p2p._pubsub',
				STRUCTURED_LOGS: 'false'
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});

		let output = '';
		let relayMultiaddr = null;
		let resolved = false;

		relayProcess.stdout.on('data', (data) => {
			const text = data.toString();
			output += text;
			process.stdout.write(text);

			// Extract peer ID - prioritize specific patterns to avoid matching private key hex
			// Pattern 1: "Relay PeerId: 12D3Koo..." (most specific and reliable)
			let peerIdMatch = text.match(/Relay PeerId[:\s]+([12][A-HJ-NP-Za-km-z1-9]{50,})/i);
			// Pattern 2: Fallback - search in accumulated output if Pattern 1 didn't match in current chunk
			// This handles cases where the peerId line is split across chunks
			if (!peerIdMatch && output.includes('Relay Server Information')) {
				// Search the accumulated output for the "Relay PeerId:" line
				const relayInfoMatch = output.match(/Relay PeerId[:\s]+([12D][A-HJ-NP-Za-km-z1-9]{50,})/i);
				if (relayInfoMatch) {
					peerIdMatch = relayInfoMatch;
				}
			}

			if (peerIdMatch && !relayMultiaddr && !resolved) {
				const peerId = peerIdMatch[1];
				// Additional validation: ensure it's a valid libp2p peerId
				// Libp2p peerIds are base58-encoded and typically start with "12D"
				if (!peerId.startsWith('12D')) {
					console.warn(`⚠️  Extracted peerId doesn't start with 12D: ${peerId}, skipping...`);
					return;
				}
				// Ensure it's not a hex string (hex would contain only 0-9, a-f)
				// Base58 contains characters beyond hex, so if it only has hex chars, it's likely wrong
				if (peerId.match(/^[0-9a-f]+$/i) && peerId.length > 50) {
					console.warn(`⚠️  Extracted peerId looks like hex (not base58): ${peerId}, skipping...`);
					return;
				}
			// Use the WebSocket port for browser connections
			relayMultiaddr = `/ip4/127.0.0.1/tcp/${WS_PORT}/ws/p2p/${peerId}`;

				// Create .env.development file for Vite
				const envContent = `# Generated for e2e tests
NODE_ENV=development
VITE_NODE_ENV=development
VITE_RELAY_BOOTSTRAP_ADDR_DEV=${relayMultiaddr}
VITE_PUBSUB_TOPICS=todo._peer-discovery._p2p._pubsub
`;
				writeFileSync('.env.development', envContent);
				console.log(`✅ Created .env.development with relay: ${relayMultiaddr}`);

				// Store relay info
				writeFileSync(
					path.join(process.cwd(), 'e2e', 'relay-info.json'),
					JSON.stringify({ multiaddr: relayMultiaddr, pid: relayProcess.pid }, null, 2)
				);

				// Wait a bit for relay to be fully ready, then resolve
				resolved = true;
				setTimeout(() => {
					console.log('✅ Relay server started successfully');
					resolve();
				}, 2000);
			}
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
			if (!resolved) {
				reject(error);
			}
		});

		relayProcess.on('exit', (code) => {
			if (code !== 0 && code !== null && !resolved) {
				console.error(`Relay process exited with code ${code}`);
				console.error('Relay output:', output);
				reject(new Error(`Relay server exited with code ${code}`));
			}
		});

		// Timeout fallback
		setTimeout(() => {
			if (!relayMultiaddr && !resolved) {
				console.error('Relay output so far:', output);
				relayProcess?.kill();
				reject(new Error('Relay server failed to start within timeout'));
			}
		}, 30000);
	});
}
