import { get } from 'svelte/store';
import { orbitDBStore } from './p2p.js';
import { getCurrentIdentityId } from './stores.js';
import { showToast } from './toast-store.js';
import { addTodoListToRegistry } from './todo-list-manager.js';

function describeEncryptionSecret(secret) {
	if (!secret) return 'NO';
	if (secret?.method === 'threshold-v1') {
		return `YES (threshold-v1, keyRef=${secret.keyRef || 'default'})`;
	}
	if (typeof secret === 'string') {
		return `YES (length: ${secret.length}, first 3 chars: ${secret.substring(0, 3)}***)`;
	}
	if (secret?.subarray) {
		return `YES (bytes: ${secret.length})`;
	}
	return 'YES';
}

function hasEncryptionSecret(secret) {
	if (!secret) return false;
	if (secret?.method === 'threshold-v1') {
		const sessionKey = secret.sessionKey;
		if (!sessionKey) return false;
		if (typeof sessionKey === 'string') return sessionKey.trim().length > 0;
		return Boolean(sessionKey?.subarray && sessionKey.length > 0);
	}
	if (typeof secret === 'string') return secret.trim().length > 0;
	return Boolean(secret?.subarray && secret.length > 0);
}

async function createEncryptionFromSecret(secret, method = null) {
	if (!hasEncryptionSecret(secret)) return null;

	if (method === 'threshold-v1' || secret?.method === 'threshold-v1') {
		const thresholdSecret = secret?.method === 'threshold-v1'
			? secret
			: {
					method: 'threshold-v1',
					keyRef: 'db:migration',
					sessionKey: secret,
					scopes: ['data', 'replication']
				};

		const { default: ThresholdEncryption, createStaticKeyProvider } = await import('../../packages/threshold-encryption/src/index.js');
		const keyProvider = createStaticKeyProvider({ key: thresholdSecret.sessionKey });
		const scopes = Array.isArray(thresholdSecret.scopes) ? thresholdSecret.scopes : ['data'];
		const encryption = {};
		if (scopes.includes('data')) {
			encryption.data = await ThresholdEncryption({
				keyProvider,
				keyRef: thresholdSecret.keyRef || 'db:migration',
				scope: 'data'
			});
		}
		if (scopes.includes('replication')) {
			encryption.replication = await ThresholdEncryption({
				keyProvider,
				keyRef: thresholdSecret.keyRef || 'db:migration',
				scope: 'replication'
			});
		}
		return encryption;
	}

	const SimpleEncryption = (await import('@le-space/orbitdb-simple-encryption')).default;
	const dataEncryption = await SimpleEncryption({ password: secret });
	return { data: dataEncryption };
}

/**
 * Migrate a database to a different encryption state
 * This creates a new database with the target encryption settings and copies all data
 *
 * @param {string} displayName - Display name of the todo list
 * @param {string} currentDbName - Current database name
 * @param {string} currentAddress - Current database address
 * @param {boolean} currentEncryption - Whether current database is encrypted
 * @param {string} currentPassword - Current encryption password (if encrypted)
 * @param {boolean} targetEncryption - Target encryption state
 * @param {string} targetPassword - Target encryption password (if encrypting)
 * @param {Object} preferences - Network preferences
 * @param {string|null} parent - Parent list name
 * @returns {Promise<{success: boolean, newAddress: string|null, newDbName: string|null}>}
 */
