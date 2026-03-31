<script>
	import {
		peerIdStore,
		currentIdentityStore,
		delegatedWriteAuthStore,
		identityModeStore,
		p2passAuthSnapshotStore
	} from '$lib/stores.js';
	import { libp2pStore } from '$lib/p2p.js';
	import { showToast } from '$lib/toast-store.js';

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
	let identityMode = $derived($identityModeStore);
	let p2passSnap = $derived($p2passAuthSnapshotStore);

	let orbitDbPasskeyBacked = $derived(
		identityMode.mode === 'worker' || identityMode.mode === 'hardware'
	);

	// Passkey mode is on but OrbitDB has not finished re-keying — id may still be legacy hex (not did:key).
	let legacyOrbitIdentityWhilePasskey = $derived(
		orbitDbPasskeyBacked &&
			typeof identity?.id === 'string' &&
			identity.id.length > 0 &&
			!identity.id.startsWith('did:key:')
	);

	// When OrbitDB uses a passkey identity, show it; otherwise show P2Pass DID if signed in there.
	let displayDid = $derived(
		orbitDbPasskeyBacked && identity?.id ? identity.id : p2passSnap?.did ?? identity?.id
	);

	// Format PeerID - last 5 chars
	let shortPeerId = $derived(peerId ? `...${peerId.slice(-5)}` : '-----');

	// Format DID - first 13 chars ... last 5 (did:key and hex ids vary in length)
	let shortDid = $derived(
		displayDid
			? displayDid.length > 18
				? `${displayDid.slice(0, 13)}...${displayDid.slice(-5)}`
				: displayDid
			: 'did:key:-----...-----'
	);

	let delegatedAuth = $derived($delegatedWriteAuthStore);
	let delegatedAuthLabel = $derived(
		delegatedAuth.state === 'awaiting'
			? 'Passkey'
			: delegatedAuth.state === 'success'
				? 'Signed'
				: delegatedAuth.state === 'error'
					? 'Auth failed'
					: 'Idle'
	);
	let identityModeLabel = $derived(
		orbitDbPasskeyBacked
			? identityMode.mode === 'hardware'
				? `hardware (${identityMode.algorithm || 'unknown'})`
				: 'worker (ed25519)'
			: p2passSnap?.did
				? p2passSnap.mode === 'hardware'
					? `hardware (${p2passSnap.algorithm || 'unknown'})`
					: 'worker (ed25519)'
				: identityMode.mode === 'hardware'
					? `hardware (${identityMode.algorithm || 'unknown'})`
					: identityMode.mode === 'worker'
						? 'worker (ed25519)'
						: identityMode.mode === 'software'
							? 'software'
							: 'unknown'
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

	async function copyToClipboard(text, label = 'Value') {
		if (!text) {
			showToast(`⚠️ ${label} is not available`, 'warning', 2000);
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			showToast(`✅ ${label} copied to clipboard`, 'success', 2000);
		} catch (error) {
			console.error('❌ Failed to copy:', error);
			showToast(`❌ Failed to copy ${label}`, 'error', 2500);
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
	class="fixed right-0 bottom-0 left-0 z-40 border-t border-gray-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur sm:px-4"
>
	<div
		class="container mx-auto flex max-w-4xl flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between"
	>
		<!-- Left: PeerID -->
		<div class="flex min-w-0 items-center gap-2 sm:gap-3">
			<span class="text-gray-500">PeerID:</span>
			<button
				type="button"
				class="min-w-0 truncate rounded bg-blue-50 px-2 py-1 font-mono text-blue-600 hover:bg-blue-100"
				title="Click to copy full PeerID"
				onclick={() => copyToClipboard(peerId, 'PeerID')}
			>
				{shortPeerId}
			</button>
		</div>

		<!-- Center: DID Identity -->
		<div class="flex min-w-0 flex-wrap items-center gap-2">
			<span class="text-gray-500">DID:</span>
			<button
				type="button"
				class="min-w-0 truncate rounded px-2 py-1 font-mono hover:opacity-90 {legacyOrbitIdentityWhilePasskey
					? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
					: 'bg-purple-50 text-purple-600 hover:bg-purple-100'}"
				title={legacyOrbitIdentityWhilePasskey
					? 'OrbitDB identity still migrating to did:key — wait before delegating'
					: 'Click to copy full DID'}
				onclick={() => copyToClipboard(displayDid, 'DID')}
			>
				{shortDid}
			</button>
			<span class="text-gray-500">Mode:</span>
			<code
				data-testid="identity-mode"
				class="rounded bg-indigo-50 px-2 py-1 font-mono text-indigo-600"
			>
				{identityModeLabel}
			</code>
		</div>

		<!-- Right: delegated auth + connected peers (P2Pass: use floating FAB) -->
		<div class="relative flex flex-wrap items-center gap-3 sm:gap-4">
			<div class="flex items-center gap-2">
				<span class="text-gray-500">Delegated Auth:</span>
				<span
					data-testid="delegated-auth-state"
					data-state={delegatedAuth.state}
					class="font-semibold {delegatedAuth.state === 'awaiting'
						? 'text-amber-600'
						: delegatedAuth.state === 'success'
							? 'text-green-600'
							: delegatedAuth.state === 'error'
								? 'text-red-600'
								: 'text-gray-500'}"
					title={delegatedAuth.message || 'Delegated write auth status'}
				>
					{delegatedAuthLabel}
				</span>
			</div>
			<span class="text-gray-500">Peers:</span>
			<span
				class="cursor-help font-semibold text-green-600 hover:text-green-700"
				data-testid="peer-count"
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

	{#if legacyOrbitIdentityWhilePasskey}
		<div
			class="container mx-auto max-w-4xl border-t border-amber-200 bg-amber-50/95 px-3 py-1.5 text-[11px] leading-snug text-amber-950 sm:px-4"
			role="status"
			data-testid="orbit-identity-did-pending"
		>
			<span class="font-medium">Passkey is active, but OrbitDB still shows a legacy id (not did:key yet).</span>
			<span class="text-amber-900/90">
				Wait for this banner to disappear before delegating todos or relying on the DID above.</span>
		</div>
	{/if}
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
