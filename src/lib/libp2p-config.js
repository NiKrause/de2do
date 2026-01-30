// libp2p-config.js
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify, identifyPush } from '@libp2p/identify';
import { dcutr } from '@libp2p/dcutr';
import { autoNAT } from '@libp2p/autonat';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { bootstrap } from '@libp2p/bootstrap';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { ping } from '@libp2p/ping';
// Environment variables
const RELAY_BOOTSTRAP_ADDR_DEV =
	import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_DEV ||
	'/ip4/127.0.0.1/tcp/4102/ws/p2p/12D3KooWMYQPkgu3qSWjRXmabEL1QSE9BV9DjFfXt4ANJTQABa8E';
const RELAY_BOOTSTRAP_ADDR_PROD =
	import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_PROD ||
	'/dns4/91-99-67-170.k51qzi5uqu5dl6dk0zoaocksijnghdrkxir5m4yfcodish4df6re6v3wbl6njf.libp2p.direct/tcp/4002/wss/p2p/12D3KooWPJYEZSwfmRL9SHehYAeQKEbCvzFu7vtKWb6jQfMSMb8W';
const PUBSUB_TOPICS = (import.meta.env.VITE_PUBSUB_TOPICS || 'todo._peer-discovery._p2p._pubsub')
	.split(',')
	.map((t) => t.trim());

// Determine which relay address to use based on environment
const isDevelopment = import.meta.env.DEV || import.meta.env.VITE_NODE_ENV === 'development';
console.log('isDevelopment', isDevelopment);
export const RELAY_BOOTSTRAP_ADDR = (
	isDevelopment ? RELAY_BOOTSTRAP_ADDR_DEV : RELAY_BOOTSTRAP_ADDR_PROD
)
	.split(',')
	.map((addr) => addr.trim());
console.log('RELAY_BOOTSTRAP_ADDR', RELAY_BOOTSTRAP_ADDR);

export async function createLibp2pConfig(options = {}) {
	const {
		privateKey = null,
		enableNetworkConnection = true,
		// eslint-disable-next-line no-unused-vars
		enablePeerConnections = true
	} = options;

	// Get fixed peer ID from environment variable
	const testPeerId = import.meta.env.VITE_TEST_PEER_ID;
	let finalPrivateKey = privateKey;

	if (testPeerId && !finalPrivateKey) {
		try {
			finalPrivateKey = privateKeyFromProtobuf(uint8ArrayFromString(testPeerId, 'hex'));
		} catch (error) {
			console.warn('Invalid test peer ID, generating random key:', error);
		}
	}

	// Configure peer discovery - always enable pubsub peer discovery when network is enabled
	const peerDiscoveryServices = [];
	if (enableNetworkConnection) {
		console.log('🔍 Enabling pubsub peer discovery');
		peerDiscoveryServices.push(
			pubsubPeerDiscovery({
				interval: 3000, // Match example: 10 seconds
				topics: PUBSUB_TOPICS,
				listenOnly: false,
				emitSelf: true
			})
		);
	}

	// Configure services based on network connection preference
	const services = {
		identify: identify(),
		identifyPush: identifyPush(), // Enable identify push for better peer info updates
		pubsub: gossipsub({
			emitSelf: false, // Don't emit our own messages (matches example project)
			allowPublishToZeroTopicPeers: true
		}),
		ping: ping()
	};
	// Only add bootstrap service if network connections are enabled
	if (enableNetworkConnection) {
		console.log('🔍 Enabling bootstrap, pubsub, autonat, dcutr services');
		services.bootstrap = bootstrap({ list: RELAY_BOOTSTRAP_ADDR });
		services.autonat = autoNAT();
		services.dcutr = dcutr();
	}

	return {
		...(finalPrivateKey && { privateKey: finalPrivateKey }),
		addresses: {
			listen: enableNetworkConnection ? ['/p2p-circuit', '/webrtc'] : ['/webrtc'] // Only local WebRTC when network connection is disabled
		},
		transports: enableNetworkConnection
			? [
					webSockets(),
					webRTCDirect({
						rtcConfiguration: {
							iceServers: [
								{
									urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478']
								}
							]
						}
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
					circuitRelayTransport({
						reservationCompletionTimeout: 20000 // Timeout for relay reservation
					})
				]
			: [webRTC(), circuitRelayTransport({ discoverRelays: 1 })], // Only WebRTC transport when network connection is disabled
		connectionEncrypters: [noise()],
		connectionGater: {
			denyDialMultiaddr: () => false
		},
		connectionManager: {
			inboundStreamProtocolNegotiationTimeout: 10000,
			inboundUpgradeTimeout: 10000,
			outboundStreamProtocolNegotiationTimeout: 10000,
			outboundUpgradeTimeout: 10000
		},
		streamMuxers: [yamux()],
		peerDiscovery: peerDiscoveryServices,
		// peerDiscovery: [
		// 	pubsubPeerDiscovery({
		// 		interval: 5000, // More frequent broadcasting
		// 		topics: PUBSUB_TOPICS, // Configurable topics
		// 		listenOnly: false,
		// 		emitSelf: true // Enable even when no peers are present initially
		// 	})
		// ],
		//
		services
	};
}

// Usage example:
// const config = await createLibp2pConfig({ enablePeerConnections: true, enableNetworkConnection: true, privateKey: null })
// const libp2p = await createLibp2p(config)
