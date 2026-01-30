import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { circuitRelayServer, circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify, identifyPush } from '@libp2p/identify';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { createLibp2p } from 'libp2p';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
// import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht';
import { tcp } from '@libp2p/tcp';
import { ping } from '@libp2p/ping';
import { dcutr } from '@libp2p/dcutr';
import { autoNAT } from '@libp2p/autonat';
import { keychain } from '@libp2p/keychain';
import { config } from 'dotenv';
// import { tls } from '@libp2p/tls'
import { uPnPNAT } from '@libp2p/upnp-nat';
// import { prometheusMetrics } from '@libp2p/prometheus-metrics';
import { initializeStorage, closeStorage } from './services/storage.js';
import { createExpressServer, startExpressServer } from './services/express.js';
import { PinningService } from './services/pinning.js';

// Load environment variables
config();

console.log('🚀 Starting enhanced relay server...');

// Determine if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const fixedPrivateKey = process.env.RELAY_PRIV_KEY;

// Initialize storage with persistent datastore, blockstore, and private key management
const storage = await initializeStorage(
	process.env.DATASTORE_PATH || './relay-datastore',
	isDevelopment,
	fixedPrivateKey
);
const { datastore, blockstore, privateKey } = storage;

// Enhanced port configuration
const wsPort = process.env.RELAY_WS_PORT || 4001;
const tcpPort = process.env.RELAY_TCP_PORT || 4002;
const webrtcPort = process.env.RELAY_WEBRTC_PORT || 4003;
const webrtcDirectPort = process.env.RELAY_WEBRTC_DIRECT_PORT || 4006;
const httpPort = process.env.HTTP_PORT || 3000;

// Environment-aware announce addresses
const appendAnnounce =
	(process.env.NODE_ENV === 'development'
		? process.env.VITE_APPEND_ANNOUNCE_DEV
		: process.env.VITE_APPEND_ANNOUNCE) || '';

const appendAnnounceArray = appendAnnounce
	.split(',')
	.map((addr) => addr.trim())
	.filter(Boolean);

// AutoTLS configuration check
const autoTLSEnabled = !process.env.DISABLE_AUTO_TLS && process.env.NODE_ENV === 'production';
const stagingMode = process.env.STAGING === 'true';

// UPnP configuration check - disabled by default
const upnpEnabled = process.env.ENABLE_UPNP === 'true';

console.log('🔧 Configuration:');
console.log(`  - WebSocket port: ${wsPort}`);
console.log(`  - TCP port: ${tcpPort}`);
console.log(`  - WebRTC port: ${webrtcPort}`);
console.log(`  - WebRTC Direct port: ${webrtcDirectPort}`);
console.log(`  - HTTP port: ${httpPort}`);
console.log(`  - Datastore: ${process.env.DATASTORE_PATH || './relay-datastore'}`);
console.log(`  - Environment: ${process.env.NODE_ENV || 'development'}`);
if (appendAnnounceArray.length > 0) {
	console.log(`  - Additional announce addresses: ${appendAnnounceArray.join(', ')}`);
}
console.log(
	`  - AutoTLS: ${autoTLSEnabled ? (stagingMode ? 'enabled (staging)' : 'enabled (production)') : 'disabled'}`
);
console.log(`  - UPnP: ${upnpEnabled ? 'enabled' : 'disabled'}`);

// Conditionally load autoTLS only if needed (avoids loading native module in dev/test)
let autoTLSService = null;
if (autoTLSEnabled) {
	try {
		const { autoTLS } = await import('@ipshipyard/libp2p-auto-tls');
		autoTLSService = autoTLS({
			autoConfirmAddress: true,
			// Use Let's Encrypt staging directory if STAGING is true
			...(stagingMode && {
				acmeDirectory: 'https://acme-staging-v02.api.letsencrypt.org/directory'
			})
		});
	} catch (error) {
		console.warn('⚠️ AutoTLS not available (native module may not be compiled):', error.message);
		console.warn('⚠️ Continuing without AutoTLS - relay will work but without automatic TLS');
	}
}

