import { writable, get } from 'svelte/store';
import { showToast } from './toast-store.js';
import { currentDbAddressStore, getCurrentIdentityId } from './stores.js';
// Dynamic import for openTodoList to avoid circular dependency
// import { openTodoList } from './p2p.js';

// Store for current todo list name (display name, without ID prefix)
export const currentTodoListNameStore = writable('projects');

// Store for current database name (full name with identity ID prefix)
export const currentDbNameStore = writable(null);

// Re-export for backward compatibility (but import from stores.js to avoid circular dependency)
export { currentDbAddressStore };

// Store for list of available todo lists
export const availableTodoListsStore = writable([]);

// Store for list of unique user IDs/DIDs
export const uniqueUsersStore = writable([]);

// Store for manually tracked/added user identities
export const trackedUsersStore = writable([]);

// Store for todo list hierarchy (breadcrumb trail)
export const todoListHierarchyStore = writable([]);

// Store to track the selected user for filtering todo lists
export const selectedUserIdStore = writable(null); // null means show all users

// In-memory cache for encryption passwords (per session only, not persisted)
const sessionPasswordCache = new Map(); // key: dbName, value: password

/**
 * Get cached encryption password for a database
 * @param {string} dbName - Database name
 * @returns {string|null} Cached password or null
 */
export function getCachedPassword(dbName) {
	return sessionPasswordCache.get(dbName) || null;
}

/**
 * Cache encryption password for a database (session only)
 * @param {string} dbName - Database name
 * @param {string} password - Encryption password
 */
export function cachePassword(dbName, password) {
	if (password) {
		sessionPasswordCache.set(dbName, password);
	}
}

/**
 * Clear cached password for a database
 * @param {string} dbName - Database name
 */
export function clearCachedPassword(dbName) {
	sessionPasswordCache.delete(dbName);
}

/**
 * Clear all cached passwords
 */
export function clearAllCachedPasswords() {
	sessionPasswordCache.clear();
}

/**
 * Extract display name from database name (remove identity ID prefix)
 * @param {string} dbName - Full database name (identityId_todoListName)
 * @param {string} identityId - The identity ID to remove
 * @returns {string} Display name without ID prefix
 */
export function extractDisplayName(dbName, identityId) {
	if (!identityId || !dbName) return dbName;
	const prefix = `${identityId}_`;
	if (dbName.startsWith(prefix)) {
		return dbName.substring(prefix.length);
	}
	return dbName;
}

/**
 * Get the localStorage key for the registry
 * @param {string} identityId - The identity ID
 * @returns {string} LocalStorage key for registry
 */
function getRegistryKey(identityId) {
	return `todoListRegistry_${identityId}`;
}

/**
 * Get registry from localStorage
 * @param {string} identityId - The identity ID
 * @returns {Object} Registry object with todo lists (key: displayName, value: metadata)
 */
function getRegistryFromLocalStorage(identityId) {
	try {
		const key = getRegistryKey(identityId);
		const data = localStorage.getItem(key);
		if (data) {
			return JSON.parse(data);
		}
		return {};
	} catch (error) {
		console.error('❌ Error reading registry from localStorage:', error);
		return {};
	}
}

/**
 * Save registry to localStorage
 * @param {string} identityId - The identity ID
 * @param {Object} registry - Registry object to save
 */
function saveRegistryToLocalStorage(identityId, registry) {
	try {
		const key = getRegistryKey(identityId);
		localStorage.setItem(key, JSON.stringify(registry));
	} catch (error) {
		console.error('❌ Error saving registry to localStorage:', error);
	}
}

/**
 * Get a todo list entry from registry
 * @param {string} identityId - The identity ID
 * @param {string} displayName - Display name of the todo list
 * @returns {Object|null} Todo list metadata or null if not found
 */
function getRegistryEntry(identityId, displayName) {
	const registry = getRegistryFromLocalStorage(identityId);
	return registry[displayName] || null;
}

/**
 * Set a todo list entry in registry
 * @param {string} identityId - The identity ID
 * @param {string} displayName - Display name of the todo list
 * @param {Object} metadata - Todo list metadata
 */
function setRegistryEntry(identityId, displayName, metadata) {
	const registry = getRegistryFromLocalStorage(identityId);
	registry[displayName] = metadata;
	saveRegistryToLocalStorage(identityId, registry);
}

