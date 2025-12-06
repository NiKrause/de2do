import { get } from 'svelte/store';
import { openDatabaseByAddress, openTodoList, openDatabaseByName } from '$lib/p2p.js';
import { todoDBStore } from '$lib/db-actions.js';
import { toastStore } from '$lib/toast-store.js';
import { detectDatabaseEncryption } from '$lib/encryption/encryption-detector.js';

/**
 * Open a database (always as unencrypted)
 * Databases can be opened with password later manually if needed
 *
 * @param {Object} options - Opening options
 * @param {string} options.address - Database address (for address-based opening)
 * @param {string} options.name - Database name (for name-based opening)
 * @param {string} options.displayName - Display name (for display-name-based opening)
 * @param {Object} options.preferences - Network preferences
 * @returns {Promise<Object>} Result object with success flag and database
 */
export async function openDatabaseWithEncryptionDetection(options) {
	const { address, name, displayName, preferences } = options;

	let openMethod;
	let openParam;

	// Determine which opening method to use
	if (address) {
		openMethod = openDatabaseByAddress;
		openParam = address;
		console.log('🔍 Opening database by address:', address);
	} else if (name) {
		openMethod = openDatabaseByName;
		openParam = name;
		console.log('🔍 Opening database by name:', name);
	} else if (displayName) {
		openMethod = openTodoList;
		openParam = displayName;
		console.log('🔍 Opening database by display name:', displayName);
	} else {
		throw new Error('Must provide address, name, or displayName');
	}

	try {
		console.log('🔍 Opening database as unencrypted...');

		// Always open without encryption - password can be added manually later
		await openMethod(openParam, preferences, false, null);
		const db = get(todoDBStore);

		console.log('✅ Database opened successfully');
		return {
			success: true,
			encrypted: false,
			database: db
		};
	} catch (err) {
		console.log('⚠️ Error opening database:', err.message);
		return {
			success: false,
			encrypted: false,
			error: err
		};
	}
}

/**
 * Open a database with a password (for manual password entry)
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

		console.log('✅ Database opened successfully with encryption');
		return {
			success: true,
			encrypted: true,
			database: db
		};
	} catch (err) {
		console.error('❌ Failed to open database with password:', err);
		throw err;
	}
}