const libp2pOptions = {
	// Include private key and datastore
	...(privateKey && { privateKey }),
	datastore,
	// metrics: prometheusMetrics(),
	addresses: {
		listen: [
			`/ip4/0.0.0.0/tcp/${tcpPort}`, // Direct TCP
			`/ip4/0.0.0.0/tcp/${wsPort}/ws`, // WebSocket for browsers
			// IPv6 addresses - optional, will fail gracefully if IPv6 not available
			...(process.env.DISABLE_IPV6 !== 'true'
				? [
						`/ip6/::/tcp/${tcpPort}`, // IPv6 TCP
						`/ip6/::/tcp/${wsPort}/ws` // IPv6 WebSocket
					]
				: []),
			'/p2p-circuit' // Circuit relay
			// Note: WebRTC transports don't support explicit listen addresses
			// They use STUN/TURN servers configured in the transport options
		],
		// Enhanced announce addresses with environment-aware configuration
		...(appendAnnounceArray.length > 0 && { appendAnnounce: appendAnnounceArray })
	},
	transports: [
		tcp(),
		circuitRelayTransport({
			discoverRelays: 1
		}),
		webRTC({
			rtcConfiguration: {
				iceServers: [
					{
						urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478']
					}
				]
			}
		}),
		webRTCDirect({
			rtcConfiguration: {
				iceServers: [
					{
						urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478']
					}
				]
			}
		}),
		webSockets()
	],
	peerDiscovery: [
		pubsubPeerDiscovery({
			interval: 5000, // Check every 5 seconds (more frequent than original)
			topics: (process.env.PUBSUB_TOPICS || 'todo._peer-discovery._p2p._pubsub')
				.split(',')
				.map((t) => t.trim()), // Configurable topics
			listenOnly: false,
			emitSelf: true
		})
	],
	connectionEncrypters: [noise()],
	connectionManager: {
		// Enhanced connection management from the reference
		inboundStreamProtocolNegotiationTimeout: 30000,
		inboundUpgradeTimeout: 30000,
		outboundStreamProtocolNegotiationTimeout: 30000,
		outboundUpgradeTimeout: 30000,
		maxConnections: 1000,
		maxIncomingPendingConnections: 100,
		maxPeerAddrsToDial: 100,
		dialTimeout: 30000
	},
	connectionGater: {
		denyDialMultiaddr: () => false
	},
	transportManager: {
		// Allow some addresses to fail without crashing (useful for IPv6 when not available)
		// Value 1 = NO_FATAL - allows some listen addresses to fail without crashing
		faultTolerance: 1
	},
	streamMuxers: [yamux()],
	services: {
		ping: ping(),
		autonat: autoNAT(),
		dcutr: dcutr(),
		identify: identify(),
		identifyPush: identifyPush(), // Add identify push service

		// Enhanced Kademlia DHT with better configuration
		// aminoDHT: kadDHT({
		// 	protocol: '/ipfs/kad/1.0.0',
		// 	peerInfoMapper: removePrivateAddressesMapper
		// }),

		// Enhanced gossipsub configuration
		pubsub: gossipsub({
			emitSelf: process.env.GOSSIP_EMIT_SELF === 'true',
			// Allow publishing even when no peers are subscribed (prevents crashes)
			allowPublishToZeroTopicPeers: process.env.GOSSIP_ALLOW_PUBLISH_ZERO_TOPIC !== 'false', // Default to true
			canRelayMessage: process.env.GOSSIP_CAN_RELAY_MESSAGE === 'true',
			gossipIncoming: process.env.GOSSIP_INCOMING === 'true',
			fallbackToFloodsub: process.env.GOSSIP_FALLBACK_TO_FLOODSUB === 'true',
			floodPublish: process.env.GOSSIP_FLOOD_PUBLISH === 'true',
			// Disable peer scoring to avoid blocking during development
			scoreParams: {
				gossipThreshold: Number(process.env.GOSSIP_SCORE_GOSSIP_THRESHOLD) || -Infinity,
				publishThreshold: Number(process.env.GOSSIP_SCORE_PUBLISH_THRESHOLD) || -Infinity,
				graylistThreshold: Number(process.env.GOSSIP_SCORE_GRAYLIST_THRESHOLD) || -Infinity,
				acceptPXThreshold: Number(process.env.GOSSIP_SCORE_ACCEPT_PX_THRESHOLD) || 0,
				opportunisticGraftThreshold:
					Number(process.env.GOSSIP_SCORE_OPPORTUNISTIC_GRAFT_THRESHOLD) || 0
			},
			// Enhanced mesh maintenance
			heartbeatInterval: Number(process.env.GOSSIP_HEARTBEAT_INTERVAL) || 1000
		}),

		// UPnP NAT traversal - only enabled if explicitly set
		...(upnpEnabled && { uPnPNAT: uPnPNAT() }),

		// Enhanced circuit relay server configuration
		relay: circuitRelayServer({
			// Production-ready relay configuration based on reference
			hopTimeout: Number(process.env.RELAY_HOP_TIMEOUT) || 30000, // 30 seconds
			reservations: {
				maxReservations: Number(process.env.RELAY_MAX_RESERVATIONS) || 10000, // Increased from 5000 to reasonable production limit
				reservationTtl: Number(process.env.RELAY_RESERVATION_TTL) || 2 * 60 * 60 * 1000, // 2 hours (matches reference)
				defaultDataLimit: BigInt(process.env.RELAY_DEFAULT_DATA_LIMIT || 1024 * 1024 * 1024), // 1GB
				defaultDurationLimit: Number(process.env.RELAY_DEFAULT_DURATION_LIMIT) || 2 * 60 * 1000 // 2 minutes
			}
		}),

		// Add keychain service for secure key management
		keychain: keychain(),

		// AutoTLS service for automatic SSL/TLS certificate management
		// Only enabled when not explicitly disabled and in production
		...(autoTLSService && { autoTLS: autoTLSService })
	}
};