/**
 * Delete a todo list entry from registry
 * @param {string} identityId - The identity ID
 * @param {string} displayName - Display name of the todo list
 */
function deleteRegistryEntry(identityId, displayName) {
	const registry = getRegistryFromLocalStorage(identityId);
	delete registry[displayName];
	saveRegistryToLocalStorage(identityId, registry);
}

/**
 * List all available todo list databases from the localStorage registry
 * @returns {Array} Array of todo list objects with dbName, displayName, encryptionEnabled
 */
export function listAvailableTodoLists() {
	const identityId = getCurrentIdentityId();

	if (!identityId) {
		console.warn('⚠️ Identity not available');
		return [];
	}

	try {
		// Read registry from localStorage
		const registry = getRegistryFromLocalStorage(identityId);
		const todoLists = [];

		// Convert registry object to array
		for (const [displayName, metadata] of Object.entries(registry)) {
			if (metadata && typeof metadata === 'object') {
				todoLists.push({
					dbName: metadata.dbName || `${identityId}_${displayName}`,
					displayName: displayName,
					address: metadata.address || null,
					parent: metadata.parent || null,
					encryptionEnabled: metadata.encryptionEnabled || false
				});
			}
		}

		// Ensure 'projects' is in the list (default)
		if (!todoLists.some((list) => list.displayName === 'projects')) {
			todoLists.unshift({
				dbName: `${identityId}_projects`,
				displayName: 'projects',
				address: null,
				parent: null,
				encryptionEnabled: false
			});
			// Also add it to registry
			setRegistryEntry(identityId, 'projects', {
				displayName: 'projects',
				dbName: `${identityId}_projects`,
				address: null,
				parent: null,
				encryptionEnabled: false,
				createdAt: new Date().toISOString()
			});
		}

		// Organize hierarchically: root lists first, then sub-lists under their parents
		const organizedLists = [];
		const rootLists = [];
		const subListsByParent = new Map();

		// Separate root lists and sub-lists
		for (const list of todoLists) {
			if (list.parent) {
				if (!subListsByParent.has(list.parent)) {
					subListsByParent.set(list.parent, []);
				}
				subListsByParent.get(list.parent).push(list);
			} else {
				rootLists.push(list);
			}
		}

		// Sort root lists
		rootLists.sort((a, b) => a.displayName.localeCompare(b.displayName));

		// Build hierarchical list: root lists first, then their sub-lists
		for (const rootList of rootLists) {
			organizedLists.push(rootList);
			const subLists = subListsByParent.get(rootList.displayName) || [];
			subLists.sort((a, b) => a.displayName.localeCompare(b.displayName));
			organizedLists.push(...subLists);
		}

		// Add any orphaned sub-lists (parent doesn't exist) - these should still be shown
		for (const [parentName, subLists] of subListsByParent.entries()) {
			if (!todoLists.some((list) => list.displayName === parentName)) {
				subLists.sort((a, b) => a.displayName.localeCompare(b.displayName));
				organizedLists.push(...subLists);
			}
		}

		availableTodoListsStore.set(organizedLists);

		// Initialize hierarchy if empty and we have projects
		const hierarchy = get(todoListHierarchyStore);
		if (hierarchy.length === 0 && organizedLists.length > 0) {
			const currentList = get(currentTodoListNameStore);
			if (currentList) {
				todoListHierarchyStore.set([{ name: currentList, parent: null }]);
			}
		}

		console.log(
			`📋 Found ${organizedLists.length} todo lists from registry:`,
			organizedLists.map((l) => l.displayName).join(', ')
		);
		return organizedLists;
	} catch (error) {
		console.error('❌ Error listing todo lists from registry:', error);
		return [];
	}
}

/**
 * Build hierarchy path for a todo list by traversing up the parent chain
 * @param {string} todoListName - Display name of the todo list
 * @returns {Array<{name: string, parent: string|null}>} Hierarchy path from root to the list
 */
