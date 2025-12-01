import { get } from 'svelte/store';
import { orbitDBStore } from './p2p.js';
import { getCurrentIdentityId } from './stores.js';
import { showToast } from './toast-store.js';
import { addTodoListToRegistry } from './todo-list-manager.js';

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

	// Step 4: Create a TEMPORARY database with a timestamp
	const timestamp = Date.now();
	const tempDisplayName = `${displayName}_temp_${timestamp}`;
	const tempDbName = `${identityId}_${tempDisplayName}`;
	console.log(`✨ Creating temporary database: ${tempDbName}`);

	// Step 5: Open a temporary database with target encryption settings
	const { openTodoList } = await import('./p2p.js');
	const tempDb = await openTodoList(
		tempDisplayName,
		preferences,
		targetEncryption,
		targetPassword
	);

	const tempAddress = tempDb.address;
	console.log(`📍 Temporary database address: ${tempAddress}`);

	// Step 6: Copy all entries to the temporary database
	console.log('📝 Copying entries to temporary database...');
	let copiedCount = 0;
	for (const entry of allEntries) {
		try {
			if (entry.key && entry.value) {
				await tempDb.put(entry.key, entry.value);
				copiedCount++;
			}
		} catch (error) {
			console.error(`❌ Error copying entry ${entry.key}:`, error);
			// Continue with other entries
		}
	}

	console.log(`✅ Copied ${copiedCount} of ${allEntries.length} entries to temp database`);

	// Step 7: Close the temporary database
	console.log('🔒 Closing temporary database...');
	await tempDb.close();

	// Step 8: Delete/drop the original database
	console.log('🗑️ Dropping original database...');
	try {
		// Re-open the source to drop it
		const sourceDbToDelete = await openDatabaseByAddress(
			currentAddress,
			preferences,
			currentEncryption,
			currentPassword
		);
		await sourceDbToDelete.drop();
		console.log('✅ Original database dropped');
	} catch (dropError) {
		console.warn('⚠️ Could not drop original database:', dropError);
		// Continue anyway - we have the data in temp DB
	}

	// Step 9: Create the final database with the ORIGINAL name and target encryption
	// Use orbitdb.open() directly to avoid switching global todoDB state during migration
	console.log(`✨ Creating final database with original name: ${identityId}_${displayName}`);
	const finalDbName = `${identityId}_${displayName}`;
	
	// Set up encryption for final database
	const { OrbitDBAccessController } = await import('@orbitdb/core');
	const SimpleEncryption = (await import('@le-space/orbitdb-simple-encryption')).default;
	let finalEncryption = null;
	if (targetEncryption && targetPassword) {
		const dataEncryption = await SimpleEncryption({ password: targetPassword });
		const replicationEncryption = await SimpleEncryption({ password: targetPassword });
		finalEncryption = { data: dataEncryption, replication: replicationEncryption };
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

	// Step 10: Copy all entries from temp to final database
	console.log('📝 Copying entries to final database...');
	// Re-open temp to read from it (also using createDatabase to avoid state changes)
	const tempDbForReading = await openDatabaseByAddress(
		tempAddress,
		preferences,
		targetEncryption,
		targetPassword
	);
	const tempEntries = await tempDbForReading.all();
	
	// Check if finalDb was closed by the openDatabaseByAddress call above
	// If so, reopen it directly without going through global state
	let finalDbToUse = finalDb;
	if (!finalDb.opened) {
		console.log('⚠️ Final database was closed, reopening...');
		finalDbToUse = await orbitdb.open(finalDbName, finalDbOptions);
	}
	
	let finalCopiedCount = 0;
	for (const entry of tempEntries) {
		try {
			if (entry.key && entry.value) {
				await finalDbToUse.put(entry.key, entry.value);
				finalCopiedCount++;
			}
		} catch (error) {
			console.error(`❌ Error copying entry ${entry.key} to final:`, error);
		}
	}
	console.log(`✅ Copied ${finalCopiedCount} entries to final database`);

	// Step 11: Close temp database and drop it
	console.log('🗑️ Dropping temporary database...');
	try {
		await tempDbForReading.drop();
		console.log('✅ Temporary database dropped');
	} catch (tempDropError) {
		console.warn('⚠️ Could not drop temp database:', tempDropError);
		// Not critical - temp DB will just remain unused
	}

	// Step 12: Update the registry with the final database info (original name!)
	console.log('💾 Updating registry...');
	addTodoListToRegistry(
		displayName,
		finalDbName,
		finalAddress,
		parent,
		targetEncryption
	);

	// Step 13: Close the final database (it will be reopened by the caller)
	await finalDbToUse.close();

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
	preferences = {},
	parent = null
) {
	if (!password || !password.trim()) {
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
	if (!currentPassword || !currentPassword.trim()) {
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
		preferences,
		parent
	);
}
