<script>
	import { todoListHierarchyStore, navigateUp, switchToTodoList } from './todo-list-manager.js';
	import { get } from 'svelte/store';
	import { ChevronRight, ArrowUp } from 'lucide-svelte';

	export let preferences = {};
	export let enableEncryption = false;
	export let encryptionPassword = '';

	async function handleBreadcrumbClick(index) {
		const hierarchy = get(todoListHierarchyStore);
		if (index >= hierarchy.length) return;

		// Navigate to the clicked level
		const targetLevel = hierarchy[index];
		const newHierarchy = hierarchy.slice(0, index + 1);
		todoListHierarchyStore.set(newHierarchy);

		await switchToTodoList(
			targetLevel.name,
			preferences,
			enableEncryption,
			encryptionPassword,
			targetLevel.parent
		);
	}

	async function handleNavigateUp() {
		await navigateUp(preferences, enableEncryption, encryptionPassword);
	}
</script>

{#if $todoListHierarchyStore.length > 0}
	<div class="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2">
		<div class="flex items-center gap-1 text-sm text-gray-600">
			{#each $todoListHierarchyStore as item, index (item.name + index)}
				<button
					type="button"
					on:click={() => handleBreadcrumbClick(index)}
					class="rounded px-1 transition-colors hover:text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none {index ===
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
				class="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none"
				title="Navigate to parent list"
			>
				<ArrowUp class="h-3 w-3" />
				Up
			</button>
		{/if}
	</div>
{/if}