export function buildHierarchyPath(todoListName) {
	const identityId = getCurrentIdentityId();
	if (!identityId) {
		return [{ name: todoListName, parent: null }];
	}

	try {
		const hierarchy = [];
		const visited = new Set(); // Prevent infinite loops
		let currentName = todoListName;

		// Traverse up the parent chain
		while (currentName && !visited.has(currentName)) {
			visited.add(currentName);

			const entry = getRegistryEntry(identityId, currentName);
			if (entry) {
				// Add to beginning of hierarchy (root first)
				hierarchy.unshift({ name: currentName, parent: entry.parent || null });
				currentName = entry.parent;
			} else {
				// Entry not found, stop here
				if (hierarchy.length === 0) {
					// No entry found at all, return just this list as root
					hierarchy.push({ name: currentName, parent: null });
				}
				break;
			}
		}

		// If we didn't find the list in registry, add it as root
		if (hierarchy.length === 0) {
			hierarchy.push({ name: todoListName, parent: null });
		}

		return hierarchy;
	} catch (error) {
		console.error('❌ Error building hierarchy path:', error);
		// Fallback to root level
		return [{ name: todoListName, parent: null }];
	}
}

/**
 * Add a todo list to the localStorage registry
 * @param {string} displayName - Display name of the todo list
 * @param {string} dbName - Full database name
 * @param {string|null} address - Database address
 * @param {string|null} parent - Parent todo list name (for sub-lists)
 * @param {boolean} encryptionEnabled - Whether encryption is enabled for this list
 */
export function addTodoListToRegistry(
	displayName,
	dbName,
	address = null,
	parent = null,
	encryptionEnabled = false
) {
	const identityId = getCurrentIdentityId();
	if (!identityId) return;

	try {
		// Extract identity from dbName (part before first underscore)
		let dbNameIdentity = null;
		if (dbName && dbName.includes('_')) {
			const underscoreIndex = dbName.indexOf('_');
			if (underscoreIndex > 0) {
				dbNameIdentity = dbName.substring(0, underscoreIndex);
			}
		}

		// Only validate/overwrite dbName if it belongs to the current identity
		// If it belongs to a different identity, preserve it as-is
		if (dbNameIdentity === identityId) {
			// Database belongs to current identity - validate pattern
			const expectedDbName = `${identityId}_${displayName}`;
			if (dbName !== expectedDbName) {
				console.warn(
					`⚠️ dbName mismatch: expected ${expectedDbName}, got ${dbName}. Using expected value.`
				);
				dbName = expectedDbName;
			}
		} else if (dbNameIdentity) {
			// Database belongs to a different identity - preserve dbName as-is
			console.log(
				`ℹ️  Preserving dbName from different identity: ${dbName} (identity: ${dbNameIdentity})`
			);
		} else {
			// No identity in dbName - use current identity pattern
			console.warn(`⚠️ dbName has no identity prefix, using current identity: ${identityId}`);
			dbName = `${identityId}_${displayName}`;
		}

		// Get existing entry to preserve encryption state if not explicitly set
		const existingEntry = getRegistryEntry(identityId, displayName);
		const finalEncryptionEnabled =
			encryptionEnabled !== undefined
				? encryptionEnabled
				: existingEntry?.encryptionEnabled || false;

		// Store in registry with displayName as key
		setRegistryEntry(identityId, displayName, {
			displayName: displayName,
			dbName: dbName,
			address: address || null,
			parent: parent || null,
			encryptionEnabled: finalEncryptionEnabled,
			createdAt: existingEntry?.createdAt || new Date().toISOString()
		});

		const parentInfo = parent ? ` (child of: ${parent})` : '';
		const encryptionInfo = finalEncryptionEnabled ? ' 🔐' : '';
		console.log(
			`💾 Added to registry: ${displayName} (${dbName})${address ? ` [${address}]` : ''}${parentInfo}${encryptionInfo}`
		);
	} catch (error) {
		console.error('❌ Error adding todo list to registry:', error);
	}
}

/**
 * Remove a todo list from the localStorage registry
 * @param {string} displayName - Display name of the todo list to remove
 * @returns {boolean} Success status
 */
export function removeTodoListFromRegistry(displayName) {
	const identityId = getCurrentIdentityId();
	if (!identityId) {
		console.warn('⚠️ Cannot remove todo list: no identity available');
		return false;
	}

	try {
		// Delete from registry
		deleteRegistryEntry(identityId, displayName);
		console.log(`🗑️ Removed from registry: ${displayName}`);

		// Refresh the available lists
		listAvailableTodoLists();

		return true;
	} catch (error) {
		console.error('❌ Error removing todo list from registry:', error);
		return false;
	}
}

