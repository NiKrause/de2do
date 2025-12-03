<script>
	import { onDestroy } from 'svelte';
	import { writable } from 'svelte/store';
	import { formatPeerId } from '../../utils.js';
	import TransportBadge from './TransportBadge.svelte';
	import { systemToasts } from '../../toast-store.js';

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
			if (!connection?.remotePeer) return;
			const peerIdStr = connection?.remotePeer?.toString();
			if (!peerIdStr) return;

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

			// Check existing connections
			const existingConnections = libp2p.getConnections(peerId);

			// Extract transport protocols from discovered addresses
			const detectedTransports = extractTransportsFromMultiaddrs(multiaddrs);
			const hasWebRTCAddress = detectedTransports.includes('webrtc');

			// Check if we only have relay connections
			const hasOnlyRelayConnection =
				existingConnections?.length > 0 &&
				existingConnections.every((conn) => {
					const addr = conn.remoteAddr?.toString() || '';
					return addr.includes('/p2p-circuit');
				});

			// Check if we have any direct (non-relay) connection
			const hasDirectConnection =
				existingConnections?.length > 0 &&
				existingConnections.some((conn) => {
					const addr = conn.remoteAddr?.toString() || '';
					return !addr.includes('/p2p-circuit');
				});

			// Skip only if we already have a direct connection
			// Allow dialing if: no connection, only relay connection, or discovered new WebRTC addresses
			if (hasDirectConnection) {
				console.log(
					'✅ Already have direct connection to:',
					formatPeerId(peerIdStr),
					'- skipping dial'
				);
				return;
			}

			// Log upgrade opportunity
			if (hasOnlyRelayConnection && hasWebRTCAddress) {
				console.log(
					'🚀 Attempting WebRTC upgrade for relay-connected peer:',
					formatPeerId(peerIdStr)
				);
			} else if (hasOnlyRelayConnection) {
				console.log(
					'🔄 Attempting to dial relay-connected peer with new addresses:',
					formatPeerId(peerIdStr)
				);
			}

			// Store peer info
			discoveredPeersInfo.set(peerIdStr, {
				peerId: peerIdStr,
				transports: detectedTransports,
				multiaddrs: multiaddrs
			});

			// Auto-connect if enabled
			if (autoConnect) {
				try {
					// Prefer dialing the discovered multiaddrs (bias towards WebRTC)
					await libp2p.dial(multiaddrs);
					console.log('✅ Dialed discovered multiaddrs for:', formatPeerId(peerIdStr));
				} catch (err1) {
					console.warn(
						'⚠️ Dial via multiaddrs failed, falling back to peerId:',
						formatPeerId(peerIdStr),
						err1?.message
					);
					try {
						await libp2p.dial(peerId);
						console.log('✅ Fallback dial by peerId succeeded for:', formatPeerId(peerIdStr));
					} catch (err2) {
						console.warn('❌ Failed to connect to peer:', formatPeerId(peerIdStr), err2?.message);
						// Don't delete peer info if we already have a relay connection
						if (!hasOnlyRelayConnection) {
							discoveredPeersInfo.delete(peerIdStr);
						}
					}
				}
			}
		};

		// Handle successful connections
		const onPeerConnect = (event) => {
			if (!event?.detail) return;
			// In libp2p v3, event.detail can be either a peerId directly or an object
			const peerId = event.detail?.id || event.detail?.remotePeer || event.detail;
			const peerIdStr = peerId?.toString();

			if (!peerIdStr) return;

			console.log(`✅ Connected to peer ${peerIdStr}`);
			systemToasts.showPeerConnected(peerIdStr);

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
			if (!event?.detail) return;
			// In libp2p v3, event.detail can be either a peerId directly or an object
			const peerId = event.detail?.id || event.detail?.remotePeer || event.detail;
			const peerIdStr = peerId?.toString();

			if (!peerIdStr) return;

			console.log(`❌ Disconnected from peer ${peerIdStr}`);
			systemToasts.showPeerDisconnected(peerIdStr);

			peers.update((peers) => peers.filter((peer) => peer.peerId !== peerIdStr));
			discoveredPeersInfo.delete(peerIdStr);
			peerConnectionTransports.delete(peerIdStr);
		};

		// Handle connection events for transport tracking
		const onConnectionOpen = (event) => {
			console.log('🔍 Connection open event:', event);
			if (!event?.detail) return;
			const connection = event.detail;
			if (!connection?.remotePeer) return;
			const peerIdStr = connection?.remotePeer?.toString();

			if (!peerIdStr) return;

			const connectionTransports = extractTransportsFromConnection(connection);
			console.log(
				`🔍 Connection opened to ${peerIdStr.slice(0, 12)}... transports:`,
				connectionTransports
			);

			// Detect DCUtR upgrade: check if we had a relay connection and now have a direct connection
			if (libp2p) {
				const existingConnections = libp2p.getConnections(peerIdStr);
				if (existingConnections && existingConnections.length > 0) {
					// Check if we had a relay connection before
					const hadRelayConnection = existingConnections.some((conn) => {
						if (conn.id === connection.id) return false; // Skip the new connection itself
						const connAddr = conn.remoteAddr?.toString() || '';
						return connAddr.includes('/p2p-circuit');
					});

					// Check if the new connection is direct (not relay)
					const isDirectConnection =
						connectionTransports.some(
							(t) => t === 'webrtc' || t === 'websocket' || t === 'webtransport'
						) && !connectionTransports.includes('circuit-relay');

					// Check connection timeline for upgrade info
					const wasUpgraded = connection.timeline?.upgraded !== undefined;

					if (hadRelayConnection && isDirectConnection) {
						console.log(`🚀 DCUtR: Connection upgraded from relay to direct!`, {
							peerId: peerIdStr.slice(0, 12) + '...',
							directTransport: connectionTransports,
							connectionId: connection.id,
							wasUpgraded: wasUpgraded,
							upgradeTime: connection.timeline?.upgraded
						});
					}
				}
			}

			if (connectionTransports.length > 0) {
				if (!peerConnectionTransports.has(peerIdStr)) {
					peerConnectionTransports.set(peerIdStr, new Map());
				}
				peerConnectionTransports.get(peerIdStr).set(connection.id, new Set(connectionTransports));
				updatePeerTransports(peerIdStr);
			} else {
				console.warn(
					`⚠️ Connection opened but no transports detected for ${peerIdStr.slice(0, 12)}...`
				);
			}
		};

		const onConnectionClose = (event) => {
			console.log('🔍 Connection close event:', event);
			if (!event?.detail) return;
			const connection = event.detail;
			if (!connection?.remotePeer) return;
			const peerIdStr = connection?.remotePeer?.toString();

			if (!peerIdStr) return;

			// Check if this was a relay connection
			const wasRelayConnection = connection.remoteAddr?.toString().includes('/p2p-circuit');

			// Remove from tracking map
			if (peerConnectionTransports.has(peerIdStr)) {
				const peerConnections = peerConnectionTransports.get(peerIdStr);
				peerConnections.delete(connection.id);
			}

			// Always refresh from live connections to ensure accuracy
			if (libp2p) {
				const remainingConnections = libp2p.getConnections(peerIdStr);
				if (!remainingConnections || remainingConnections.length === 0) {
					// No more connections, remove peer from list
					peers.update((peers) => peers.filter((peer) => peer.peerId !== peerIdStr));
					peerConnectionTransports.delete(peerIdStr);
				} else {
					// Check if we still have direct connections (DCUtR upgrade scenario)
					const hasDirectConnection = remainingConnections.some((conn) => {
						const addr = conn.remoteAddr?.toString() || '';
						return (
							(addr.includes('/webrtc') || addr.includes('/ws') || addr.includes('/wss')) &&
							!addr.includes('/p2p-circuit')
						);
					});

					if (wasRelayConnection && hasDirectConnection) {
						console.log(`🚀 DCUtR: Relay connection closed, direct connection active!`, {
							peerId: peerIdStr.slice(0, 12) + '...',
							remainingConnections: remainingConnections.length
						});
					}

					// Still have connections, update transports from live connections
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
			console.log('🔍 Multiaddr:', multiaddr.toString());
			const addrStr = multiaddr.toString();

			if (addrStr.startsWith('/webrtc')) transports.add('webrtc');
			if (addrStr.includes('/ws') || addrStr.includes('/wss')) transports.add('websocket');
			if (addrStr.includes('/webtransport')) transports.add('webtransport');
			if (addrStr.includes('/p2p-circuit')) transports.add('circuit-relay');
		});

		return Array.from(transports);
	}

	function extractTransportsFromConnection(connection) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const transports = new Set();

		// Check remoteAddr first (primary method)
		if (connection.remoteAddr) {
			const addrStr = connection.remoteAddr.toString();
			console.log(
				'�� Connection address:',
				addrStr,
				'for peer:',
				connection.remotePeer?.toString().slice(0, 12)
			);

			// Check for WebRTC (both /webrtc and /webrtc-direct)
			if (
				(addrStr.includes('/webrtc') || addrStr.includes('/webrtc-direct')) &&
				!addrStr.includes('/p2p-circuit')
			) {
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
		}

		// Fallback: Check connection stat.transport if remoteAddr is not available
		if (transports.size === 0 && connection.stat) {
			const transport = connection.stat.transport;
			if (transport) {
				const transportStr = transport.toString().toLowerCase();
				if (transportStr.includes('webrtc')) {
					transports.add('webrtc');
				} else if (transportStr.includes('websocket') || transportStr.includes('ws')) {
					transports.add('websocket');
				} else if (transportStr.includes('circuit') || transportStr.includes('relay')) {
					transports.add('circuit-relay');
				}
			}
		}

		// If still no transport detected, log for debugging
		if (transports.size === 0) {
			console.warn('⚠️ Could not detect transport for connection:', {
				hasRemoteAddr: !!connection.remoteAddr,
				remoteAddr: connection.remoteAddr?.toString(),
				hasStat: !!connection.stat,
				statTransport: connection.stat?.transport?.toString(),
				connectionId: connection.id
			});
		}

		return Array.from(transports);
	}

	function updatePeerTransports(peerIdStr) {
		// Use live connections as the source of truth
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const allTransports = new Set();

		if (libp2p) {
			const connections = libp2p.getConnections(peerIdStr);
			if (connections && connections.length > 0) {
				connections.forEach((conn) => {
					const connTransports = extractTransportsFromConnection(conn);
					connTransports.forEach((t) => allTransports.add(t));
				});

				// Also update the tracking map to keep it in sync
				if (!peerConnectionTransports.has(peerIdStr)) {
					peerConnectionTransports.set(peerIdStr, new Map());
				}
				const peerConnections = peerConnectionTransports.get(peerIdStr);
				// Clear old tracking and rebuild from live connections
				peerConnections.clear();
				connections.forEach((conn) => {
					const connTransports = extractTransportsFromConnection(conn);
					if (connTransports.length > 0) {
						peerConnections.set(conn.id, new Set(connTransports));
					}
				});
			} else {
				// No connections, remove from tracking
				peerConnectionTransports.delete(peerIdStr);
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
			// If peer not in list yet, add it (shouldn't happen, but be safe)
			if (allTransports.size > 0) {
				return [...peers, { peerId: peerIdStr, transports: Array.from(allTransports) }];
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
