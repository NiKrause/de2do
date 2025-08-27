<script>
	import { createEventDispatcher } from 'svelte';
	import { formatPeerId } from './utils.js';

	export let text;
	export let completed = false;
	export let assignee = null;
	export let createdBy;
	export let todoKey;

	const dispatch = createEventDispatcher();

	function handleToggleComplete() {
		dispatch('toggleComplete', { key: todoKey });
	}

	function handleDelete() {
		dispatch('delete', { key: todoKey });
	}
</script>

<div
	class="flex items-center justify-between rounded-md border border-gray-200 p-3 hover:bg-gray-50"
>
	<div class="flex flex-1 items-center space-x-3">
		<input
			type="checkbox"
			checked={completed}
			on:change={handleToggleComplete}
			class="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
		/>
		<div class="flex-1">
			<span class={completed ? 'text-gray-500 line-through' : 'text-gray-800'}>
				{text}
			</span>
			<div class="mt-1 text-sm text-gray-500">
				{#if assignee}
					Assigned to: <code class="rounded bg-gray-100 px-1">{formatPeerId(assignee)}</code>
				{:else}
					<span class="text-orange-600">Unassigned</span>
				{/if}
				• Created by: <code class="rounded bg-gray-100 px-1">{formatPeerId(createdBy)}</code>
			</div>
		</div>
	</div>
	<div class="flex space-x-2">
		<button
			on:click={handleDelete}
			class="rounded-md px-3 py-1 text-red-500 transition-colors hover:text-red-700"
		>
			Delete
		</button>
	</div>
</div>
