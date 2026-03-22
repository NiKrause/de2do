<script>
	import '../app.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { getEscrowAddress, getRpcUrl } from '$lib/chain/config.js';
	// import favicon from '$lib/assets/favicon.svg';

	// Register service worker for PWA offline support
	import { registerSW } from 'virtual:pwa-register';

	const shouldRegisterServiceWorker =
		'serviceWorker' in navigator &&
		(!import.meta.env.DEV || import.meta.env.VITE_PWA_DEV_ENABLED === 'true');

	// Auto-update service worker when new version is available
	if (shouldRegisterServiceWorker) {
		registerSW({
			immediate: true,
			onNeedRefresh() {
				// New version available, will auto-update
				console.log('New app version available, updating...');
			},
			onOfflineReady() {
				console.log('App ready to work offline');
			}
		});
	}

	let { children } = $props();

	// Passkey E2E: Node-side `eth_*` must use the same addresses as this bundle (not only `.env.test` on disk).
	onMount(() => {
		if (!browser || import.meta.env.MODE !== 'test') return;
		window.__PASSKEY_E2E_CHAIN__ = {
			escrowAddress: getEscrowAddress(),
			rpcUrl: getRpcUrl(),
			chainId: import.meta.env.VITE_CHAIN_ID != null ? String(import.meta.env.VITE_CHAIN_ID) : null
		};
	});
</script>

<svelte:head>
	<!-- Dynamic title with build info -->
	<title
		>Simple TODO List {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'} [{typeof __BUILD_DATE__ !==
		'undefined'
			? __BUILD_DATE__
			: 'dev'}]</title
	>
</svelte:head>

{@render children?.()}
