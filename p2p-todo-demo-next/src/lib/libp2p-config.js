// libp2p-config.js
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { dcutr } from '@libp2p/dcutr';
import { autoNAT } from '@libp2p/autonat';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { bootstrap } from '@libp2p/bootstrap';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import * as filters from '@libp2p/websockets/filters';

// Environment variables
const RELAY_BOOTSTRAP_ADDR_DEV =
	import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_DEV ||
	'/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE';
const RELAY_BOOTSTRAP_ADDR_PROD =
	import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_PROD ||
	'/dns4/91-99-67-170.k51qzi5uqu5dl6dk0zoaocksijnghdrkxir5m4yfcodish4df6re6v3wbl6njf.libp2p.direct/tcp/4002/wss/p2p/12D3KooWPJYEZSwfmRL9SHehYAeQKEbCvzFu7vtKWb6jQfMSMb8W';
const PUBSUB_TOPICS = (import.meta.env.VITE_PUBSUB_TOPICS || 'todo._peer-discovery._p2p._pubsub')
	.split(',')
	.map((t) => t.trim());

// Determine which relay address to use based on environment
const isDevelopment = import.meta.env.DEV || import.meta.env.VITE_NODE_ENV === 'development';
console.log('isDevelopment', isDevelopment);
const RELAY_BOOTSTRAP_ADDR = (isDevelopment ? RELAY_BOOTSTRAP_ADDR_DEV : RELAY_BOOTSTRAP_ADDR_PROD)
	.split(',')
	.map((addr) => addr.trim());
console.log('RELAY_BOOTSTRAP_ADDR', RELAY_BOOTSTRAP_ADDR);

export async function createLibp2pConfig(privateKey = null) {
	// Get fixed peer ID from environment variable
	const testPeerId = import.meta.env.VITE_TEST_PEER_ID;

	if (testPeerId && !privateKey) {
		try {
			privateKey = privateKeyFromProtobuf(uint8ArrayFromString(testPeerId, 'hex'));
		} catch (error) {
			console.warn('Invalid test peer ID, generating random key:', error);
		}
	}

	return {
		...(privateKey && { privateKey }),
		addresses: {
			listen: ['/p2p-circuit', '/webrtc', '/webtransport', '/wss', '/ws']
		},
		transports: [
			webSockets({
				filter: filters.all
			}),
			webRTC(),
			circuitRelayTransport({
				discoverRelays: 1
			})
		],
		connectionEncrypters: [noise()],
		connectionGater: {
			denyDialMultiaddr: () => false,
			denyDialPeer: () => false,
			denyInboundConnection: () => false,
			denyOutboundConnection: () => false,
			denyInboundEncryptedConnection: () => false,
			denyOutboundEncryptedConnection: () => false,
			denyInboundUpgradedConnection: () => false,
			denyOutboundUpgradedConnection: () => false
		},
		streamMuxers: [yamux()],
		peerDiscovery: [
			pubsubPeerDiscovery({
				interval: 5000, // More frequent broadcasting
				topics: PUBSUB_TOPICS, // Configurable topics
				listenOnly: false,
				emitSelf: true // Enable even when no peers are present initially
			})
		],
		services: {
			identify: identify(),
			bootstrap: bootstrap({ list: RELAY_BOOTSTRAP_ADDR }),
			//   ping: ping(),
			dcutr: dcutr(),
			autonat: autoNAT(),
			pubsub: gossipsub({
				emitSelf: true, // Enable to see our own messages
				allowPublishToZeroTopicPeers: true
			})
		}
	};
}

// Usage example:
// const config = await createLibp2pConfig()
// const libp2p = await createLibp2p(config)