/**
 * Create or switch to a todo list
 * @param {string} todoListName - Display name of the todo list
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether encryption is enabled
 * @param {string} encryptionPassword - Encryption password
 * @param {string} parentListName - Name of the parent todo list (for hierarchy)
 * @returns {Promise<boolean>} Success status
 */
export async function switchToTodoList(
	todoListName,
	preferences = {},
	enableEncryption = false,
	encryptionPassword = '',
	parentListName = null
) {
	if (!todoListName || todoListName.trim() === '') {
		console.error('❌ Todo list name cannot be empty');
		return false;
	}

	const trimmedName = todoListName.trim();

	try {
		const currentUserIdentity = getCurrentIdentityId();
		let targetIdentityId = currentUserIdentity; // Default to current user

		// First, determine which identity this list belongs to
		// This is needed before we can check encryption settings
		const availableLists = get(availableTodoListsStore);

		// Check if the target list exists in availableTodoListsStore
		// This tells us which identity it belongs to
		const targetListInStore = availableLists.find((list) => {
			const nameMatches = list.displayName === trimmedName;
			const parentMatches = parentListName ? list.parent === parentListName : !list.parent;
			return nameMatches && parentMatches;
		});

		// If we found the list, use its identity
		if (targetListInStore && targetListInStore.dbName && targetListInStore.dbName.includes('_')) {
			const listIdentity = targetListInStore.dbName.split('_')[0];
			targetIdentityId = listIdentity;
			console.log(
				`🔍 Found target list in store. Using identity: ${targetIdentityId.slice(0, 16)}...`
			);
		} else if (parentListName) {
			// If we're navigating to a sublist (has parent), ALWAYS use parent's identity
			// This ensures sub-lists are created with the correct owner's identity
			let currentDbIdentity = null;
			const currentDbName = get(currentDbNameStore);

			if (currentDbName && currentDbName.includes('_')) {
				currentDbIdentity = currentDbName.split('_')[0];
			} else {
				// If currentDbNameStore is not set (e.g., when opening by address),
				// try to find the current list in availableTodoListsStore using currentDbAddressStore
				const currentAddress = get(currentDbAddressStore);
				if (currentAddress) {
					const currentList = availableLists.find((list) => list.address === currentAddress);
					if (currentList && currentList.dbName && currentList.dbName.includes('_')) {
						currentDbIdentity = currentList.dbName.split('_')[0];
						console.log(
							`🔍 Found current list identity from availableLists: ${currentDbIdentity.slice(0, 16)}...`
						);
					}
				}
			}

			// ALWAYS use parent's identity for sub-lists (sub-lists belong to the parent's owner)
			if (currentDbIdentity) {
				targetIdentityId = currentDbIdentity;
				console.log(
					`🔍 Creating/navigating to sublist. Using parent's identity: ${targetIdentityId.slice(0, 16)}...`
				);
			} else {
				// Fallback: if we can't determine parent's identity, log a warning but still try
				console.warn(
					`⚠️ Could not determine parent's identity for sub-list "${trimmedName}". Using current user's identity as fallback.`
				);
			}
		}
		// Otherwise, use current user's identity (default)

		// Now check if this list requires encryption and handle password
		// Use targetIdentityId (which may be different from currentUserIdentity)
		if (targetIdentityId) {
			const registryEntry = getRegistryEntry(targetIdentityId, trimmedName);

			// If list is encrypted but no password provided
			if (registryEntry?.encryptionEnabled && !encryptionPassword) {
				const dbName = `${targetIdentityId}_${trimmedName}`;
				const cachedPassword = getCachedPassword(dbName);

				if (cachedPassword) {
					// Use cached password from this session
					console.log('🔐 Using cached password for encrypted database');
					encryptionPassword = cachedPassword;
					enableEncryption = true;
				} else {
					// Password required but not in cache - need to prompt user
					console.log('🔐 Encryption password required');
					const error = new Error('ENCRYPTION_PASSWORD_REQUIRED');
					error.dbName = dbName;
					error.displayName = trimmedName;
					throw error;
				}
			}

			// If encryption enabled, cache the password for this session
			if (enableEncryption && encryptionPassword) {
				const dbName = `${targetIdentityId}_${trimmedName}`;
				cachePassword(dbName, encryptionPassword);
				console.log('🔐 Cached encryption password for session');
			}
		}

		// Now try to find the exact list with the target identity
		const existingList = availableLists.find((list) => {
			const nameMatches = list.displayName === trimmedName;
			const parentMatches = parentListName ? list.parent === parentListName : !list.parent;

			if (list.dbName && list.dbName.includes('_')) {
				const listIdentity = list.dbName.split('_')[0];
				return nameMatches && parentMatches && listIdentity === targetIdentityId;
			}
			return nameMatches && parentMatches;
		});

		// If we found the list with an address, open it by address
		if (existingList && existingList.address) {
			console.log(
				`✅ Found existing list in registry, opening by address: ${existingList.address.slice(0, 30)}...`
			);
			const { openDatabaseByAddress } = await import('./p2p.js');

			await openDatabaseByAddress(
				existingList.address,
				preferences,
				enableEncryption,
				encryptionPassword
			);

			currentTodoListNameStore.set(trimmedName);
			currentDbNameStore.set(existingList.dbName);
			currentDbAddressStore.set(existingList.address);

			// Update URL hash to match the database address
			if (typeof window !== 'undefined' && existingList.address) {
				const hash = existingList.address.startsWith('/')
					? existingList.address
					: `/${existingList.address}`;
				if (window.location.hash !== `#${hash}`) {
					window.history.replaceState(null, '', `#${hash}`);
				}
			}

			// Update hierarchy
			const currentHierarchy = get(todoListHierarchyStore);
			if (parentListName) {
				const parentIndex = currentHierarchy.findIndex((item) => item.name === parentListName);
				if (parentIndex >= 0) {
					todoListHierarchyStore.set([
						...currentHierarchy.slice(0, parentIndex + 1),
						{ name: trimmedName, parent: parentListName }
					]);
				} else {
					const fullHierarchy = buildHierarchyPath(trimmedName);
					todoListHierarchyStore.set(fullHierarchy);
				}
			} else {
				const fullHierarchy = buildHierarchyPath(trimmedName);
				todoListHierarchyStore.set(fullHierarchy);
			}

			// Refresh available lists
			listAvailableTodoLists();
			await listUniqueUsers();

			showToast(`Switched to todo list: ${trimmedName}`, 'success');
			return true;
		}

		// If not found, try to open by name using the target identity
		const dbName = targetIdentityId ? `${targetIdentityId}_${trimmedName}` : trimmedName;

		// If it's not our identity, use openDatabaseByName instead of openTodoList
		if (targetIdentityId !== currentUserIdentity) {
			console.log(`🔍 Opening list by name (different identity): ${dbName}`);
			const { openDatabaseByName } = await import('./p2p.js');

			const openedDB = await openDatabaseByName(
				dbName,
				preferences,
				enableEncryption,
				encryptionPassword
			);

			currentTodoListNameStore.set(trimmedName);
			currentDbNameStore.set(dbName);
			currentDbAddressStore.set(openedDB?.address || null);

			// Update hierarchy
			const currentHierarchy = get(todoListHierarchyStore);
			if (parentListName) {
				const parentIndex = currentHierarchy.findIndex((item) => item.name === parentListName);
				if (parentIndex >= 0) {
					todoListHierarchyStore.set([
						...currentHierarchy.slice(0, parentIndex + 1),
						{ name: trimmedName, parent: parentListName }
					]);
				} else {
					// For other user's sublists, we can't build hierarchy from their registry
					const newHierarchy = parentListName
						? [...currentHierarchy, { name: trimmedName, parent: parentListName }]
						: [{ name: trimmedName, parent: null }];
					todoListHierarchyStore.set(newHierarchy);
				}
			} else {
				todoListHierarchyStore.set([{ name: trimmedName, parent: null }]);
			}

			// Add to registry so it's available for future navigation
			if (openedDB?.address) {
				addTodoListToRegistry(trimmedName, dbName, openedDB.address, parentListName);
			}

			// Refresh available lists
			listAvailableTodoLists();
			await listUniqueUsers();

			showToast(`Switched to todo list: ${trimmedName}`, 'success');
			return true;
		}

		// Original logic for our own databases
		// Dynamic import to avoid circular dependency
		const { openTodoList } = await import('./p2p.js');
		const openedDB = await openTodoList(
			trimmedName,
			preferences,
			enableEncryption,
			encryptionPassword
		);
		currentTodoListNameStore.set(trimmedName);
		currentDbNameStore.set(dbName);
		currentDbAddressStore.set(openedDB?.address || null);

		// Update URL hash to match the database address
		if (typeof window !== 'undefined' && openedDB?.address) {
			const hash = openedDB.address.startsWith('/') ? openedDB.address : `/${openedDB.address}`;
			if (window.location.hash !== `#${hash}`) {
				window.history.replaceState(null, '', `#${hash}`);
			}
		}

		// Determine parent from parameter or registry
		let actualParent = parentListName;
		if (!actualParent && currentUserIdentity) {
			// Look up parent from registry
			const entry = getRegistryEntry(currentUserIdentity, trimmedName);
			if (entry && entry.parent) {
				actualParent = entry.parent;
			}
		}

		// Update hierarchy
		const currentHierarchy = get(todoListHierarchyStore);
		if (actualParent) {
			// Find parent in current hierarchy and add as child
			const parentIndex = currentHierarchy.findIndex((item) => item.name === actualParent);
			if (parentIndex >= 0) {
				// Keep up to parent, then add new child
				todoListHierarchyStore.set([
					...currentHierarchy.slice(0, parentIndex + 1),
					{ name: trimmedName, parent: actualParent }
				]);
			} else {
				// Parent not in current hierarchy - build full path from registry
				const fullHierarchy = buildHierarchyPath(trimmedName);
				todoListHierarchyStore.set(fullHierarchy);
			}
		} else {
			// Root level - build hierarchy from registry to ensure we have the full path
			const fullHierarchy = buildHierarchyPath(trimmedName);
			todoListHierarchyStore.set(fullHierarchy);
		}

		// Add to registry (now localStorage)
		if (currentUserIdentity) {
			addTodoListToRegistry(trimmedName, dbName, openedDB?.address || null, actualParent);
		}

		// Refresh available todo lists and unique users
		listAvailableTodoLists();
		await listUniqueUsers();

		showToast(`Switched to todo list: ${trimmedName}`, 'success');
		return true;
	} catch (error) {
		// Don't show error toast for encryption password required - this is expected
		if (error.message !== 'ENCRYPTION_PASSWORD_REQUIRED') {
			console.error('❌ Error switching to todo list:', error);
			showToast(`Failed to switch to todo list: ${error.message}`, 'error');
		} else {
			console.log('🔐 Password required - cached password not available');
		}
		return false;
	}
}