// Use the options object
const server = await createLibp2p(libp2pOptions);

// Add the certificate:provision event listener here
const certificateHandler = () => {
	console.log('A TLS certificate was provisioned');

	const interval = setInterval(() => {
		const mas = server
			.getMultiaddrs()
			.filter((ma) => ma.toString().includes('/wss/') && ma.toString().includes('/sni/'))
			.map((ma) => ma.toString());

		if (mas.length > 0) {
			console.log('addresses:');
			console.log(mas.join('\n'));
			clearInterval(interval);
		}
	}, 1_000);
};
server.addEventListener('certificate:provision', certificateHandler);

// Datastore diagnostic function (from reference)
async function listDatastoreKeys() {
	try {
		const query = datastore.query({});
		let keyCount = 0;
		for await (const entry of query) {
			try {
				const keyStr = entry.key.toString();
				keyCount++;
				if (process.argv.includes('--verbose')) {
					console.log(`📋 Datastore key: ${keyStr}`);
				}
			} catch (err) {
				console.warn('⚠️ Invalid datastore entry:', err.message);
				// Auto-cleanup invalid keys
				if (entry && entry.key) {
					try {
						await datastore.delete(entry.key);
						console.log('🧹 Cleaned up invalid key:', entry.key.toString());
					} catch (deleteErr) {
						console.error('❌ Failed to delete invalid key:', deleteErr.message);
					}
				}
			}
		}
		console.log(`📊 Datastore contains ${keyCount} keys`);
	} catch (err) {
		console.warn('⚠️ Datastore diagnostic failed:', err.message);
	}
}

// Initialize the PinningService
const pinningService = new PinningService();

// Start the server
console.log('⏳ Starting libp2p node...');
await server.start();
console.log('✅ Libp2p node started successfully');

// Initialize PinningService with libp2p and storage
console.log('⏳ Initializing PinningService...');
await pinningService.initialize(server, datastore, blockstore);
console.log('✅ PinningService initialized successfully');

// Setup OrbitDB pinning event listeners
console.log('🔗 Setting up OrbitDB pinning event listeners...');

