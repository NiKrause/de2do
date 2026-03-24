import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const relayCliPath = resolve(
	process.cwd(),
	'node_modules',
	'orbitdb-relay-pinner',
	'dist',
	'cli.js'
);
const testPrivateKeyHex = process.env.TEST_PRIVATE_KEY || process.env.RELAY_PRIV_KEY;

const env = {
	...process.env,
	NODE_ENV: process.env.NODE_ENV || 'development',
	RELAY_TCP_PORT: process.env.RELAY_TCP_PORT || '4101',
	RELAY_WS_PORT: process.env.RELAY_WS_PORT || '4102',
	RELAY_WEBRTC_PORT: process.env.RELAY_WEBRTC_PORT || '4106',
	RELAY_WEBRTC_DIRECT_PORT: process.env.RELAY_WEBRTC_DIRECT_PORT || '4006',
	HTTP_PORT: process.env.HTTP_PORT || process.env.RELAY_HTTP_PORT || '3001',
	METRICS_PORT:
		process.env.METRICS_PORT || process.env.HTTP_PORT || process.env.RELAY_HTTP_PORT || '3001',
	DATASTORE_PATH: process.env.DATASTORE_PATH || './relay-datastore',
	PUBSUB_TOPICS: process.env.PUBSUB_TOPICS || 'todo._peer-discovery._p2p._pubsub'
};

const args = [relayCliPath];
if (testPrivateKeyHex) {
	args.push('--test');
}

console.log('🧩 Starting orbitdb-relay-pinner');
console.log(`  - Relay CLI: ${relayCliPath}`);
console.log(`  - HTTP port: ${env.HTTP_PORT}`);
console.log(`  - WS port: ${env.RELAY_WS_PORT}`);
console.log(`  - TCP port: ${env.RELAY_TCP_PORT}`);
console.log(`  - WebRTC port: ${env.RELAY_WEBRTC_PORT}`);
console.log(`  - WebRTC Direct port: ${env.RELAY_WEBRTC_DIRECT_PORT}`);
console.log(`  - Health endpoint: http://localhost:${env.HTTP_PORT}/health`);
console.log(`  - Multiaddrs endpoint: http://localhost:${env.HTTP_PORT}/multiaddrs`);
console.log(`  - Metrics endpoint: http://localhost:${env.HTTP_PORT}/metrics`);

const child = spawn('node', args, {
	stdio: 'inherit',
	env
});

child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 0);
});
