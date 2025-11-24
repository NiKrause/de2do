<script>
	import { todoListHierarchyStore, navigateUp, switchToTodoList } from '../../todo-list-manager.js';
	import { currentDbAddressStore, availableTodoListsStore } from '../../todo-list-manager.js';
	import { get } from 'svelte/store';
	import { ChevronRight, ArrowUp } from 'lucide-svelte';
	import { browser } from '$app/environment';

	export let preferences = {};
	export let enableEncryption = false;
	export let encryptionPassword = '';

	// Check if we're in embed mode by checking hash
	$: isEmbedMode = browser && typeof window !== 'undefined' && window.location.hash.startsWith('#/embed/');

	async function handleBreadcrumbClick(index) {
		const hierarchy = get(todoListHierarchyStore);
		if (index >= hierarchy.length) return;

		// Navigate to the clicked level
		const targetLevel = hierarchy[index];
		const newHierarchy = hierarchy.slice(0, index + 1);
		todoListHierarchyStore.set(newHierarchy);

		// Switch to the todo list (this updates the database and sets currentDbAddressStore)
		await switchToTodoList(
			targetLevel.name,
			preferences,
			enableEncryption,
			encryptionPassword,
			targetLevel.parent
		);

		// If in embed mode, update hash instead of using goto
		if (isEmbedMode && typeof window !== 'undefined') {
			const currentAddress = get(currentDbAddressStore);
			if (currentAddress) {
				// Get current allowAdd from hash or query params
				const currentHash = window.location.hash;
				const allowAdd = currentHash.includes('allowAdd=true');
				
				// Update hash to navigate to new embed
				// Don't encode the address - OrbitDB addresses are URL-safe and the hash handler expects them unencoded
				const normalizedAddress = currentAddress.startsWith('/') ? currentAddress : `/${currentAddress}`;
				const newHash = allowAdd 
					? `#/embed${normalizedAddress}?allowAdd=true`
					: `#/embed${normalizedAddress}`;
				
				window.location.hash = newHash;
			}
		}
	}

	async function handleNavigateUp() {
		const hierarchy = get(todoListHierarchyStore);
		if (hierarchy.length <= 1) {
			return; // Already at root
		}

		// Navigate up using navigateUp (which calls switchToTodoList)
		const success = await navigateUp(preferences, enableEncryption, encryptionPassword);

		// If in embed mode, update hash instead of using goto
		if (success && isEmbedMode && typeof window !== 'undefined') {
			const currentAddress = get(currentDbAddressStore);
			if (currentAddress) {
				// Get current allowAdd from hash
				const currentHash = window.location.hash;
				const allowAdd = currentHash.includes('allowAdd=true');
				
				// Update hash to navigate to parent embed
				// Don't encode the address - OrbitDB addresses are URL-safe and the hash handler expects them unencoded
				const normalizedAddress = currentAddress.startsWith('/') ? currentAddress : `/${currentAddress}`;
				const newHash = allowAdd 
					? `#/embed${normalizedAddress}?allowAdd=true`
					: `#/embed${normalizedAddress}`;
				
				window.location.hash = newHash;
			}
		}
	}
</script>

{#if $todoListHierarchyStore.length > 0}
	<div class="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2">
		<div class="flex items-center gap-1 text-sm text-gray-600">
			{#each $todoListHierarchyStore as item, index (item.name + index)}
				<button
					type="button"
					on:click={() => handleBreadcrumbClick(index)}
					class="rounded px-2 py-2 transition-colors hover:text-blue-600 active:bg-blue-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none touch-manipulation cursor-pointer min-h-[44px] {index ===
					$todoListHierarchyStore.length - 1
						? 'font-semibold text-gray-900'
						: 'text-gray-600'}"
					title={item.name}
				>
					{item.name}
				</button>
				{#if index < $todoListHierarchyStore.length - 1}
					<ChevronRight class="h-4 w-4 text-gray-400" />
				{/if}
			{/each}
		</div>
		{#if $todoListHierarchyStore.length > 1}
			<button
				type="button"
				on:click={handleNavigateUp}
				class="ml-auto flex items-center gap-1 rounded px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 active:bg-gray-300 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none touch-manipulation cursor-pointer min-h-[44px]"
				title="Navigate to parent list"
			>
				<ArrowUp class="h-3 w-3" />
				Up
			</button>
		{/if}
	</div>
{/if}
