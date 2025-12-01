<script>
	import { onMount } from 'svelte';
	import {
		uniqueUsersStore,
		listUniqueUsers,
		availableTodoListsStore,
		selectedUserIdStore,
		trackedUsersStore,
		addTrackedUser,
		removeTrackedUser
	} from '../todo-list-manager.js';
	import { initializationStore } from '../p2p.js';
	import { showToast } from '../toast-store.js';
	import { get } from 'svelte/store';

	let showDropdown = false;
	let inputValue = '';
	let filteredUsers = [];
	let isAdding = false;

	onMount(async () => {
		const unsubscribe = initializationStore.subscribe(async (state) => {
			if (state.isInitialized) {
				await listUniqueUsers();
			}
		});
		return unsubscribe;
	});

	// Refresh list when initialization completes or when todo lists change
	$: if ($initializationStore.isInitialized && $availableTodoListsStore.length >= 0) {
		listUniqueUsers();
	}

	// Combine unique users and tracked users, remove duplicates
	$: {
		const allUsers = new Set([...$uniqueUsersStore, ...$trackedUsersStore]);
		const allUsersArray = Array.from(allUsers).sort();

		if (inputValue === '') {
			filteredUsers = allUsersArray;
		} else {
			filteredUsers = allUsersArray.filter((userId) =>
				userId.toLowerCase().includes(inputValue.toLowerCase())
			);
		}
	}

	// Compute user count text
	$: userCountText = filteredUsers.length === 1 ? 'user' : 'users';

	async function handleAdd() {
		if (!inputValue.trim()) return;

		const trimmedId = inputValue.trim();
		isAdding = true;

		try {
			const success = await addTrackedUser(trimmedId);
			if (success) {
				showToast(`✅ Added user and discovered their projects database`, 'success', 3000);
			} else {
				showToast(`✅ Added user (could not discover projects database)`, 'info', 3000);
			}
			inputValue = '';
			showDropdown = false;
		} catch (error) {
			console.error('Failed to add user:', error);
			showToast(`Failed to add user: ${error.message}`, 'error', 3000);
		} finally {
			isAdding = false;
		}
	}

	async function handleSelect(userId) {
		showDropdown = false;
		inputValue = userId;

		// Copy to clipboard when selecting
		try {
			await navigator.clipboard.writeText(userId);
			showToast('User ID copied to clipboard', 'success', 2000);
		} catch (error) {
			console.error('Failed to copy to clipboard:', error);
			// Don't show error toast - selection should still work even if copy fails
		}

		// Get current user identity
		const { getCurrentIdentityId } = await import('../stores.js');
		const currentUserIdentity = getCurrentIdentityId();
		const currentSelected = get(selectedUserIdStore);

		// Determine target user ID (null means show all/own, otherwise the selected user)
		let targetUserId = null;
		if (currentSelected === userId) {
			// Toggling off - show all (which means own)
			selectedUserIdStore.set(null);
			targetUserId = currentUserIdentity; // Switch to own projects
		} else {
			// Selecting a user - filter to this user
			selectedUserIdStore.set(userId);
			targetUserId = userId; // Switch to their projects
		}

		// Refresh available lists first to ensure we have latest data
		const { listAvailableTodoLists } = await import('../todo-list-manager.js');
		await listAvailableTodoLists();

		// Find the "projects" database for the target user
		const availableLists = get(availableTodoListsStore);
		const targetProjects = availableLists.find((list) => {
			if (!list.dbName || !list.dbName.includes('_')) return false;
			const identityId = list.dbName.split('_')[0];
			return identityId === targetUserId && list.displayName === 'projects';
		});

		const preferences = {
			enablePersistentStorage: true,
			enableNetworkConnection: true,
			enablePeerConnections: true
		};

		// Import necessary functions
		const { openDatabaseByAddress, openDatabaseByName } = await import('../p2p.js');
		const { currentTodoListNameStore, currentDbNameStore, currentDbAddressStore } = await import(
			'../todo-list-manager.js'
		);
		const { replaceState } = await import('$app/navigation');

		if (targetProjects && targetProjects.address) {
			// Use centralized password prompt flow for consistent encryption detection
			try {
				const { openDatabaseWithPasswordPrompt } = await import('../database/database-manager.js');

				console.log('🔍 Opening target projects database:', targetProjects.address);
				const result = await openDatabaseWithPasswordPrompt({
					address: targetProjects.address,
					preferences
				});

				if (result.success) {
					// Update stores
					currentTodoListNameStore.set('projects');
					if (targetProjects.dbName) {
						currentDbNameStore.set(targetProjects.dbName);
					}
					currentDbAddressStore.set(targetProjects.address);

					// Update hash
					if (typeof window !== 'undefined') {
						const hash = targetProjects.address.startsWith('/')
							? targetProjects.address
							: `/${targetProjects.address}`;
						replaceState(`#${hash}`, { replaceState: true });
					}
				} else if (result.cancelled) {
					// User cancelled password entry
					console.log('⚠️ User cancelled database open');
				}
			} catch (e) {
				console.error('Failed to open projects database:', e);
				showToast('Failed to open projects database', 'error', 3000);
			}
		} else {
			// Try opening by name if not found in available lists
			const dbName = `${targetUserId}_projects`;
			try {
				const { openDatabaseWithPasswordPrompt } = await import('../database/database-manager.js');

				console.log('🔍 Opening target projects database by name:', dbName);
				const result = await openDatabaseWithPasswordPrompt({
					name: dbName,
					preferences
				});

				if (result.success) {
					// Update stores
					currentTodoListNameStore.set('projects');
					currentDbNameStore.set(dbName);
					if (result.database?.address) {
						currentDbAddressStore.set(result.database.address);

						// Update hash
						if (typeof window !== 'undefined') {
							const hash = result.database.address.startsWith('/')
								? result.database.address
								: `/${result.database.address}`;
							replaceState(`#${hash}`, { replaceState: true });
						}
					}
				} else if (result.cancelled) {
					console.log('⚠️ User cancelled database open');
				}
			} catch (e) {
				console.error('Failed to open projects database by name:', e);
				showToast('Failed to open projects database. It may be unavailable.', 'error', 3000);
			}
		}
	}

	async function handleDelete(event, userId) {
		event.stopPropagation();
		event.preventDefault();

		if (!confirm(`Remove "${userId.slice(0, 16)}..." from tracked users?`)) {
			return;
		}

		try {
			removeTrackedUser(userId);
			// If this was the selected user, deselect
			if (get(selectedUserIdStore) === userId) {
				selectedUserIdStore.set(null);
			}
			showToast('User removed from tracked list', 'success', 2000);
		} catch (error) {
			console.error('Failed to remove user:', error);
			showToast('Failed to remove user', 'error', 2000);
		}
	}

	function handleInputFocus() {
		showDropdown = true;
		inputValue = '';
	}

	function handleInputInput() {
		// Input handler - can be extended if needed
	}

	function handleInputBlur() {
		setTimeout(() => {
			showDropdown = false;
		}, 200);
	}

	function handleKeydown(event) {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (filteredUsers.length === 1) {
				handleSelect(filteredUsers[0]);
			} else {
				handleAdd();
			}
		} else if (event.key === 'Escape') {
			showDropdown = false;
		}
	}
