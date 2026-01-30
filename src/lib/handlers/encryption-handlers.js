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
import { getWebAuthnEncryptionKey } from '$lib/encryption/webauthn-encryption.js';

function hasEncryptionSecret(secret) {
	if (!secret) return false;
	if (typeof secret === 'string') return secret.trim().length > 0;
	return Boolean(secret?.subarray && secret.length > 0);
}

function getEncryptionMethodFromSecret(secret) {
	if (!secret) return null;
	if (secret?.subarray) return 'webauthn-prf';
	if (typeof secret === 'string' && secret.trim()) return 'password';
	return null;
}

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
	async function handleEnableEncryption(password, options = {}) {
		const { preferWebAuthn = true } = options;
		let encryptionSecret = password;
		if (!hasEncryptionSecret(encryptionSecret)) {
			if (preferWebAuthn) {
				encryptionSecret = await getWebAuthnEncryptionKey({ allowCreate: true });
			}
			if (!encryptionSecret) {
				alert('Please enter an encryption password');
				return { success: false, isCurrentDbEncrypted: false };
			}
		}

		try {
			// Get current database info
			const currentList = get(currentTodoListNameStore);
			const currentDbName = get(currentDbNameStore);
			const currentAddress = get(currentDbAddressStore);

			console.log('🔐 Starting encryption migration...');
			console.log(`  → Current address: ${currentAddress}`);
			if (typeof encryptionSecret === 'string') {
				console.log(
					`  → Password length: ${encryptionSecret.length}, first 3 chars: ${encryptionSecret.substring(0, 3)}***`
				);
			} else {
				console.log(`  → Password bytes: ${encryptionSecret.length}`);
			}

			// Migrate to encrypted
			const result = await enableDatabaseEncryption(
				currentList,
				currentDbName,
				currentAddress,
				encryptionSecret,
				getEncryptionMethodFromSecret(encryptionSecret),
				preferences,
				null
			);

			if (result.success) {
				console.log('✅ Migration completed successfully, reopening database...');
				console.log(`🔑 Original address: ${currentAddress}`);
				console.log(`🔑 New address from migration: ${result.newAddress}`);
				console.log(`  → Address match: ${currentAddress === result.newAddress ? 'YES ✅' : 'NO ❌'}`);
				if (typeof encryptionSecret === 'string') {
					console.log(
						`  → About to call switchToTodoList with: list=${currentList}, encryption=true, password length=${encryptionSecret.length}`
					);
					console.log(`  → Password first 3 chars: ${encryptionSecret.substring(0, 3)}***`);
				} else {
					console.log(
						`  → About to call switchToTodoList with: list=${currentList}, encryption=true, password bytes=${encryptionSecret.length}`
					);
				}
				// Reopen the new encrypted database
				const switched = await switchToTodoList(
					currentList,
					preferences,
					true,
					encryptionSecret
				);
				console.log(`🔄 switchToTodoList result: ${switched}`);
				console.log(`  → Password should now be cached for ${currentList}`);

				// Load todos from the newly encrypted database
				console.log('📋 Loading todos from encrypted database...');
				await loadTodos();
				console.log('✅ Todos loaded after migration');

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
		if (!hasEncryptionSecret(currentPassword)) {
			currentPassword = await getWebAuthnEncryptionKey({ allowCreate: false });
			if (!currentPassword) {
				currentPassword = prompt('Enter current encryption password:');
				if (!currentPassword) {
					return { success: false, isCurrentDbEncrypted: true };
				}
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
