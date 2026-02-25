import { get } from 'svelte/store';
import {
	addTodo,
	deleteTodo,
	toggleTodoComplete,
	loadTodos,
	revokeTodoDelegation,
	getCurrentAccessControllerType
} from '$lib/db-actions.js';
import {
	createSubList,
	currentTodoListNameStore,
	currentDbAddressStore,
	listAvailableTodoLists,
	availableTodoListsStore,
	buildHierarchyPath,
	todoListHierarchyStore
} from '$lib/todo-list-manager.js';
import { toastStore } from '$lib/toast-store.js';

/**
 * Create todo event handlers with encapsulated logic
 * @param {Object} options - Handler options
 * @param {Object} options.preferences - Network preferences
 * @param {boolean} options.enableEncryption - Whether encryption is enabled (for new sub-lists)
 * @param {string} options.encryptionPassword - Encryption password (for new sub-lists)
 * @returns {Object} Event handlers
 */
export function createTodoHandlers(options = {}) {
	const { preferences = {}, enableEncryption = false, encryptionPassword = '' } = options;

	return {
		/**
		 * Handle adding a new todo
		 * @param {CustomEvent} event - Event with detail containing todo data
		 * @returns {Promise<boolean>} Success status
		 */
		async handleAddTodo(event) {
			const {
				text,
				description,
				priority,
				estimatedTime,
				estimatedCosts,
				delegateDid,
				delegationExpiresAt
			} = event.detail;

			try {
				if (delegateDid) {
					const accessType = getCurrentAccessControllerType();
					if (accessType !== 'todo-delegation') {
						toastStore.show(
							'❌ Delegation requires todo-delegation access controller. This list uses legacy access control.',
							'error'
						);
						return false;
					}
				}

				const success = await addTodo(
					text,
					null, // assignee
					description,
					priority,
					estimatedTime,
					estimatedCosts,
					{
						delegateDid,
						expiresAt: delegationExpiresAt
					}
				);

				if (success) {
					toastStore.show('✅ Todo added successfully!', 'success');
					return true;
				} else {
					toastStore.show('❌ Failed to add todo', 'error');
					return false;
				}
			} catch (err) {
				console.error('Error adding todo:', err);
				toastStore.show(`❌ Failed to add todo: ${err.message}`, 'error');
				return false;
			}
		},

		/**
		 * Handle deleting a todo
		 * @param {CustomEvent} event - Event with detail containing key
		 * @returns {Promise<boolean>} Success status
		 */
		async handleDelete(event) {
			try {
				const success = await deleteTodo(event.detail.key);

				if (success) {
					toastStore.show('🗑️ Todo deleted successfully!', 'success');
					return true;
				} else {
					toastStore.show('❌ Failed to delete todo', 'error');
					return false;
				}
			} catch (err) {
				console.error('Error deleting todo:', err);
				toastStore.show(`❌ Failed to delete todo: ${err.message}`, 'error');
				return false;
			}
		},

		/**
		 * Handle toggling todo completion status
		 * @param {CustomEvent} event - Event with detail containing key
		 * @returns {Promise<boolean>} Success status
		 */
		async handleToggleComplete(event) {
			try {
				const success = await toggleTodoComplete(event.detail.key);

				if (success) {
					toastStore.show('✅ Todo status updated!', 'success');
					return true;
				} else {
					toastStore.show('❌ Failed to update todo', 'error');
					return false;
				}
			} catch (err) {
				console.error('Error toggling todo:', err);
				toastStore.show(`❌ Failed to update todo: ${err.message}`, 'error');
				return false;
			}
		},

		async handleRevokeDelegation(event) {
			try {
				const success = await revokeTodoDelegation(event.detail.key);

				if (success) {
					toastStore.show('✅ Delegation revoked', 'success');
					return true;
				}

				toastStore.show('❌ Failed to revoke delegation', 'error');
				return false;
			} catch (err) {
				console.error('Error revoking delegation:', err);
				toastStore.show(`❌ Failed to revoke delegation: ${err.message}`, 'error');
				return false;
			}
		},

		/**
		 * Handle creating a sub-list
		 * @param {CustomEvent} event - Event with detail containing text
		 * @param {Object} additionalOptions - Additional options for sub-list creation
		 * @param {boolean} additionalOptions.isEmbedMode - Whether in embed mode
		 * @param {boolean} additionalOptions.embedAllowAdd - Whether embed mode allows adding
		 * @returns {Promise<boolean>} Success status
		 */
		async handleCreateSubList(event, additionalOptions = {}) {
			const { text } = event.detail;
			const currentList = get(currentTodoListNameStore);

			// Merge options
			const finalOptions = {
				preferences,
				enableEncryption,
				encryptionPassword,
				isEmbedMode: false,
				embedAllowAdd: false,
				...additionalOptions
			};

			try {
				const success = await createSubList(
					text,
					currentList,
					finalOptions.preferences,
					finalOptions.enableEncryption,
					finalOptions.encryptionPassword
				);

				if (success) {
					// Wait for stores to update
					await new Promise((resolve) => setTimeout(resolve, 100));

					// Handle embed mode navigation
					if (finalOptions.isEmbedMode && typeof window !== 'undefined') {
						const newListAddress = get(currentDbAddressStore);
						if (newListAddress) {
							// Reload todos from the new database
							await loadTodos();

							// Update hierarchy
							try {
								await listAvailableTodoLists();
								const availableLists = get(availableTodoListsStore);
								const list = availableLists.find((l) => l.address === newListAddress);
								if (list) {
									const hierarchy = await buildHierarchyPath(list.displayName);
									todoListHierarchyStore.set(hierarchy);
								} else {
									const newListName = get(currentTodoListNameStore);
									if (newListName) {
										todoListHierarchyStore.set([{ name: newListName, parent: null }]);
									}
								}
							} catch (hierarchyError) {
								console.warn('Could not update hierarchy:', hierarchyError);
							}

							// Navigate using hash (not goto) - this will trigger the hash handler
							// Don't encode the address - OrbitDB addresses are URL-safe and the hash handler expects them unencoded
							const normalizedAddress = newListAddress.startsWith('/')
								? newListAddress
								: `/${newListAddress}`;
							const newHash = finalOptions.embedAllowAdd
								? `#/embed${normalizedAddress}?allowAdd=true`
								: `#/embed${normalizedAddress}`;

							window.location.hash = newHash;
						}
					}

					toastStore.show('✅ Sub-list created!', 'success');
					return true;
				} else {
					toastStore.show('❌ Failed to create sub-list', 'error');
					return false;
				}
			} catch (err) {
				console.error('Failed to create sub-list:', err);
				toastStore.show(`❌ Failed to create sub-list: ${err.message}`, 'error');
				return false;
			}
		}
	};
}
