<script>
	import { onMount } from 'svelte';
	import {
		currentTodoListNameStore,
		availableTodoListsStore,
		switchToTodoList,
		listAvailableTodoLists,
		removeTodoListFromRegistry,
		selectedUserIdStore
	} from '../../todo-list-manager.js';
	import { getCurrentIdentityId } from '../../stores.js';
	import { initializationStore } from '../../p2p.js';
	import { get } from 'svelte/store';
	import { currentDbNameStore } from '../../todo-list-manager.js';

	let showDropdown = false;
	let inputValue = '';
	let filteredLists = [];
	let isCreating = false;
	let isUserTyping = false; // Track if user is actively typing

	// Check if current list is encrypted
	$: currentListEncrypted =
		$availableTodoListsStore.find((list) => list.displayName === $currentTodoListNameStore)
			?.encryptionEnabled || false;

	// Check if current database belongs to another user
	$: currentDbName = $currentDbNameStore;
	$: currentUserIdentity = $initializationStore.isInitialized ? getCurrentIdentityId() : null;
	$: currentDbIdentity =
		currentDbName && currentDbName.includes('_') ? currentDbName.split('_')[0] : null;
	$: isViewingOtherUser =
		currentDbIdentity && currentUserIdentity && currentDbIdentity !== currentUserIdentity;

	// React to selectedUserIdStore changes and refresh available lists
	$: if ($selectedUserIdStore && $initializationStore.isInitialized) {
		// When a user is selected, refresh available lists to ensure we have their lists
		listAvailableTodoLists();
	}

	// Update inputValue when currentTodoListNameStore changes (but not when user is typing)
	$: if ($initializationStore.isInitialized && !isUserTyping) {
		// Always sync inputValue with currentTodoListNameStore when not typing
		if (inputValue !== $currentTodoListNameStore) {
			inputValue = $currentTodoListNameStore || '';
		}
	}

	$: {
		if ($availableTodoListsStore) {
			// First filter by selected user (if any)
			let listsToShow = $availableTodoListsStore;

			if ($selectedUserIdStore) {
				// Filter to show only lists from the selected user
				listsToShow = listsToShow.filter((list) => {
					if (!list.dbName || !list.dbName.includes('_')) return false;
					const identityId = list.dbName.split('_')[0];
					return identityId === $selectedUserIdStore;
				});
			}

			// Then filter by input value
			if (inputValue === '' || inputValue === $currentTodoListNameStore) {
				filteredLists = listsToShow;
			} else {
				filteredLists = listsToShow.filter((list) =>
					list.displayName.toLowerCase().includes(inputValue.toLowerCase())
				);
			}
		}
	}

	onMount(() => {
		// Wait for initialization, then list available todo lists
		const unsubscribe = initializationStore.subscribe((state) => {
			if (state.isInitialized) {
				listAvailableTodoLists();
			}
		});
		return unsubscribe;
	});

	async function handleSelect(list) {
		showDropdown = false;
		isUserTyping = false; // Reset typing flag when selecting
		inputValue = list.displayName; // Set immediately for visual feedback

		const preferences = {
			enablePersistentStorage: true,
			enableNetworkConnection: true,
			enablePeerConnections: true
		};

		// switchToTodoList checks registry for encryption and uses cached password if available
		// Returns false if encrypted and password not cached - password will be prompted via URL hash
		const success = await switchToTodoList(
			list.displayName,
			preferences,
			false,
			'',
			list.parent || null
		);

		if (!success && list.encryptionEnabled && list.address) {
			// Encrypted database without cached password - trigger password prompt via hash
			console.log('🔐 Encrypted list selected, triggering password prompt via hash');
			if (typeof window !== 'undefined') {
				const hash = list.address.startsWith('/') ? list.address : `/${list.address}`;
				window.location.hash = hash;
			}
		} else if (!success) {
			// Other error - revert input
			inputValue = get(currentTodoListNameStore);
		}
	}

	async function handleCreate() {
		if (!inputValue.trim()) return;

		const trimmedName = inputValue.trim();
		isCreating = true;
		showDropdown = false;

		const preferences = {
			enablePersistentStorage: true,
			enableNetworkConnection: true,
			enablePeerConnections: true
		};

		const success = await switchToTodoList(trimmedName, preferences, false, '');
		if (success) {
			inputValue = trimmedName;
		}
		isCreating = false;
	}

	async function handleInputFocus() {
		showDropdown = true;
		isUserTyping = false; // Reset typing flag on focus
		// Refresh the list when opening dropdown to ensure we have the latest data
		await listAvailableTodoLists();
		// Clear input to show all lists, user can type to filter
		inputValue = '';
	}

	function handleInputInput() {
		// Mark that user is actively typing
		isUserTyping = true;
	}

	function handleInputBlur() {
		// Reset typing flag when input loses focus
		isUserTyping = false;
		// Delay to allow click events on dropdown items
		setTimeout(() => {
			showDropdown = false;
		}, 200);
	}

	function handleKeydown(event) {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (filteredLists.length === 1) {
				handleSelect(filteredLists[0]);
			} else {
				handleCreate();
			}
		} else if (event.key === 'Escape') {
			showDropdown = false;
		}
	}

	async function handleDelete(event, list) {
		// Stop event propagation to prevent the select action
		event.stopPropagation();
		event.preventDefault();

		// Confirm deletion
		if (!confirm(`Are you sure you want to delete "${list.displayName}" from your todo lists?`)) {
			return;
		}

		try {
			const success = await removeTodoListFromRegistry(list.displayName);
			if (success) {
				// If the deleted list was the current one, switch to projects
				if (list.displayName === $currentTodoListNameStore) {
					const preferences = {
						enablePersistentStorage: true,
						enableNetworkConnection: true,
						enablePeerConnections: true
					};
					await switchToTodoList('projects', preferences, false, '');
				}
			}
		} catch (error) {
			console.error('Failed to delete todo list:', error);
		}
	}
