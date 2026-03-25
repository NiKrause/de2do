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
import { openDatabaseWithPassword } from '$lib/database/database-opener.js';
import { updateStoresAfterDatabaseOpen } from '$lib/database/database-manager.js';
import {
	clearInlineUnlock,
	requestInlineUnlock,
	updateInlineUnlock
} from '$lib/encryption/inline-unlock-store.js';

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
				console.log(
					`  → Address match: ${currentAddress === result.newAddress ? 'YES ✅' : 'NO ❌'}`
				);
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
				const switched = await switchToTodoList(currentList, preferences, true, encryptionSecret);
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

	/**
	 * Handle unlocking an already-open database inline.
	 * This intentionally does not try to pre-detect whether a password is necessary.
	 * Users can supply a password or a WebAuthn PRF key and we verify by reopening + reading entries.
	 *
	 * @param {Object} unlockRequest - Requested database to unlock
	 * @param {string|Uint8Array|null} manualSecret - Optional manually entered password
	 * @param {Object} [options] - Unlock options
	 * @returns {Promise<{success: boolean, isCurrentDbEncrypted: boolean, wrongPassword?: boolean}>}
	 */
	async function handleUnlockDatabase(unlockRequest, manualSecret = null, options = {}) {
		const { preferWebAuthn = true } = options;
		const address = unlockRequest?.address || get(currentDbAddressStore);
		const name = unlockRequest?.name || get(currentDbNameStore);
		const displayName = unlockRequest?.displayName || get(currentTodoListNameStore);

		if (!address && !name && !displayName) {
			toastStore.show('No database selected to unlock', 'error');
			return { success: false, isCurrentDbEncrypted: false };
		}

		let encryptionSecret = manualSecret;
		let usedMethod = typeof manualSecret === 'string' ? 'password' : null;
		if (!hasEncryptionSecret(encryptionSecret) && preferWebAuthn) {
			encryptionSecret = await getWebAuthnEncryptionKey({ allowCreate: false });
			if (hasEncryptionSecret(encryptionSecret)) {
				usedMethod = 'webauthn-prf';
			}
		}

		if (!hasEncryptionSecret(encryptionSecret)) {
			updateInlineUnlock({
				...unlockRequest,
				wrongPassword: false,
				error: 'Enter a password or use WebAuthn to unlock this database.'
			});
			return { success: false, isCurrentDbEncrypted: false };
		}

		try {
			const result = await openDatabaseWithPassword({
				address,
				name,
				displayName,
				preferences,
				password: encryptionSecret
			});

			if (result.success) {
				const effectiveAddress = address || result.database?.address;
				if (result.database && effectiveAddress) {
					await updateStoresAfterDatabaseOpen(result.database, effectiveAddress, {
						encryptionEnabledOverride: true
					});
				}
				clearInlineUnlock();
				toastStore.show(
					usedMethod === 'webauthn-prf'
						? 'Database unlocked with WebAuthn'
						: 'Database unlocked',
					'success'
				);
				return { success: true, isCurrentDbEncrypted: true };
			}

			if (result.wrongPassword) {
				updateInlineUnlock({
					...unlockRequest,
					wrongPassword: true,
					error: 'Incorrect password. Please try again.',
					lastTriedMethod: usedMethod
				});
				return { success: false, isCurrentDbEncrypted: false, wrongPassword: true };
			}

			requestInlineUnlock({
				...unlockRequest,
				error: result.error?.message || 'Failed to unlock database.',
				lastTriedMethod: usedMethod
			});
			return { success: false, isCurrentDbEncrypted: false };
		} catch (error) {
			updateInlineUnlock({
				...unlockRequest,
				wrongPassword: false,
				error: error?.message || 'Failed to unlock database.',
				lastTriedMethod: usedMethod
			});
			toastStore.show(`Failed to unlock database: ${error.message}`, 'error');
			return { success: false, isCurrentDbEncrypted: false };
		}
	}

	return {
		handleEnableEncryption,
		handleDisableEncryption,
		handleUnlockDatabase
	};
}
