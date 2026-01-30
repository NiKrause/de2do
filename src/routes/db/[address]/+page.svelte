<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { initializeP2P, openDatabaseByAddress } from '$lib/p2p.js';
	import { initializationStore } from '$lib/p2p.js';
	import LoadingSpinner from '$lib/components/ui/LoadingSpinner.svelte';
	import ErrorAlert from '$lib/components/ui/ErrorAlert.svelte';

	let error = null;
	let loading = true;
	let dbAddress = null;

	onMount(async () => {
		try {
			// Get the database address from the route parameter
			// Decode in case it was URL-encoded
			dbAddress = decodeURIComponent($page.params.address);

			if (!dbAddress) {
				error = 'No database address provided';
				loading = false;
				return;
			}

			// Ensure P2P is initialized
			if (!$initializationStore.isInitialized) {
				console.log('🚀 Initializing P2P...');
				await initializeP2P({
					enablePersistentStorage: true,
					enableNetworkConnection: true,
					enablePeerConnections: true
				});
			}

			// Wait a bit for initialization to complete
			let attempts = 0;
			while (!$initializationStore.isInitialized && attempts < 50) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				attempts++;
			}

			if (!$initializationStore.isInitialized) {
				throw new Error('Failed to initialize P2P');
			}

			// Open the database by address
			console.log(`📂 Opening database: ${dbAddress}`);
			await openDatabaseByAddress(
				dbAddress,
				{
					enablePersistentStorage: true,
					enableNetworkConnection: true,
					enablePeerConnections: true
				},
				false,
				''
			);

			// Redirect to main page - the database is now open
			loading = false;
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			await goto('/');
		} catch (err) {
			console.error('❌ Error opening database:', err);
			error = err.message || 'Failed to open database';
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Opening Database - Simple TODO</title>
</svelte:head>

<div class="container mx-auto max-w-4xl p-6">
	{#if loading}
		<LoadingSpinner
			message="Opening database..."
			submessage="Please wait while we open the database by address"
		/>
	{:else if error}
		<ErrorAlert {error} dismissible={false} />
		<div class="mt-4">
			<button
				on:click={() => {
					// eslint-disable-next-line svelte/no-navigation-without-resolve
					goto('/');
				}}
				class="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
			>
				Go to Home
			</button>
		</div>
	{:else}
		<div class="text-center">
			<p class="text-lg">Database opened successfully! Redirecting...</p>
		</div>
	{/if}
</div>
