<script>
	import { onDestroy } from 'svelte';
	import { writable } from 'svelte/store';
	import { formatPeerId } from './utils.js';
	import TransportBadge from './TransportBadge.svelte';

	// Plugin interface - only needs libp2p instance
	export let libp2p = null;
	export let title = 'Connected Peers';
	export let emptyMessage = 'No peers connected yet.';
	export let showOnlineIndicator = true;
	export let autoConnect = true;

	// Internal state - completely self-contained
	const peers = writable([]);
	let currentPeers = [];
	peers.subscribe((p) => (currentPeers = p));

	// Internal peer management state
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const discoveredPeersInfo = new Map();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const peerConnectionTransports = new Map();
	let eventListeners = [];

	// Initialize when libp2p instance is provided
	$: if (libp2p) {
		initializePeerManagement();
	}

	function initializePeerManagement() {
		console.log('🔍 ConnectedPeers: Setting up peer management...');

		// Clean up any existing listeners
		cleanup();

		// Check for existing connections first
		checkExistingConnections();

		// Set up peer discovery handlers
		setupPeerDiscoveryHandlers();
	}

	function checkExistingConnections() {
		if (!libp2p) return;

		console.log('🔍 Checking for existing connections...');
		const allConnections = libp2p.getConnections();

		allConnections.forEach((connection) => {
			const peerIdStr = connection.remotePeer.toString();

			// Skip if already in our peers list
			if (currentPeers.some((peer) => peer.peerId === peerIdStr)) {
				return;
			}

			console.log('🔗 Found existing connection to:', formatPeerId(peerIdStr));

			// Extract transports from the connection
			const transports = extractTransportsFromConnection(connection);

			// Add to peers list
			peers.update((peers) => [
				...peers,
				{
					peerId: peerIdStr,
					transports: transports.length > 0 ? transports : ['websocket'] // fallback
				}
			]);

			// Track connection transports
			if (!peerConnectionTransports.has(peerIdStr)) {
				peerConnectionTransports.set(peerIdStr, new Map());
			}
			peerConnectionTransports.get(peerIdStr).set(connection.id, new Set(transports));
		});
	}

	function setupPeerDiscoveryHandlers() {
		// Handle peer discovery events
		const onPeerDiscovery = async (event) => {
			const { id: peerId, multiaddrs } = event.detail;
			const peerIdStr = peerId?.toString();

			console.log('🔍 Peer discovered:', formatPeerId(peerIdStr));

			// Skip if already discovered
			if (currentPeers.some((peer) => peer.peerId === peerIdStr)) {
				return;
			}

			// Skip if already connected
			const existingConnections = libp2p.getConnections(peerId);
			if (existingConnections?.length > 0) {
				return;
			}

			// Extract transport protocols
			const detectedTransports = extractTransportsFromMultiaddrs(multiaddrs);

			// Store peer info
			discoveredPeersInfo.set(peerIdStr, {
				peerId: peerIdStr,
				transports: detectedTransports,
				multiaddrs: multiaddrs
			});

			// Auto-connect if enabled
			if (autoConnect) {
				try {
					await libp2p.dial(peerId);
				} catch (error) {
					console.warn('❌ Failed to connect to peer:', formatPeerId(peerIdStr), error.message);
					discoveredPeersInfo.delete(peerIdStr);
				}
			}
		};

		// Handle successful connections
		const onPeerConnect = (event) => {
			const peerId = event.detail;
			const peerIdStr = peerId?.toString();

			if (!peerIdStr) return;

			// Add to peers list if not already there
			const existingPeer = currentPeers.find((peer) => peer.peerId === peerIdStr);
			if (!existingPeer) {
				const storedPeerInfo = discoveredPeersInfo.get(peerIdStr);
				const transports = storedPeerInfo?.transports || ['webrtc'];

				peers.update((peers) => [...peers, { peerId: peerIdStr, transports }]);
				discoveredPeersInfo.delete(peerIdStr);
			}
		};

		// Handle disconnections
		const onPeerDisconnect = (event) => {
			const peerId = event.detail.id || event.detail;
			const peerIdStr = peerId?.toString();

			if (!peerIdStr) return;

			peers.update((peers) => peers.filter((peer) => peer.peerId !== peerIdStr));
			discoveredPeersInfo.delete(peerIdStr);
			peerConnectionTransports.delete(peerIdStr);
		};

		// Handle connection events for transport tracking
		const onConnectionOpen = (event) => {
			const connection = event.detail;
			const peerIdStr = connection.remotePeer?.toString();

			if (!peerIdStr) return;

			const connectionTransports = extractTransportsFromConnection(connection);

			if (connectionTransports.length > 0) {
				if (!peerConnectionTransports.has(peerIdStr)) {
					peerConnectionTransports.set(peerIdStr, new Map());
				}
				peerConnectionTransports.get(peerIdStr).set(connection.id, new Set(connectionTransports));
				updatePeerTransports(peerIdStr);
			}
		};

		const onConnectionClose = (event) => {
			const connection = event.detail;
			const peerIdStr = connection.remotePeer?.toString();

			if (!peerIdStr) return;

			if (peerConnectionTransports.has(peerIdStr)) {
				const peerConnections = peerConnectionTransports.get(peerIdStr);
				peerConnections.delete(connection.id);

				if (peerConnections.size === 0) {
					peerConnectionTransports.delete(peerIdStr);
				} else {
					updatePeerTransports(peerIdStr);
				}
			}
		};

		// Register event listeners
		libp2p.addEventListener('peer:discovery', onPeerDiscovery);
		libp2p.addEventListener('peer:connect', onPeerConnect);
		libp2p.addEventListener('peer:disconnect', onPeerDisconnect);
		libp2p.addEventListener('connection:open', onConnectionOpen);
		libp2p.addEventListener('connection:close', onConnectionClose);

		// Store references for cleanup
		eventListeners = [
			{ event: 'peer:discovery', handler: onPeerDiscovery },
			{ event: 'peer:connect', handler: onPeerConnect },
			{ event: 'peer:disconnect', handler: onPeerDisconnect },
			{ event: 'connection:open', handler: onConnectionOpen },
			{ event: 'connection:close', handler: onConnectionClose }
		];
	}

	// Helper functions (moved from p2p.js)
	function extractTransportsFromMultiaddrs(multiaddrs) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const transports = new Set();

		multiaddrs.forEach((multiaddr) => {
			const addrStr = multiaddr.toString();

			if (addrStr.includes('/webrtc')) transports.add('webrtc');
			if (addrStr.includes('/ws') || addrStr.includes('/wss')) transports.add('websocket');
			if (addrStr.includes('/webtransport')) transports.add('webtransport');
			if (addrStr.includes('/p2p-circuit')) transports.add('circuit-relay');
		});

		return Array.from(transports);
	}

	function extractTransportsFromConnection(connection) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const transports = new Set();

		if (!connection.remoteAddr) return [];

		const addrStr = connection.remoteAddr.toString();

		if (addrStr.includes('/webrtc') && !addrStr.includes('/p2p-circuit')) {
			transports.add('webrtc');
		} else if (addrStr.includes('/p2p-circuit')) {
			transports.add('circuit-relay');
		} else if (addrStr.includes('/webtransport')) {
			transports.add('webtransport');
		} else if (
			(addrStr.includes('/ws') || addrStr.includes('/wss')) &&
			!addrStr.includes('/p2p-circuit')
		) {
			transports.add('websocket');
		} else if (addrStr.includes('/tcp/')) {
			transports.add('tcp');
		}

		return Array.from(transports);
	}

	function updatePeerTransports(peerIdStr) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const allTransports = new Set();

		if (peerConnectionTransports.has(peerIdStr)) {
			const peerConnections = peerConnectionTransports.get(peerIdStr);
			for (const [, connectionTransports] of peerConnections) {
				for (const transport of connectionTransports) {
					allTransports.add(transport);
				}
			}
		}

		peers.update((peers) => {
			const peerIndex = peers.findIndex((peer) => peer.peerId === peerIdStr);
			if (peerIndex !== -1) {
				const updatedPeers = [...peers];
				updatedPeers[peerIndex] = {
					...updatedPeers[peerIndex],
					transports: Array.from(allTransports)
				};
				return updatedPeers;
			}
			return peers;
		});
	}

	// Public API for external control
	export function disconnectPeer(peerId) {
		if (!libp2p) return;

		const connections = libp2p.getConnections(peerId);
		connections.forEach((conn) => conn.close());
	}

	export function reconnectPeer(peerId) {
		if (!libp2p) return;

		const peerInfo = discoveredPeersInfo.get(peerId);
		if (peerInfo) {
			return libp2p.dial(peerInfo.multiaddrs);
		}
	}

	export function getPeers() {
		return currentPeers;
	}

	// Cleanup
	function cleanup() {
		if (libp2p && eventListeners.length > 0) {
			eventListeners.forEach(({ event, handler }) => {
				libp2p.removeEventListener(event, handler);
			});
		}
		eventListeners = [];
		discoveredPeersInfo.clear();
		peerConnectionTransports.clear();
	}

	onDestroy(cleanup);
</script>

<div class="rounded-lg bg-white p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold">{title} ({$peers.length})</h2>
	{#if $peers.length > 0}
		<div class="space-y-2">
			{#each $peers as peer (peer.peerId)}
				<div class="flex items-center space-x-2">
					{#if showOnlineIndicator}
						<div class="h-2 w-2 rounded-full bg-green-500" title="Online"></div>
					{/if}
					<code class="rounded bg-gray-100 px-2 py-1 text-sm">{formatPeerId(peer.peerId)}</code>
					{#each peer.transports as transport (transport)}
						<TransportBadge {transport} />
					{/each}

					<!-- Optional: Add action buttons -->
					<button
						on:click={() => disconnectPeer(peer.peerId)}
						class="text-xs text-red-600 hover:text-red-800"
						title="Disconnect peer"
					>
						✕
					</button>
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-gray-500">{emptyMessage}</p>
	{/if}
</div>
