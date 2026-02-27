<script>
	import '../app.css';
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