</script>

<div class="relative w-full">
	<label for="todo-list-selector" class="mb-1 block text-sm font-medium text-gray-700">
		Todo List
		{#if currentListEncrypted}
			<span class="ml-2 text-xs" title="Current list is encrypted">🔐</span>
		{/if}
		{#if isViewingOtherUser}
			<span
				class="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
				title="Viewing another user's database"
			>
				👤 {currentDbIdentity?.slice(0, 8)}...
			</span>
		{/if}
	</label>
	<div class="relative">
		<input
			id="todo-list-selector"
			type="text"
			bind:value={inputValue}
			on:focus={handleInputFocus}
			on:blur={handleInputBlur}
			on:input={handleInputInput}
			on:keydown={handleKeydown}
			placeholder="Type to create or select a todo list..."
			class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 {isViewingOtherUser
				? 'pr-24'
				: 'pr-10'} text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none {isViewingOtherUser
				? 'border-amber-300 bg-amber-50'
				: ''}"
			disabled={isCreating || !$initializationStore.isInitialized}
		/>
		{#if isViewingOtherUser}
			<span
				class="absolute top-1/2 right-12 -translate-y-1/2 font-mono text-xs text-amber-600"
				title="Viewing another user's database"
			>
				{currentDbIdentity?.slice(0, 6)}...
			</span>
		{/if}
		<button
			type="button"
			on:click={handleCreate}
			disabled={!inputValue.trim() || isCreating || !$initializationStore.isInitialized}
			class="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
			title="Create new todo list"
		>
			{isCreating ? '...' : '+'}
		</button>
	</div>

	{#if showDropdown && $initializationStore.isInitialized}
		<div
			class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-300 bg-white shadow-lg"
			role="listbox"
		>
			{#if filteredLists.length > 0}
				{#each filteredLists as list (list.dbName)}
					{@const listIdentity =
						list.dbName && list.dbName.includes('_') ? list.dbName.split('_')[0] : null}
					{@const isOtherUser =
						listIdentity && currentUserIdentity && listIdentity !== currentUserIdentity}
					<div
						class="group relative flex w-full items-center hover:bg-blue-50 {list.displayName ===
						$currentTodoListNameStore
							? 'bg-blue-100'
							: ''}"
						role="option"
						aria-selected={list.displayName === $currentTodoListNameStore}
					>
						<button
							type="button"
							on:click={() => handleSelect(list)}
							class="flex-1 px-4 py-2 text-left text-sm focus:bg-blue-50 focus:outline-none {list.displayName ===
							$currentTodoListNameStore
								? 'font-medium'
								: ''}"
						>
							<div class="flex items-center gap-2">
								{#if list.parent}
									<span class="flex items-center pl-6 text-gray-700">
										<span class="mr-2 inline-block w-3 text-xs text-gray-400">└─</span>
										<span>{list.displayName}</span>
									</span>
								{:else}
									<span class="font-medium">{list.displayName}</span>
								{/if}
								{#if list.encryptionEnabled}
									<span class="text-xs" title="Encrypted database">🔐</span>
								{/if}
								{#if isOtherUser}
									<span
										class="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 font-mono text-xs font-medium text-amber-700"
										title="Another user's database"
									>
										{listIdentity?.slice(0, 6)}...
									</span>
								{/if}
							</div>
						</button>
						{#if !isOtherUser}
							<button
								type="button"
								on:click={(e) => handleDelete(e, list)}
								class="px-2 py-2 text-red-600 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-800 focus:outline-none"
								title="Delete this todo list"
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
						{/if}
					</div>
				{/each}
			{/if}
			{#if inputValue.trim() && !filteredLists.some((l) => l.displayName.toLowerCase() === inputValue
							.trim()
							.toLowerCase())}
				<button
					type="button"
					on:click={handleCreate}
					class="w-full border-t border-gray-200 px-4 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
					role="option"
					aria-selected="false"
				>
					+ Create "{inputValue.trim()}"
				</button>
			{/if}
		</div>
	{/if}
</div>