server.services.pubsub.addEventListener('subscription-change', (event) => {
	console.log('🔔 Raw subscription-change event:', JSON.stringify(event, null, 2));

	// Try different event structures
	const topic = event.detail?.topic || event.topic || event.detail?.subscription?.topic;
	const subscriptions = event.detail?.subscriptions || event.subscriptions;

	if (topic) {
		console.log('📡 Processing subscription change for topic:', topic);
		pinningService.handleSubscriptionChange(topic);
	}

	if (subscriptions && Array.isArray(subscriptions)) {
		subscriptions.forEach((sub) => {
			const subTopic = sub.topic || sub;
			if (subTopic) {
				console.log('📡 Processing subscription change for topic:', subTopic);
				pinningService.handleSubscriptionChange(subTopic);
			}
		});
	}
});

// Listen to pubsub messages with debugging
server.services.pubsub.addEventListener('message', (event) => {
	const message = event.detail;
	if (message && message.topic) {
		if (message.topic.startsWith('/orbitdb/')) {
			console.log('💬 OrbitDB pubsub message received:', {
				topic: message.topic,
				from: message.from?.toString()?.slice(0, 12) + '...',
				dataLength: message.data?.length
			});
		}
		pinningService.handlePubsubMessage(message);
	}
});

console.log('✅ OrbitDB pinning event listeners setup completed');

// Run datastore diagnostics (configurable via environment variable)
if (process.env.ENABLE_DATASTORE_DIAGNOSTICS === 'true') {
	console.log('🔍 Running datastore diagnostics...');
	await listDatastoreKeys();
} else {
	console.log(
		'🔍 Datastore diagnostics disabled (set ENABLE_DATASTORE_DIAGNOSTICS=true to enable)'
	);
}

// Enhanced peer tracking with more detailed metrics
let connectedPeers = new Map();
const discoveredPeers = new Set(); // Track discovered peers to avoid duplicate dial attempts
const peerStats = {
	totalConnections: 0,
	connectionsByTransport: {},
	peakConnections: 0
};

server.addEventListener('peer:discovery', async (event) => {
	const { id: peerId, multiaddrs } = event.detail;
	if (!peerId || !multiaddrs) return;

	const peerIdStr = peerId.toString();
	const peerIdShort = peerIdStr.slice(0, 12) + '...';

	// Skip if already connected
	const existingConnections = server.getConnections(peerId);
	if (existingConnections && existingConnections.length > 0) {
		console.log(`⏭️  [DISCOVERY] ${peerIdShort} - Already connected, skipping dial`);
		return;
	}

	// Skip if already discovered and dial attempt is in progress
	if (discoveredPeers.has(peerIdStr)) {
		console.log(`⏭️  [DISCOVERY] ${peerIdShort} - Already discovered, skipping duplicate`);
		return;
	}

	// Extract transport protocols from multiaddrs for logging
	const transports = [];
	multiaddrs.forEach((addr) => {
		const addrStr = addr.toString();
		if (addrStr.includes('/ws')) transports.push('websocket');
		else if (addrStr.includes('/webrtc-direct')) transports.push('webrtc-direct');
		else if (addrStr.includes('/webrtc')) transports.push('webrtc');
		else if (addrStr.includes('/tcp') && !addrStr.includes('/ws')) transports.push('tcp');
		else if (addrStr.includes('/p2p-circuit')) transports.push('circuit-relay');
	});

	console.log(
		`🔍 [DISCOVERY] Peer discovered: ${peerIdShort} | ` +
			`Full ID: ${peerIdStr} | ` +
			`Addresses: ${multiaddrs.length} | ` +
			`Transports: ${[...new Set(transports)].join(', ') || 'unknown'}`
	);

	if (process.argv.includes('--verbose')) {
		console.log(`   Multiaddrs:`);
		multiaddrs.forEach((addr) => console.log(`     - ${addr.toString()}`));
	}

	// Mark as discovered
	discoveredPeers.add(peerIdStr);

	// Attempt to dial the discovered peer by peerId
	try {
		console.log(`📞 [DIAL] Attempting to dial discovered peer: ${peerIdShort}`);
		const connection = await server.dial(peerId);
		if (connection) {
			console.log(`✅ [DIAL] Successfully initiated connection to: ${peerIdShort}`);
			// Connection will be confirmed in peer:connect event
		}
	} catch (error) {
		console.warn(`❌ [DIAL] Failed to dial peer ${peerIdShort}: ${error.message}`);
		// Remove from discovered set so we can retry later if discovered again
		discoveredPeers.delete(peerIdStr);
	}
});

