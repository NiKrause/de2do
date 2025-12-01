import { get } from 'svelte/store';
import { toastStore } from '$lib/toast-store.js';
import {
	currentTodoListNameStore,
	currentDbNameStore,
	currentDbAddressStore,
	switchToTodoList
} from '$lib/todo-list-manager.js';
import { enableDatabaseEncryption, disableDatabaseEncryption } from '$lib/encryption-migration.js';
import { loadTodos } from '$lib/db-actions.js';

/**
 * Factory function to create encryption event handlers
 * @param {Object} context - Context object containing preferences
 * @returns {Object} Object with handleEnableEncryption and handleDisableEncryption functions
 */
export function createEncryptionHandlers({ preferences }) {
	/**
	 * Handle enabling encryption on the current database
	 * @param {string} password - Encryption password
	 * @returns {Promise<{success: boolean, isCurrentDbEncrypted: boolean}>}
	 */
	async function handleEnableEncryption(password) {
		if (!password || !password.trim()) {
			alert('Please enter an encryption password');
			return { success: false, isCurrentDbEncrypted: false };
		}

		try {
			// Get current database info
			const currentList = get(currentTodoListNameStore);
			const currentDbName = get(currentDbNameStore);
			const currentAddress = get(currentDbAddressStore);

			// Migrate to encrypted
			const result = await enableDatabaseEncryption(
				currentList,
				currentDbName,
				currentAddress,
				password,
				preferences,
				null
			);

			if (result.success) {
				// Reopen the new encrypted database
				await switchToTodoList(currentList, preferences, true, password);

				// Load todos from the newly encrypted database
				await loadTodos();

				return { success: true, isCurrentDbEncrypted: true };
			}

			return { success: false, isCurrentDbEncrypted: false };
		} catch (error) {
			toastStore.show(`Failed to enable encryption: ${error.message}`, 'error');
			return { success: false, isCurrentDbEncrypted: false };
		}
	}

	/**
	 * Handle disabling encryption on the current database
	 * @param {string} currentPassword - Current encryption password
	 * @returns {Promise<{success: boolean, isCurrentDbEncrypted: boolean}>}
	 */
	async function handleDisableEncryption(currentPassword) {
		if (
			!confirm(
				"Disable encryption? This will create a new unencrypted database and copy all your data to it. The old encrypted database will remain but won't be used."
			)
		) {
			return { success: false, isCurrentDbEncrypted: true };
		}

		// Prompt for current password
		if (!currentPassword) {
			currentPassword = prompt('Enter current encryption password:');
			if (!currentPassword) {
				return { success: false, isCurrentDbEncrypted: true };
			}
		}

		try {
			// Get current database info
			const currentList = get(currentTodoListNameStore);
			const currentDbName = get(currentDbNameStore);
			const currentAddress = get(currentDbAddressStore);

			// Migrate to unencrypted
			const result = await disableDatabaseEncryption(
				currentList,
				currentDbName,
				currentAddress,
				currentPassword,
				preferences,
				null
			);

			if (result.success) {
				// Reopen the new unencrypted database
				await switchToTodoList(currentList, preferences, false, '');

				return { success: true, isCurrentDbEncrypted: false };
			}

			return { success: false, isCurrentDbEncrypted: true };
		} catch (error) {
			toastStore.show(`Failed to disable encryption: ${error.message}`, 'error');
			return { success: false, isCurrentDbEncrypted: true };
		}
	}

	return {
		handleEnableEncryption,
		handleDisableEncryption
	};
}
