<script>
	import { browser } from '$app/environment';
	import { StorachaFab as StorachaFabComponent } from '@le-space/p2pass';
	import { p2passPanelOpenStore } from '$lib/p2pass-panel-store.js';

	/** @le-space/p2pass ships Svelte 5 components with empty `.d.ts` props; treat as untyped at compile time. */
	const StorachaFab = /** @type {any} */ (StorachaFabComponent);

	let {
		orbitdb = null,
		database = null,
		isInitialized = false,
		entryCount = 0,
		databaseName = 'projects',
		onRestore = async () => {},
		onBackup = async () => {},
		onAuthenticate = async () => {},
		libp2p = null
	} = $props();

	function closeWaiting() {
		p2passPanelOpenStore.set(false);
	}
</script>

{#if browser}
	{#if !isInitialized && $p2passPanelOpenStore}
		<button
			type="button"
			data-testid="p2pass-p2p-waiting-backdrop"
			class="fixed inset-0 z-[9998] cursor-default border-0 bg-black/20 backdrop-blur-sm"
			onclick={closeWaiting}
			aria-label="Close"
		></button>
		<div
			data-testid="p2pass-p2p-waiting"
			class="fixed right-6 bottom-52 z-[9999] w-80 max-w-[calc(100vw-3rem)] rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
		>
			<p class="text-sm text-gray-700">
				P2P initializing… Open this panel again after the network is ready.
			</p>
			<button
				type="button"
				class="mt-3 text-sm font-medium text-blue-600 hover:text-blue-800"
				onclick={closeWaiting}
			>
				Close
			</button>
		</div>
	{:else if isInitialized}
		<div data-testid="p2pass-mount">
			<StorachaFab
				panelOpenStore={p2passPanelOpenStore}
				{orbitdb}
				{database}
				isInitialized={true}
				{entryCount}
				{databaseName}
				{onRestore}
				{onBackup}
				{onAuthenticate}
				{libp2p}
			/>
		</div>
	{/if}
{/if}