</script>

<div class="w-full">
	<label for="users-list" class="mb-1 block text-sm font-medium text-gray-700"> Users </label>
	<div class="relative">
		<input
			id="users-list"
			type="text"
			bind:value={inputValue}
			on:focus={handleInputFocus}
			on:blur={handleInputBlur}
			on:input={handleInputInput}
			on:keydown={handleKeydown}
			placeholder="Type to filter, select, or add identity..."
			class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-10 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
			disabled={isAdding || !$initializationStore.isInitialized}
		/>
		<button
			type="button"
			on:click={handleAdd}
			disabled={!inputValue.trim() || isAdding || !$initializationStore.isInitialized}
			class="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
			title="Add identity"
		>
			{isAdding ? '...' : '+'}
		</button>
	</div>

	{#if showDropdown && $initializationStore.isInitialized}
		<div
			class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-300 bg-white shadow-lg"
			role="listbox"
		>
			{#if filteredUsers.length > 0}
				{#each filteredUsers as userId (userId)}
					<div
						class="group relative flex w-full items-center hover:bg-blue-50 {$selectedUserIdStore ===
						userId
							? 'bg-blue-100'
							: ''}"
						role="option"
						aria-selected={$selectedUserIdStore === userId}
					>
						<button
							type="button"
							on:click={() => handleSelect(userId)}
							class="flex-1 px-4 py-2 text-left font-mono text-xs focus:bg-blue-50 focus:outline-none {$selectedUserIdStore ===
							userId
								? 'font-medium'
								: ''}"
						>
							<div class="truncate">{userId}</div>
						</button>
						<button
							type="button"
							on:click={(e) => handleDelete(e, userId)}
							class="px-2 py-2 text-red-600 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-800 focus:outline-none"
							title="Remove this user"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M20 12H4"
								/>
							</svg>
						</button>
					</div>
				{/each}
			{/if}
			{#if inputValue.trim() && !filteredUsers.some((u) => u.toLowerCase() === inputValue
							.trim()
							.toLowerCase())}
				<button
					type="button"
					on:click={handleAdd}
					class="w-full border-t border-gray-200 px-4 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
					role="option"
					aria-selected="false"
				>
					+ Add "{inputValue.trim()}"
				</button>
			{/if}
		</div>
	{/if}

	<div class="mt-1 text-xs text-gray-500">
		{filteredUsers.length}
		{userCountText}
		{#if $selectedUserIdStore}
			<span class="ml-2 text-blue-600">• Filtered to: {$selectedUserIdStore.slice(0, 8)}...</span>
		{/if}
	</div>
</div>
