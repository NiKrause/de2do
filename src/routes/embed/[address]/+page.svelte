<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { initializeP2P, openDatabaseByAddress } from '$lib/p2p.js';
	import { initializationStore } from '$lib/p2p.js';
	import {
		todosStore,
		loadTodos,
		addTodo,
		deleteTodo,
		toggleTodoComplete
	} from '$lib/db-actions.js';
	import TodoList from '$lib/components/todo/TodoList.svelte';
	import AddTodoForm from '$lib/components/todo/AddTodoForm.svelte';
	import BreadcrumbNavigation from '$lib/components/todo/BreadcrumbNavigation.svelte';
	import LoadingSpinner from '$lib/components/ui/LoadingSpinner.svelte';
	import ErrorAlert from '$lib/components/ui/ErrorAlert.svelte';
	import { toastStore } from '$lib/toast-store.js';
	import {
		createSubList,
		currentTodoListNameStore,
		currentDbAddressStore,
		listAvailableTodoLists,
		availableTodoListsStore,
		buildHierarchyPath,
		todoListHierarchyStore
	} from '$lib/todo-list-manager.js';
	import { get } from 'svelte/store';

	let error = null;
	let loading = true;
	let dbAddress = null;
	let allowAdd = false;
	// Use memory-only storage for embeds (no local persistence needed)
	const preferences = {
		enablePersistentStorage: false,
		enableNetworkConnection: true,
		enablePeerConnections: true
	};
	const enableEncryption = false;
	const encryptionPassword = '';

	const handleAddTodo = async (event) => {
		const { text, description, priority, estimatedTime, estimatedCosts } = event.detail;
		const success = await addTodo(text, null, description, priority, estimatedTime, estimatedCosts);
		if (success) {
			toastStore.show('✅ Todo added successfully!', 'success');
		} else {
			toastStore.show('❌ Failed to add todo', 'error');
		}
	};

	const handleDelete = async (event) => {
		const success = await deleteTodo(event.detail.key);
		if (success) {
			toastStore.show('🗑️ Todo deleted successfully!', 'success');
		} else {
			toastStore.show('❌ Failed to delete todo', 'error');
		}
	};

	const handleToggleComplete = async (event) => {
		const success = await toggleTodoComplete(event.detail.key);
		if (success) {
			toastStore.show('✅ Todo status updated!', 'success');
		} else {
			toastStore.show('❌ Failed to update todo', 'error');
		}
	};

	const handleCreateSubList = async (event) => {
		const { text } = event.detail;
		const currentList = get(currentTodoListNameStore);

		try {
			const success = await createSubList(
				text,
				currentList,
				preferences,
				enableEncryption,
				encryptionPassword
			);
			if (success) {
				// switchToTodoList already:
				// - Opens/creates the database with correct identity
				// - Sets currentDbAddressStore with the correct deterministic address
				// - Updates stores
				// - Adds to registry
				// - Refreshes available lists
				// So we just need to wait a moment for stores to update, then use the address
				await new Promise((resolve) => setTimeout(resolve, 100));

				const newListAddress = get(currentDbAddressStore);
				const newListName = get(currentTodoListNameStore);

				if (newListAddress && typeof window !== 'undefined') {
					// Reload todos from the new database (already opened by createSubList/switchToTodoList)
					await loadTodos();

					// Update hierarchy
					try {
						await listAvailableTodoLists();
						const availableLists = get(availableTodoListsStore);
						const list = availableLists.find((l) => l.address === newListAddress);
						if (list) {
							const hierarchy = await buildHierarchyPath(list.displayName);
							todoListHierarchyStore.set(hierarchy);
						} else if (newListName) {
							// Fallback if not in registry yet
							todoListHierarchyStore.set([{ name: newListName, parent: null }]);
						}
					} catch (hierarchyError) {
						console.warn('Could not update hierarchy:', hierarchyError);
						// Fallback hierarchy
						if (newListName) {
							todoListHierarchyStore.set([{ name: newListName, parent: null }]);
						}
					}

					// Navigate using hash (not goto) - this will trigger the hash handler in main page
					// Don't encode the address - OrbitDB addresses are URL-safe and the hash handler expects them unencoded
					const normalizedAddress = newListAddress.startsWith('/')
						? newListAddress
						: `/${newListAddress}`;
					const newHash = allowAdd
						? `#/embed${normalizedAddress}?allowAdd=true`
						: `#/embed${normalizedAddress}`;

					window.location.hash = newHash;

					// Update local dbAddress to match
					dbAddress = newListAddress;

					toastStore.show('✅ Sub-list created!', 'success');
				} else {
					toastStore.show('✅ Sub-list created!', 'success');
				}
			} else {
				toastStore.show('❌ Failed to create sub-list', 'error');
			}
		} catch (err) {
			console.error('Failed to create sub-list:', err);
			toastStore.show('❌ Failed to create sub-list', 'error');
		}
	};

	onMount(async () => {
		try {
			// Check query parameter for allowAdd
			if (typeof window !== 'undefined') {
				const urlParams = new URLSearchParams(window.location.search);
				allowAdd = urlParams.get('allowAdd') === 'true';
			}

			const addressParam = $page.params.address;
			if (!addressParam) {
				error = 'No database address provided';
				loading = false;
				return;
			}
			dbAddress = decodeURIComponent(addressParam);

			if (!$initializationStore.isInitialized) {
				await initializeP2P({
					enablePersistentStorage: false, // Memory-only for embeds
					enableNetworkConnection: true,
					enablePeerConnections: true
				});
			}

			let attempts = 0;
			while (!$initializationStore.isInitialized && attempts < 50) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				attempts++;
			}

			if (!$initializationStore.isInitialized) {
				throw new Error('Failed to initialize P2P');
			}

			await openDatabaseByAddress(
				dbAddress,
				{
					enablePersistentStorage: false, // Memory-only for embeds
					enableNetworkConnection: true,
					enablePeerConnections: true
				},
				false,
				''
			);

			await loadTodos();

			// Load hierarchy for breadcrumb navigation
			try {
				await listAvailableTodoLists();
				const availableLists = get(availableTodoListsStore);
				const currentAddress = get(currentDbAddressStore);
				const list = availableLists.find(
					(l) => l.address === currentAddress || l.address === dbAddress
				);
				if (list) {
					const hierarchy = await buildHierarchyPath(list.displayName);
					todoListHierarchyStore.set(hierarchy);
				} else {
					// If not found in registry, set as root
					const currentListName = get(currentTodoListNameStore);
					if (currentListName) {
						todoListHierarchyStore.set([{ name: currentListName, parent: null }]);
					}
				}
			} catch (hierarchyError) {
				console.warn('Could not load hierarchy:', hierarchyError);
				// Set a default hierarchy if available
				const currentListName = get(currentTodoListNameStore);
				if (currentListName) {
					todoListHierarchyStore.set([{ name: currentListName, parent: null }]);
				}
			}

			loading = false;
		} catch (err) {
			console.error('❌ Error loading embed:', err);
			error = err instanceof Error ? err.message : 'Failed to load todo list';
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Todo List Embed</title>
	<style>
		:global(body) {
			margin: 0;
			padding: 0;
		}
	</style>
</svelte:head>

<div class="min-h-screen bg-gray-50 p-4">
	{#if loading}
		<div class="flex min-h-[400px] items-center justify-center">
			<LoadingSpinner message="Loading todo list..." />
		</div>
	{:else if error}
		<div class="flex min-h-[400px] items-center justify-center">
			<ErrorAlert {error} dismissible={false} />
		</div>
	{:else}
		<div class="mx-auto max-w-2xl">
			<!-- Breadcrumb Navigation -->
			<BreadcrumbNavigation {preferences} {enableEncryption} {encryptionPassword} />

			{#if allowAdd}
				<AddTodoForm on:add={handleAddTodo} />
			{/if}
			<TodoList
				todos={$todosStore}
				showTitle={false}
				allowEdit={allowAdd}
				on:delete={handleDelete}
				on:toggleComplete={handleToggleComplete}
				on:createSubList={handleCreateSubList}
			/>
		</div>
	{/if}
</div>