export async function migrateDatabaseEncryption(
	displayName,
	currentDbName,
	currentAddress,
	currentEncryption,
	currentPassword,
	targetEncryption,
	targetPassword,
	targetEncryptionMethod,
	preferences = {},
	parent = null
) {
	const orbitdb = get(orbitDBStore);
	if (!orbitdb) {
		throw new Error('OrbitDB instance not initialized');
	}

	const identityId = getCurrentIdentityId();
	if (!identityId) {
		throw new Error('Identity not available');
	}

	showToast('🔄 Migrating database encryption settings...', 'info', 5000);

	try {
		// Step 1: Open the current database with current encryption settings
		const { openDatabaseByAddress } = await import('./p2p.js');
		console.log(`📂 Opening source database: ${currentAddress}`);

		const sourceDb = await openDatabaseByAddress(
			currentAddress,
			preferences,
			currentEncryption,
			currentPassword
		);

		// Step 2: Read all entries from the source database
		console.log('📖 Reading all entries from source database...');
		const allEntries = await sourceDb.all();
		console.log(`📊 Found ${allEntries.length} entries to migrate`);

		if (allEntries.length === 0) {
			showToast('⚠️ No data to migrate', 'warning');
		}

		// Step 3: Close the source database
		console.log('🔒 Closing source database...');
		await sourceDb.close();

		// Step 4: Create the final migrated database with a NEW name/address
		// We intentionally keep the new address to avoid mixing old plaintext history
		// with newly encrypted entries at the same OrbitDB address.
		const timestamp = Date.now();
		const currentName = currentDbName || `${identityId}_${displayName}`;
		const migrationSuffix = targetEncryption
			? `__enc_migrated_${timestamp}`
			: `__plain_migrated_${timestamp}`;
		const finalDbName = `${currentName}${migrationSuffix}`;
		console.log(`✨ Creating migrated database with new name: ${finalDbName}`);
		console.log(`  → Original address: ${currentAddress}`);
		console.log(`  → Target encryption: ${targetEncryption}`);
		console.log(`  → Password provided: ${describeEncryptionSecret(targetPassword)}`);

		// Set up encryption for final database
		const { OrbitDBAccessController } = await import('@orbitdb/core');
		let finalEncryption = null;
		if (targetEncryption && targetPassword) {
			console.log(`  → Creating encryption instances...`);
			finalEncryption = await createEncryptionFromSecret(targetPassword, targetEncryptionMethod);
			console.log(`  → Encryption instances created successfully`);
		}

		// Build options for final database
		const accessController = OrbitDBAccessController({ write: [identityId] });
		const finalDbOptions = {
			type: 'keyvalue',
			create: true,
			sync: preferences.enableNetworkConnection !== false,
			AccessController: accessController
		};
		if (finalEncryption) {
			finalDbOptions.encryption = finalEncryption;
		}

		// Open final database directly without updating global todoDB
		const finalDb = await orbitdb.open(finalDbName, finalDbOptions);

		const finalAddress = finalDb.address;
		console.log(`📍 Final database address: ${finalAddress}`);
		console.log(`  → Address changed: ${currentAddress !== finalAddress ? 'YES ✅' : 'NO ⚠️'}`);

		// Step 5: Copy all entries from source snapshot into the migrated database
		console.log('📝 Copying entries to migrated database...');
		let finalCopiedCount = 0;
		for (const entry of allEntries) {
			try {
				if (entry.key && entry.value) {
					await finalDb.put(entry.key, entry.value);
					finalCopiedCount++;
				}
			} catch (error) {
				console.error(`❌ Error copying entry ${entry.key} to migrated DB:`, error);
			}
		}
		console.log(`✅ Copied ${finalCopiedCount} entries to migrated database`);

		// Step 6: Update registry to point displayName to the new migrated address
		console.log('💾 Updating registry...');
		console.log(
			`  → Registry update: displayName=${displayName}, dbName=${finalDbName}, address=${finalAddress}, encryptionEnabled=${targetEncryption}`
		);
		const { listAvailableTodoLists } = await import('./todo-list-manager.js');
		addTodoListToRegistry(
			displayName,
			finalDbName,
			finalAddress,
			parent,
			targetEncryption,
			targetEncryption ? targetEncryptionMethod || null : null
		);
		console.log(
			`  → Registry entry added for ${displayName} with encryptionEnabled=${targetEncryption}`
		);
		// Refresh the available lists store so switchToTodoList can find the updated address
		listAvailableTodoLists();
		console.log(`  → Available lists refreshed after registry update`);

		// Step 7: Close migrated database (caller will reopen from registry/address)
		await finalDb.close();

		const encryptionStatus = targetEncryption ? 'encrypted' : 'unencrypted';
		showToast(
			`✅ Successfully migrated to ${encryptionStatus} database (${finalCopiedCount} items)`,
			'success',
			5000
		);

		return {
			success: true,
			newAddress: finalAddress,
			newDbName: finalDbName
		};
	} catch (error) {
		console.error('❌ Error migrating database encryption:', error);
		showToast(`Failed to migrate database: ${error.message}`, 'error');
		return {
			success: false,
			newAddress: null,
			newDbName: null
		};
	}
}

/**
 * Enable encryption on an existing unencrypted database
 *
 * @param {string} displayName - Display name of the todo list
 * @param {string} currentDbName - Current database name
 * @param {string} currentAddress - Current database address
 * @param {string} password - Encryption password
 * @param {Object} preferences - Network preferences
 * @param {string|null} parent - Parent list name
 * @returns {Promise<{success: boolean, newAddress: string|null}>}
 */
export async function enableDatabaseEncryption(
	displayName,
	currentDbName,
	currentAddress,
	password,
	encryptionMethod = null,
	preferences = {},
	parent = null
) {
	if (!hasEncryptionSecret(password)) {
		throw new Error('Encryption password is required');
	}

	return await migrateDatabaseEncryption(
		displayName,
		currentDbName,
		currentAddress,
		false, // current: not encrypted
		'', // no current password
		true, // target: encrypted
		password,
		encryptionMethod,
		preferences,
		parent
	);
}

/**
 * Disable encryption on an existing encrypted database
 *
 * @param {string} displayName - Display name of the todo list
 * @param {string} currentDbName - Current database name
 * @param {string} currentAddress - Current database address
 * @param {string} currentPassword - Current encryption password
 * @param {Object} preferences - Network preferences
 * @param {string|null} parent - Parent list name
 * @returns {Promise<{success: boolean, newAddress: string|null}>}
 */
export async function disableDatabaseEncryption(
	displayName,
	currentDbName,
	currentAddress,
	currentPassword,
	preferences = {},
	parent = null
) {
	if (!hasEncryptionSecret(currentPassword)) {
		throw new Error('Current encryption password is required');
	}

	return await migrateDatabaseEncryption(
		displayName,
		currentDbName,
		currentAddress,
		true, // current: encrypted
		currentPassword,
		false, // target: not encrypted
		'', // no target password
		null,
		preferences,
		parent
	);
}
