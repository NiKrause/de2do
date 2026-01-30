<script>
	import { peerIdStore, currentIdentityStore } from '$lib/stores.js';
	import { libp2pStore } from '$lib/p2p.js';

	let showPeerList = $state(false);
	let hoveredPeerId = $state(null);
	let peers = $state([]);
	let peerMultiaddrs = $state(new Map());
	let hideTimeout = null;
	let peerCount = $state(0);

	// Subscribe to stores using $derived
	let peerId = $derived($peerIdStore);
	let identity = $derived($currentIdentityStore);
	let libp2p = $derived($libp2pStore);

	// Format PeerID - last 5 chars
	let shortPeerId = $derived(peerId ? `...${peerId.slice(-5)}` : '-----');

	// Format DID - first 5 chars ... last 5 chars
	let shortDid = $derived(
		identity?.id
			? `${identity.id.slice(0, 13)}...${identity.id.slice(-5)}`
			: 'did:key:-----...-----'
	);

	// Update peer count from libp2p events
	$effect(() => {
		if (!libp2p) {
			peerCount = 0;
			return;
		}

		// Update peer count initially
		const updatePeerCount = () => {
			if (libp2p) {
				peerCount = libp2p.getPeers().length;
			}
		};

		updatePeerCount();

		// Listen to peer connection events
		const onPeerConnect = () => updatePeerCount();
		const onPeerDisconnect = () => updatePeerCount();

		libp2p.addEventListener('peer:connect', onPeerConnect);
		libp2p.addEventListener('peer:disconnect', onPeerDisconnect);

		// Cleanup
		return () => {
			if (libp2p) {
				libp2p.removeEventListener('peer:connect', onPeerConnect);
				libp2p.removeEventListener('peer:disconnect', onPeerDisconnect);
			}
		};
	});

	// Update peers list when hovering
	function updatePeers() {
		if (!libp2p) {
			peers = [];
			return;
		}

		const peerIds = libp2p.getPeers();
		peers = peerIds.map((peerId) => {
			const peerIdStr = peerId.toString();
			const connections = libp2p.getConnections(peerId);

			// Extract all multiaddrs from all connections to this peer
			const addrs = [];
			connections.forEach((conn) => {
				if (conn.remoteAddr) {
					addrs.push(conn.remoteAddr.toString());
				}
			});

			// Remove duplicates
			const uniqueAddrs = [...new Set(addrs)];
			peerMultiaddrs.set(peerIdStr, uniqueAddrs);

			return {
				id: peerIdStr,
				shortId: peerIdStr.slice(-6),
				multiaddrs: uniqueAddrs
			};
		});
	}

	function handleMouseEnter() {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		showPeerList = true;
		updatePeers();
	}

	function handleMouseLeave() {
		// Delay hiding to allow moving to the modal
		hideTimeout = setTimeout(() => {
			showPeerList = false;
			hoveredPeerId = null;
		}, 100);
	}

	async function copyToClipboard(text) {
		try {
			await navigator.clipboard.writeText(text);
			console.log('✅ Copied to clipboard:', text);
		} catch (error) {
			console.error('❌ Failed to copy:', error);
		}
	}

	function isWebRTCAddr(addr) {
		return addr.includes('/webrtc/p2p') || addr.includes('/webrtc-direct');
	}

	function hasWebRTCConnection(peer) {
		return peer.multiaddrs.some((addr) => isWebRTCAddr(addr));
	}
</script>

<footer
	class="fixed right-0 bottom-0 left-0 z-40 border-t border-gray-200 bg-white px-4 py-2 shadow-lg"
>
	<div class="container mx-auto flex max-w-4xl items-center justify-between text-xs">
		<!-- Left: PeerID -->
		<div class="flex items-center gap-3">
			<span class="text-gray-500">PeerID:</span>
			<code class="rounded bg-blue-50 px-2 py-1 font-mono text-blue-600">{shortPeerId}</code>
		</div>

		<!-- Center: DID Identity -->
		<div class="flex items-center gap-3">
			<span class="text-gray-500">DID:</span>
			<code class="rounded bg-purple-50 px-2 py-1 font-mono text-purple-600">{shortDid}</code>
		</div>

		<!-- Right: Connected Peers -->
		<div class="relative flex items-center gap-2">
			<span class="text-gray-500">Peers:</span>
			<span
				class="cursor-help font-semibold text-green-600 hover:text-green-700"
				role="button"
				tabindex="0"
				onmouseenter={handleMouseEnter}
				onmouseleave={handleMouseLeave}
			>
				({peerCount})
			</span>

			{#if showPeerList && peerCount > 0}
				<div
					class="animate-in absolute right-0 bottom-full z-50 mb-2 min-w-[200px] rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
					style="animation: slideUp 0.15s ease-out;"
					role="tooltip"
					onmouseenter={handleMouseEnter}
					onmouseleave={handleMouseLeave}
				>
					<div class="mb-2 text-xs font-semibold text-gray-700">
						Connected Peers ({peerCount})
					</div>
					<div class="space-y-1">
						{#each peers as peer (peer.id)}
							<div class="relative">
								<div
									class="cursor-default rounded px-2 py-1 font-mono text-xs hover:bg-blue-50"
									class:bg-blue-100={hoveredPeerId === peer.id}
									role="button"
									tabindex="0"
									onmouseenter={() => {
										hoveredPeerId = peer.id;
										if (hideTimeout) clearTimeout(hideTimeout);
									}}
									style="color: {hasWebRTCConnection(peer) ? '#22c55e' : '#374151'};"
								>
									...{peer.shortId}
									{#if hasWebRTCConnection(peer)}
										<span class="ml-1 text-[8px] font-bold text-green-500" title="WebRTC connection"
											>webrtc</span
										>
									{/if}
								</div>

								{#if hoveredPeerId === peer.id && peer.multiaddrs.length > 0}
									<div
										class="absolute bottom-0 left-full z-[60] ml-2 max-w-[500px] min-w-[300px] rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
										style="animation: slideRight 0.15s ease-out;"
										role="tooltip"
										onmouseenter={handleMouseEnter}
										onmouseleave={handleMouseLeave}
									>
										<div class="mb-2 text-xs font-semibold text-gray-700">Multiaddresses</div>
										<div class="space-y-1">
											{#each peer.multiaddrs as addr (addr)}
												<button
													type="button"
													onclick={() => copyToClipboard(addr)}
													class="w-full cursor-pointer rounded bg-gray-50 px-2 py-1 text-left font-mono text-[10px] break-all transition-colors hover:bg-blue-50"
													style="color: {isWebRTCAddr(addr) ? '#22c55e' : '#6b7280'};"
													title="Click to copy"
												>
													{addr}
												</button>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
</footer>

<style>
	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes slideRight {
		from {
			opacity: 0;
			transform: translateX(-10px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
</style>