server.addEventListener('peer:connect', async (event) => {
	const { remotePeer, remoteAddr } = event.detail;
	if (!remotePeer) return;

	const peerId = remotePeer.toString();
	const peerIdShort = `${peerId.slice(0, 12)}...`;
	const addr = remoteAddr?.toString() || 'unknown';

	// Remove from discovered set since we're now connected
	discoveredPeers.delete(peerId);

	// Enhanced transport detection
	let transport = 'unknown';
	if (addr.includes('/ws')) transport = 'websocket';
	else if (addr.includes('/webrtc-direct')) transport = 'webrtc-direct';
	else if (addr.includes('/webrtc')) transport = 'webrtc';
	else if (addr.includes('/tcp') && !addr.includes('/ws')) transport = 'tcp';
	else if (addr.includes('/p2p-circuit')) transport = 'circuit-relay';
	else if (addr.includes('/udp')) transport = 'udp';

	// Update statistics
	peerStats.totalConnections++;
	peerStats.connectionsByTransport[transport] =
		(peerStats.connectionsByTransport[transport] || 0) + 1;
	if (connectedPeers.size + 1 > peerStats.peakConnections) {
		peerStats.peakConnections = connectedPeers.size + 1;
	}

	// Store enhanced connection details
	connectedPeers.set(peerId, {
		peerId,
		peerIdShort,
		address: addr,
		transport,
		connectedAt: new Date().toISOString(),
		connectionCount: (connectedPeers.get(peerId)?.connectionCount || 0) + 1
	});

	console.log(
		`🤝 [CONNECT] ${peerIdShort} via ${transport.toUpperCase()} | ` +
			`Total: ${connectedPeers.size} | Peak: ${peerStats.peakConnections}`
	);

	// Structured logging for monitoring
	if (process.env.STRUCTURED_LOGS === 'true') {
		console.log(
			JSON.stringify({
				event: 'peer_connect',
				timestamp: new Date().toISOString(),
				peerId: peerIdShort,
				fullPeerId: peerId,
				address: addr,
				transport,
				totalConnectedPeers: connectedPeers.size,
				peakConnections: peerStats.peakConnections
			})
		);
	}
});

server.addEventListener('peer:disconnect', async (event) => {
	const { remotePeer } = event.detail;
	if (!remotePeer) return;

	const peerId = remotePeer.toString();
	const connectionInfo = connectedPeers.get(peerId);
	const peerIdShort = connectionInfo?.peerIdShort || `${peerId.slice(0, 8)}...`;

	// Calculate connection duration
	let duration = 'unknown';
	if (connectionInfo?.connectedAt) {
		const connectedTime = new Date(connectionInfo.connectedAt);
		const durationMs = Date.now() - connectedTime.getTime();
		duration = `${Math.round(durationMs / 1000)}s`;
	}

	connectedPeers.delete(peerId);
	// Also remove from discovered set if present
	discoveredPeers.delete(peerId);

	console.log(
		`👋 [DISCONNECT] ${peerIdShort} | Duration: ${duration} | ` +
			`Transport: ${connectionInfo?.transport || 'unknown'} | Remaining: ${connectedPeers.size}`
	);

	// Structured logging for monitoring
	if (process.env.STRUCTURED_LOGS === 'true') {
		console.log(
			JSON.stringify({
				event: 'peer_disconnect',
				timestamp: new Date().toISOString(),
				peerId: peerIdShort,
				fullPeerId: peerId,
				duration,
				transport: connectionInfo?.transport,
				totalConnectedPeers: connectedPeers.size
			})
		);
	}
});