/**
 * Create a sub-list from a todo item
 * @param {string} todoText - Text of the todo item (will become the sub-list name)
 * @param {string} parentListName - Name of the parent todo list
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether encryption is enabled
 * @param {string} encryptionPassword - Encryption password
 * @returns {Promise<boolean>} Success status
 */
export async function createSubList(
	todoText,
	parentListName,
	preferences = {},
	enableEncryption = false,
	encryptionPassword = ''
) {
	// Create a slug from the todo text
	const slug = todoText
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '') // Remove special characters
		.replace(/\s+/g, '-') // Replace spaces with hyphens
		.replace(/-+/g, '-') // Replace multiple hyphens with single
		.replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

	if (!slug) {
		showToast('Cannot create sub-list: invalid name', 'error');
		return false;
	}

	return await switchToTodoList(
		slug,
		preferences,
		enableEncryption,
		encryptionPassword,
		parentListName
	);
}

/**
 * Navigate up the hierarchy (to parent list)
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether encryption is enabled
 * @param {string} encryptionPassword - Encryption password
 * @returns {Promise<boolean>} Success status
 */
export async function navigateUp(
	preferences = {},
	enableEncryption = false,
	encryptionPassword = ''
) {
	const hierarchy = get(todoListHierarchyStore);
	if (hierarchy.length <= 1) {
		// Already at root or no hierarchy
		return false;
	}

	// Remove current level and get parent
	const newHierarchy = hierarchy.slice(0, -1);
	const parent = newHierarchy[newHierarchy.length - 1];

	if (parent) {
		todoListHierarchyStore.set(newHierarchy);
		return await switchToTodoList(
			parent.name,
			preferences,
			enableEncryption,
			encryptionPassword,
			parent.parent
		);
	}

	return false;
}

