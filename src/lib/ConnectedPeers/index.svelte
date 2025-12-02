<script>
	import { onDestroy } from 'svelte';
	import { writable } from 'svelte/store';
	import { formatPeerId } from '../utils.js';
	import TransportBadge from '../TransportBadge';
	import { systemToasts } from '../toast-store.js';

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

	// Add periodic refresh of connections (like the example)
	let refreshInterval;

	$: if (libp2p) {
		// Clean up any existing listeners first
		cleanup();

		// Check for existing connections once on init
		refreshConnectionsFromLibp2p();

		// Set up event-based peer discovery handlers
		setupPeerDiscoveryHandlers();
	}

	function refreshConnectionsFromLibp2p() {
		if (!libp2p) return;

		const allConnections = libp2p.getConnections();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const peerMap = new Map();

		// Group connections by peer ID
		allConnections.forEach((connection) => {
			console.log('🔍 Connection:', connection);
			if (!connection?.remotePeer) return;
			const peerIdStr = connection.remotePeer.toString();

			if (!peerMap.has(peerIdStr)) {
				peerMap.set(peerIdStr, []);
			}
			peerMap.get(peerIdStr).push(connection);
		});

		// Update peers list with all discovered connections
		const newPeers = Array.from(peerMap.entries()).map(([peerIdStr, connections]) => {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const transports = new Set();
			connections.forEach((conn) => {
				const connTransports = extractTransportsFromConnection(conn);
				connTransports.forEach((t) => transports.add(t));
			});

			return {
				peerId: peerIdStr,
				transports: Array.from(transports)
			};
		});

		// Update peers store
		peers.set(newPeers);
	}

	function setupPeerDiscoveryHandlers() {
		// Handle peer discovery events
		const onPeerDiscovery = async (event) => {
			if (!event?.detail) return;
			const { id: peerId, multiaddrs } = event.detail || {};
			if (!peerId || !multiaddrs) return;
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
				// Get actual transports from all active connections for this peer
				const connections = libp2p.getConnections(peerId);
				// eslint-disable-next-line svelte/prefer-svelte-reactivity
				const allTransports = new Set();
				if (connections && connections.length > 0) {
					connections.forEach((conn) => {
						const connTransports = extractTransportsFromConnection(conn);
						connTransports.forEach((t) => allTransports.add(t));
					});
				}

				// Fallback to discovery info if no connections yet, or default to webrtc
				const transports =
					allTransports.size > 0
						? Array.from(allTransports)
						: discoveredPeersInfo.get(peerIdStr)?.transports || ['webrtc'];

				peers.update((peers) => [...peers, { peerId: peerIdStr, transports }]);
				discoveredPeersInfo.delete(peerIdStr);

				// Track all connections for this peer
				if (connections && connections.length > 0) {
					if (!peerConnectionTransports.has(peerIdStr)) {
						peerConnectionTransports.set(peerIdStr, new Map());
					}
					connections.forEach((conn) => {
						const connTransports = extractTransportsFromConnection(conn);
						if (connTransports.length > 0) {
							peerConnectionTransports.get(peerIdStr).set(conn.id, new Set(connTransports));
						}
					});
				}
			} else {
				// Peer already exists, refresh transports from actual connections
				const connections = libp2p.getConnections(peerId);
				if (connections && connections.length > 0) {
					if (!peerConnectionTransports.has(peerIdStr)) {
						peerConnectionTransports.set(peerIdStr, new Map());
					}
					connections.forEach((conn) => {
						const connTransports = extractTransportsFromConnection(conn);
						if (connTransports.length > 0) {
							peerConnectionTransports.get(peerIdStr).set(conn.id, new Set(connTransports));
						}
					});
					updatePeerTransports(peerIdStr);
				}
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
		if (refreshInterval) {
			clearInterval(refreshInterval);
			refreshInterval = null;
		}
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
