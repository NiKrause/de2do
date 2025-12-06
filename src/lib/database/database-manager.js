import { get } from 'svelte/store';
import {
	openDatabaseWithEncryptionDetection
} from './database-opener.js';
import { loadTodos } from '$lib/db-actions.js';
import { toastStore } from '$lib/toast-store.js';
import {
	listAvailableTodoLists,
	availableTodoListsStore,
	currentTodoListNameStore,
	currentDbNameStore,
	currentDbAddressStore,
	todoListHierarchyStore,
	buildHierarchyPath,
	listUniqueUsers,
	selectedUserIdStore
} from '$lib/todo-list-manager.js';
import { getCurrentIdentityId } from '$lib/stores.js';

/**
 * Open database (always as unencrypted, password can be added manually later)
 * @param {Object} options - Opening options
 * @returns {Promise<Object>} Result with success flag
 */
export async function openDatabaseWithPasswordPrompt(options) {
	const { address, name, displayName, preferences } = options;

	// Always open as unencrypted - password can be added manually later
	const result = await openDatabaseWithEncryptionDetection({
		address,
		name,
		displayName,
		preferences
	});

	return result;
}

/**
 * Update stores and registry after database is opened
 * @param {Object} db - Opened database
 * @param {string} address - Database address
 * @param {Object} preferences - Network preferences
 */
export async function updateStoresAfterDatabaseOpen(db, address) {
	const currentIdentityId = getCurrentIdentityId();
	let displayName = db.name || 'Unknown';
	let dbName = db.name || null;
	let extractedIdentityId = null;

	// Normalize address
	const normalizedAddress = address.startsWith('/') ? address : `/${address}`;

	if (currentIdentityId) {
		// Try to find this address in registry
		await listAvailableTodoLists();
		const availableLists = get(availableTodoListsStore);
		const list = availableLists.find((l) => l.address === normalizedAddress);

		if (list) {
			// Found in registry
			displayName = list.displayName;
			dbName = list.dbName;

			// Extract identity from dbName
			if (dbName && dbName.includes('_')) {
				const underscoreIndex = dbName.indexOf('_');
				if (underscoreIndex > 0) {
					extractedIdentityId = dbName.substring(0, underscoreIndex);
				}
			}
		} else {
			// Not in registry - extract from database name
			if (dbName && dbName.includes('_')) {
				const parts = dbName.split('_');
				if (parts.length >= 2) {
					extractedIdentityId = parts[0];

					const lastPart = parts[parts.length - 1];
					const isTimestamp = /^\d+$/.test(lastPart);

					if (isTimestamp && parts.length >= 3) {
						displayName = parts.slice(1, -1).join('_');
					} else {
						displayName = parts.slice(1).join('_');
					}
				}
			} else if (!displayName || displayName === 'Unknown') {
				displayName = `Database ${address.slice(-8)}`;
				if (!dbName) {
					dbName = `unknown_${displayName}`;
				}
			}

			// Add to registry
			const newList = {
				dbName: dbName,
				displayName: displayName,
				address: normalizedAddress,
				parent: null
			};

			const updatedLists = [...availableLists, newList];
			availableTodoListsStore.set(updatedLists);

			// Persist in registry
			try {
				const { addTodoListToRegistry } = await import('$lib/todo-list-manager.js');
				await addTodoListToRegistry(displayName, dbName, normalizedAddress, null);
			} catch (e) {
				console.warn('Could not persist to registry:', e);
			}
		}

		// Update users list
		await listUniqueUsers();

		// If foreign database, select that user
		if (extractedIdentityId && extractedIdentityId !== currentIdentityId) {
			selectedUserIdStore.set(extractedIdentityId);
		}
	}

	// Update stores
	currentTodoListNameStore.set(displayName);
	if (dbName) {
		currentDbNameStore.set(dbName);
	}
	currentDbAddressStore.set(normalizedAddress);

	// Update hierarchy
	try {
		await listAvailableTodoLists();
		const availableLists = get(availableTodoListsStore);
		const list = availableLists.find((l) => l.address === normalizedAddress);

		if (list && list.parent) {
			const hierarchy = await buildHierarchyPath(list.displayName);
			todoListHierarchyStore.set(hierarchy);
		} else {
			todoListHierarchyStore.set([{ name: displayName, parent: null }]);
		}
	} catch (err) {
		console.warn('Could not update hierarchy:', err);
		todoListHierarchyStore.set([{ name: displayName, parent: null }]);
	}

	// Load todos
	await loadTodos();

	// Show success toast
	if (dbName) {
		toastStore.show(`✅ Database loaded! Name: ${dbName}`, 'success', 5000);
	}
}