/**
 * Create a new todo list
 * @param {string} todoListName - Display name for the new todo list
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether encryption is enabled
 * @param {string} encryptionPassword - Encryption password
 * @returns {Promise<boolean>} Success status
 */
export async function createTodoList(
	todoListName,
	preferences = {},
	enableEncryption = false,
	encryptionPassword = ''
) {
	return await switchToTodoList(todoListName, preferences, enableEncryption, encryptionPassword);
}

/**
 * List all unique user IDs/DIDs from registry databases
 * Since each identity has its own registry database (named after the identityId),
 * we can't easily enumerate all identities without knowing them in advance.
 * For now, we'll just return the current identity.
 * @returns {Promise<Array>} Array of unique user IDs/DIDs
 */
export async function listUniqueUsers() {
	try {
		const uniqueIds = new Set();

		// ALWAYS include the current user's identity, even if not in available lists
		const currentIdentityId = getCurrentIdentityId();
		if (currentIdentityId) {
			uniqueIds.add(currentIdentityId);
			console.log('  - Added current identity:', currentIdentityId);
		}

		// Extract identity IDs from database names (format: identityId_displayName)
		// Take only the part before the first underscore
		const availableLists = get(availableTodoListsStore);
		console.log('🔍 listUniqueUsers: Checking', availableLists.length, 'lists');

		for (const list of availableLists) {
			if (list.dbName && list.dbName.includes('_')) {
				const underscoreIndex = list.dbName.indexOf('_');
				if (underscoreIndex > 0) {
					const identityId = list.dbName.substring(0, underscoreIndex);
					if (identityId) {
						uniqueIds.add(identityId);
						console.log('  - Found identity:', identityId, 'from dbName:', list.dbName);
					}
				}
			} else {
				console.log('  - Skipping list (no dbName or no underscore):', list);
			}
		}

		const uniqueUsersArray = Array.from(uniqueIds).sort();
		console.log('�� Unique users found:', uniqueUsersArray);
		uniqueUsersStore.set(uniqueUsersArray);
		return uniqueUsersArray;
	} catch (error) {
		console.error('❌ Error listing unique users:', error);
		// Even on error, ensure current identity is included
		const currentIdentityId = getCurrentIdentityId();
		if (currentIdentityId) {
			uniqueUsersStore.set([currentIdentityId]);
		}
		return [];
	}
}