// Enhanced logging
console.log('\n🎯 Relay Server Information:');
console.log('  Relay PeerId:', server.peerId.toString());
console.log('  Multiaddrs:');
server.getMultiaddrs().forEach((ma) => console.log(`    ${ma.toString()}`));
console.log('\n📡 Peer Discovery Configuration:');
const discoveryTopics = (process.env.PUBSUB_TOPICS || 'todo._peer-discovery._p2p._pubsub')
	.split(',')
	.map((t) => t.trim());
console.log(`  Discovery topics: ${discoveryTopics.join(', ')}`);
console.log(`  Discovery interval: 5000ms`);
console.log(`  Emit self: true`);
console.log(`  Listen only: false`);
console.log('✅ Relay ready to discover and connect to peers\n');

// Create and start HTTP API server using Express service
const app = createExpressServer(server, connectedPeers, peerStats, pinningService);
let httpServer;
try {
	httpServer = await startExpressServer(app, httpPort, server);
} catch (error) {
	console.error('❌ Failed to start HTTP server:', error);
	process.exit(1);
}

// Enhanced graceful shutdown
const gracefulShutdown = async (signal) => {
	console.log(`\n🛁 Received ${signal}, shutting down gracefully...`);

	try {
		if (httpServer) {
			console.log('⏳ Closing HTTP server...');
			await new Promise((resolve) => {
				httpServer.close(() => {
					console.log('✅ HTTP server closed');
					resolve();
				});
			});
		}

		console.log('⏳ Cleaning up PinningService...');
		await pinningService.cleanup();

		console.log('⏳ Stopping libp2p node...');
		await server.stop();

		console.log('⏳ Closing storage...');
		await closeStorage(storage);

		console.log('✅ Graceful shutdown completed');
	} catch (error) {
		console.error('❌ Error during shutdown:', error);
	}

	process.exit(0);
};

// Helper function to check if an error is a PublishError
function isPublishError(error) {
	if (!error) return false;
	const message = error.message || error.toString() || '';
	const name = error.name || '';
	return (
		message.includes('PublishError.NoPeersSubscribedToTopic') ||
		message.includes('NoPeersSubscribedToTopic') ||
		name === 'PublishError'
	);
}

// Global error handlers to prevent crashes from unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
	// Check if it's a PublishError.NoPeersSubscribedToTopic - this is not fatal
	if (isPublishError(reason)) {
		console.warn(
			'⚠️  [Relay] Gossipsub publish failed: No peers subscribed to topic (this is normal when no peers are connected)'
		);
		return; // Don't crash, just log and continue
	}

	// For other unhandled rejections, log but don't crash in production
	console.error('❌ [Relay] Unhandled promise rejection:', reason);
	if (isDevelopment) {
		console.error('Promise:', promise);
	}
});

process.on('uncaughtException', (error) => {
	// Check if it's a PublishError.NoPeersSubscribedToTopic - this is not fatal
	if (isPublishError(error)) {
		console.warn(
			'⚠️  [Relay] Gossipsub publish failed: No peers subscribed to topic (this is normal when no peers are connected)'
		);
		return; // Don't crash, just log and continue
	}

	// For other uncaught exceptions, log and exit
	console.error('❌ [Relay] Uncaught exception:', error);
	if (isDevelopment) {
		console.error('Stack:', error.stack);
	}
	// In production, we might want to exit, but for now just log
});

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Periodic status logging (every 5 minutes)
setInterval(
	() => {
		const pinningStats = pinningService.getDetailedStats();
		console.log(
			`📊 Status: ${connectedPeers.size} peers connected, ` +
				`${peerStats.totalConnections} total connections, ` +
				`${Math.round(process.uptime())}s uptime`
		);
		console.log(
			`📌 Pinning: ${pinningStats.totalPinned} databases pinned, ` +
				`${pinningStats.syncOperations} syncs, ` +
				`${pinningStats.failedSyncs} failures, ` +
				`queue: ${pinningStats.queueSize}/${pinningStats.queuePending}`
		);
		// Note: Storacha bridge stats removed since we don't have it
	},
	5 * 60 * 1000
);
