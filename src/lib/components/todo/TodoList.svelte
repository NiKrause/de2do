<script>
	import { createEventDispatcher } from 'svelte';
	import TodoItem from './TodoItem.svelte';

	export let todos = [];
	export let title = 'TODO Items';
	export let emptyMessage = 'No TODOs yet. Add one above!';
	export let showTitle = true;
	export let allowEdit = true;

	const dispatch = createEventDispatcher();

	function handleDelete(event) {
		dispatch('delete', event.detail);
	}

	function handleToggleComplete(event) {
		dispatch('toggleComplete', event.detail);
	}

	function handleCreateSubList(event) {
		dispatch('createSubList', event.detail);
	}
</script>

<div class="mb-6 rounded-lg bg-white p-6 shadow-md">
	{#if showTitle}
		<h2 class="mb-4 text-xl font-semibold">{title} ({todos.length})</h2>
	{/if}
	{#if todos.length > 0}
		<div class="space-y-3">
			{#each todos as { id, text, description, priority, completed, assignee, createdBy, key, estimatedTime, estimatedCosts } (id)}
				<TodoItem
					{id}
					{text}
					description={description || ''}
					{priority}
					{completed}
					{assignee}
					{createdBy}
					todoKey={key}
					estimatedTime={estimatedTime || null}
					estimatedCosts={estimatedCosts || {}}
					{allowEdit}
					on:delete={handleDelete}
					on:toggleComplete={handleToggleComplete}
					on:createSubList={handleCreateSubList}
				/>
			{/each}
		</div>
	{:else}
		<p class="py-8 text-center text-gray-500">{emptyMessage}</p>
	{/if}
</div>
