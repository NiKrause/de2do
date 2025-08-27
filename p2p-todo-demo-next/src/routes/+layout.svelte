<script>
	/* eslint-disable no-undef */
	import '../app.css';
	// import favicon from '$lib/assets/favicon.svg';

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
