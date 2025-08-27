<script>
	import { createEventDispatcher, onMount } from 'svelte';
	import { getKnownDatabases, addKnownDatabase, removeKnownDatabase } from './db-utils.js';
	
	export let currentDbAddress = '';
	export let isLoading = false;
	export let isSyncing = false;
	export let disabled = false;

	const dispatch = createEventDispatcher();
	
	let knownDatabases = [];
	let inputValue = currentDbAddress || '';
	let isDropdownOpen = false;
	let showSyncIndicator = false;

	onMount(() => {
		knownDatabases = getKnownDatabases();
		// Set default database name if none exists
		if (knownDatabases.length === 0) {
			knownDatabases = [{ name: 'simple-todos', address: 'simple-todos' }];
			addKnownDatabase('simple-todos', 'simple-todos');
		}
		if (!inputValue && knownDatabases.length > 0) {
			inputValue = knownDatabases[0].address;
		}
	});

	// Handle sync indicator animation
	$: {
		if (isSyncing) {
			showSyncIndicator = true;
			// Keep indicator visible for a short time even after syncing stops
			setTimeout(() => {
				if (!isSyncing) {
					showSyncIndicator = false;
				}
			}, 2000);
		} else {
			setTimeout(() => {
				showSyncIndicator = false;
			}, 1000);
		}
	}

	function handleLoadDatabase() {
		if (!inputValue.trim()) return;
		
		const dbAddress = inputValue.trim();
		
		// Add to known databases if it's not already there
		const existing = knownDatabases.find(db => db.address === dbAddress);
		if (!existing) {
			// Try to extract a name from the address or use the address itself
			const name = dbAddress.includes('/') ? dbAddress.split('/').pop() : dbAddress;
			addKnownDatabase(name, dbAddress);
			knownDatabases = getKnownDatabases();
		}
		
		dispatch('loadDatabase', { address: dbAddress });
		isDropdownOpen = false;
	}

	function handleKeydown(event) {
		if (event.key === 'Enter') {
			handleLoadDatabase();
		} else if (event.key === 'ArrowDown' && knownDatabases.length > 0) {
			event.preventDefault();
			isDropdownOpen = true;
		}
	}

	function selectDatabase(db) {
		inputValue = db.address;
		handleLoadDatabase();
	}

	function removeDatabase(event, db) {
		event.stopPropagation();
		removeKnownDatabase(db.address);
		knownDatabases = getKnownDatabases();
		if (inputValue === db.address) {
			inputValue = knownDatabases.length > 0 ? knownDatabases[0].address : '';
		}
	}

	function handleInputFocus() {
		if (knownDatabases.length > 0) {
			isDropdownOpen = true;
		}
	}

	function handleClickOutside(event) {
		if (!event.target.closest('.db-selector')) {
			isDropdownOpen = false;
		}
	}
</script>

<svelte:window on:click={handleClickOutside} />

<div class="db-selector mb-6 rounded-lg bg-white p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold flex items-center gap-2">
		Database Selection
		{#if showSyncIndicator || isSyncing}
			<div class="sync-indicator" class:animate-pulse={isSyncing}>
				<svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
					<path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
				</svg>
			</div>
		{/if}
	</h2>
	
	<div class="relative">
		<div class="flex gap-2">
			<div class="relative flex-1">
				<input
					type="text"
					bind:value={inputValue}
					placeholder="Enter database name or OrbitDB address"
					{disabled}
					class="w-full rounded-md border border-gray-300 px-4 py-2 pr-8 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
					on:keydown={handleKeydown}
					on:focus={handleInputFocus}
				/>
				
				<!-- Dropdown button -->
				{#if knownDatabases.length > 0}
					<button
						type="button"
						on:click={() => isDropdownOpen = !isDropdownOpen}
						class="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
						{disabled}
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
						</svg>
					</button>
				{/if}
				
				<!-- Dropdown menu -->
				{#if isDropdownOpen && knownDatabases.length > 0}
					<div class="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
						{#each knownDatabases as db, index}
							<div
								class="flex items-center justify-between px-4 py-2 hover:bg-gray-100 cursor-pointer group"
								on:click={() => selectDatabase(db)}
								role="option"
								tabindex="-1"
							>
								<div class="flex-1">
									<div class="font-medium text-sm">{db.name}</div>
									<div class="text-xs text-gray-500 truncate">{db.address}</div>
								</div>
								<button
									type="button"
									on:click={(e) => removeDatabase(e, db)}
									class="ml-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
									title="Remove database"
								>
									<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
										<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
									</svg>
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
			
			<button
				type="button"
				on:click={handleLoadDatabase}
				{disabled}
				class="flex items-center gap-2 rounded-md bg-green-500 px-4 py-2 font-medium text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-400"
			>
				{#if isLoading}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
					</svg>
				{:else}
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
					</svg>
				{/if}
				Load
			</button>
		</div>
		
		{#if currentDbAddress}
			<div class="mt-2 text-sm text-gray-600">
				Current: <span class="font-mono">{currentDbAddress}</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.sync-indicator {
		display: inline-flex;
		align-items: center;
	}
	
	.animate-pulse {
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
	
	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
</style>