// Function to add a tracked user and discover their projects database
export async function addTrackedUser(identityId) {
	if (!identityId || !identityId.trim()) {
		throw new Error('Identity ID is required');
	}

	const trimmedId = identityId.trim();
	const tracked = get(trackedUsersStore);

	// Check if already tracked
	if (tracked.includes(trimmedId)) {
		console.log(`ℹ️  Identity ${trimmedId} is already tracked`);
		return;
	}

	// Add to tracked users
	trackedUsersStore.set([...tracked, trimmedId]);

	// Try to discover and add their "projects" database
	try {
		const { openDatabaseByName } = await import('./p2p.js');
		const dbName = `${trimmedId}_projects`;

		console.log(`🔍 Attempting to discover projects database for identity: ${trimmedId}`);

		const preferences = {
			enablePersistentStorage: true,
			enableNetworkConnection: true,
			enablePeerConnections: true
		};

		// Try to open their projects database
		const projectsDb = await openDatabaseByName(dbName, preferences, false, '');

		if (projectsDb && projectsDb.address) {
			// Add to our registry
			await addTodoListToRegistry('projects', dbName, projectsDb.address, null);

			// Refresh available lists
			await listAvailableTodoLists();

			// Update unique users list
			await listUniqueUsers();

			console.log(`✅ Successfully discovered and added projects database for ${trimmedId}`);
			return true;
		}
	} catch (error) {
		console.warn(`⚠️ Could not discover projects database for ${trimmedId}:`, error);
		// Don't throw - user is still added to tracked list even if discovery fails
	}

	return false;
}

// Function to remove a tracked user
export function removeTrackedUser(identityId) {
	const tracked = get(trackedUsersStore);
	trackedUsersStore.set(tracked.filter((id) => id !== identityId));

	// Also remove from unique users if it was only there because we tracked it
	// (This is optional - you might want to keep discovered users even if untracked)
}
