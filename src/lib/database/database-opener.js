import { get } from 'svelte/store';
import { openDatabaseByAddress, openTodoList, openDatabaseByName } from '$lib/p2p.js';
import { todoDBStore } from '$lib/db-actions.js';
import { toastStore } from '$lib/toast-store.js';

/**
 * Open a database with a password
 * @param {Object} options - Opening options
 * @param {string} options.address - Database address
 * @param {string} options.name - Database name
 * @param {string} options.displayName - Display name
 * @param {Object} options.preferences - Network preferences
 * @param {string} options.password - Encryption password
 * @returns {Promise<Object>} Result object with success flag and database
 */
export async function openDatabaseWithPassword(options) {
	const { address, name, displayName, preferences, password } = options;

	if (!password) {
		throw new Error('Password is required');
	}

	let openMethod;
	let openParam;

	// Determine which opening method to use
	if (address) {
		openMethod = openDatabaseByAddress;
		openParam = address;
	} else if (name) {
		openMethod = openDatabaseByName;
		openParam = name;
	} else if (displayName) {
		openMethod = openTodoList;
		openParam = displayName;
	} else {
		throw new Error('Must provide address, name, or displayName');
	}

	try {
		console.log('🔐 Opening database with password...');
		await openMethod(openParam, preferences, true, password);
		const db = get(todoDBStore);

		// Verify password is correct by trying to read entries
		// Wait for database to sync entries from peers before verifying
		console.log('🔍 Verifying password by reading database...');

		const testEntries = await db.all();
		console.log(`📊 Found ${testEntries.length} entries initially`);

		// If database is empty, wait a bit for sync to potentially bring in entries
		if (testEntries.length === 0) {
			console.log('⏳ Empty database - waiting 2s for potential sync...');
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Check again after waiting
			const entriesAfterWait = await db.all();
			console.log(`📊 After waiting: ${entriesAfterWait.length} entries`);

			// If still empty after waiting, this is likely a wrong password
			// For remote encrypted databases: correct password would allow sync to decrypt entries
			if (entriesAfterWait.length === 0 && address) {
				console.error(
					'❌ Database still empty after waiting - likely wrong password for remote encrypted DB'
				);
				toastStore.show('❌ Incorrect password - cannot decrypt remote database', 'error');
				return {
					success: false,
					encrypted: true,
					wrongPassword: true,
					error: new Error('Database empty after sync - wrong password')
				};
			} else if (entriesAfterWait.length > 0) {
				// Entries arrived, try to decrypt them
				try {
					const hasUndefinedValues = entriesAfterWait.some((e) => e.value === undefined);
					if (hasUndefinedValues) {
						throw new Error('Could not decrypt entries - values are undefined');
					}
					console.log(
						`✅ Password verified - successfully read ${entriesAfterWait.length} entries after sync`
					);
				} catch (decryptErr) {
					console.error('❌ Decryption failed after sync:', decryptErr);
					toastStore.show('❌ Incorrect password', 'error');
					return {
						success: false,
						encrypted: true,
						wrongPassword: true,
						error: decryptErr
					};
				}
			}
		} else {
			// Database has entries - verify we can decrypt them
			try {
				// Try to access values to trigger decryption
				const hasUndefinedValues = testEntries.some((e) => e.value === undefined);
				if (hasUndefinedValues) {
					throw new Error('Could not decrypt entries - values are undefined');
				}
				console.log(`✅ Password verified - successfully read ${testEntries.length} entries`);
			} catch (decryptErr) {
				console.error('❌ Decryption failed when reading entries:', decryptErr);
				// Wrong password - database opened but can't decrypt entries
				if (decryptErr.message && decryptErr.message.includes('decrypt')) {
					toastStore.show('❌ Incorrect password', 'error');
					return {
						success: false,
						encrypted: true,
						wrongPassword: true,
						error: decryptErr
					};
				}
				throw decryptErr;
			}
		}

		console.log('✅ Database opened successfully with encryption');
		return {
			success: true,
			encrypted: true,
			database: db
		};
	} catch (err) {
		console.error('❌ Failed to open database with password:', err);

		// Check if it's a decryption error
		if (err.message && err.message.includes('decrypt')) {
			toastStore.show('❌ Incorrect password', 'error');
			return {
				success: false,
				encrypted: true,
				wrongPassword: true,
				error: err
			};
		}

		throw err;
	}
}
