import { get } from 'svelte/store';
import {
	openDatabaseWithPasswordPrompt,
	updateStoresAfterDatabaseOpen
} from '$lib/database/database-manager.js';
import { openDatabaseByAddress } from '$lib/p2p.js';
import {
	switchToTodoList,
	currentTodoListNameStore,
	currentDbNameStore,
	currentDbAddressStore,
	extractDisplayName,
	listAvailableTodoLists,
	availableTodoListsStore,
	todoListHierarchyStore,
	buildHierarchyPath
} from '$lib/todo-list-manager.js';
import { todoDBStore, loadTodos } from '$lib/db-actions.js';
import { toastStore } from '$lib/toast-store.js';
import { getCurrentIdentityId } from '$lib/stores.js';

/**
 * Handle hash changes for database navigation
 * @param {Object} context - Context object with state and handlers
 * @returns {Function} Hash change handler
 */
export function createHashChangeHandler(context) {
	return async function handleHashChange() {
		const {
			initializationStore,
			isUpdatingFromHash,
			setIsUpdatingFromHash,
			isEmbedMode,
			setIsEmbedMode,
			embedAllowAdd,
			setEmbedAllowAdd,
			preferences,
			enableEncryption,
			encryptionPassword,
			setIsCurrentDbEncrypted
		} = context;

		const initState = get(initializationStore);
		if (!initState.isInitialized || isUpdatingFromHash) {
			return;
		}

		const hash = window.location.hash;
		if (!hash || !hash.startsWith('#/')) {
			return;
		}

		// Check if this is an embed route
		if (hash.startsWith('#/embed/')) {
			await handleEmbedRoute(hash, context);
			return;
		}

		// Handle regular hash route
		setIsEmbedMode(false);
		setEmbedAllowAdd(false);
		await handleRegularRoute(hash, context);
	};
}

/**
 * Handle embed mode routes
 */
async function handleEmbedRoute(hash, context) {
	const { setIsEmbedMode, setEmbedAllowAdd, setIsUpdatingFromHash, preferences } = context;

	setIsEmbedMode(true);

	// Extract address and query params from #/embed/orbitdb/...?allowAdd=true
	const embedPath = hash.slice(8); // Remove '#/embed/'
	const [addressPart, queryString] = embedPath.split('?');
	const address = addressPart;

	// Parse query params
	if (queryString) {
		const params = new URLSearchParams(queryString);
		setEmbedAllowAdd(params.get('allowAdd') === 'true');
	} else {
		setEmbedAllowAdd(false);
	}

	// Open the database if address is valid
	const normalizedAddress = address.startsWith('/') ? address : `/${address}`;
	if (!address || (!address.startsWith('orbitdb/') && !address.startsWith('/orbitdb/'))) {
		return;
	}

	const currentAddress = get(currentDbAddressStore);
	if (normalizedAddress === currentAddress || address === currentAddress) {
		return; // Already on this database
	}

	console.log(`📂 Opening database from embed hash: ${normalizedAddress}`);
	setIsUpdatingFromHash(true);

	try {
		toastStore.show('🌐 Loading database from network...', 'info', 5000);
		await openDatabaseWithPasswordPrompt({ address: normalizedAddress, preferences });
		await loadTodos();

		// Load hierarchy for breadcrumb navigation
		try {
			await listAvailableTodoLists();
			const availableLists = get(availableTodoListsStore);
			const list = availableLists.find(
				(l) => l.address === normalizedAddress || l.address === address
			);
			if (list) {
				const hierarchy = await buildHierarchyPath(list.displayName);
				todoListHierarchyStore.set(hierarchy);
			} else {
				const currentListName = get(currentTodoListNameStore);
				if (currentListName) {
					todoListHierarchyStore.set([{ name: currentListName, parent: null }]);
				}
			}
		} catch (hierarchyError) {
			console.warn('Could not load hierarchy:', hierarchyError);
			const currentListName = get(currentTodoListNameStore);
			if (currentListName) {
				todoListHierarchyStore.set([{ name: currentListName, parent: null }]);
			}
		}
	} catch (error) {
		console.error('❌ Error opening database from embed hash:', error);
		toastStore.show(`Failed to open database: ${error.message}`, 'error');
	} finally {
		setIsUpdatingFromHash(false);
	}
}

/**
 * Handle regular (non-embed) routes
 */
async function handleRegularRoute(hash, context) {
	const {
		setIsUpdatingFromHash,
		preferences,
		enableEncryption,
		encryptionPassword,
		setIsCurrentDbEncrypted
	} = context;

	const hashValue = hash.slice(2); // Remove '#/'
	if (!hashValue) return;

	const currentAddress = get(currentDbAddressStore);
	if (hashValue === currentAddress) {
		return; // Already on this database
	}

	console.log(`📂 Opening database from URL hash: ${hashValue}`);
	setIsUpdatingFromHash(true);

	try {
		if (hashValue.startsWith('orbitdb/') || hashValue.startsWith('/orbitdb/')) {
			// It's an OrbitDB address - open directly
			await handleAddressRoute(hashValue, preferences);
		} else {
			// Not an address - treat as displayName or dbName
			await handleNameRoute(
				hashValue,
				preferences,
				enableEncryption,
				encryptionPassword,
				setIsCurrentDbEncrypted
			);
		}
	} catch (error) {
		console.error('❌ Error opening database from hash:', error);
		toastStore.show(`Failed to open database: ${error.message}`, 'error');
	} finally {
		setIsUpdatingFromHash(false);
	}
}

/**
 * Handle opening database by address
 */
async function handleAddressRoute(hashValue, preferences) {
	const normalizedAddress = hashValue.startsWith('/') ? hashValue : `/${hashValue}`;
	console.log(`🔗 Opening database by address from URL: ${normalizedAddress}`);
	toastStore.show('🌐 Loading database from network...', 'info', 5000);

	await openDatabaseWithPasswordPrompt({ address: normalizedAddress, preferences });
	const openedDB = get(todoDBStore);

	// Update stores after opening (this handles registry, hierarchy, etc.)
	await updateStoresAfterDatabaseOpen(openedDB, normalizedAddress, preferences);
}

/**
 * Handle opening database by name or displayName
 */
async function handleNameRoute(
	hashValue,
	preferences,
	enableEncryption,
	encryptionPassword,
	setIsCurrentDbEncrypted
) {
	const identityId = getCurrentIdentityId();

	// Try to find it in available lists first
	await listAvailableTodoLists();
	const availableLists = get(availableTodoListsStore);
	const list = availableLists.find((l) => l.displayName === hashValue);

	if (list) {
		// Found in available lists
		if (list.address) {
			// Use the address to open
			await openDatabaseByAddress(list.address, preferences, enableEncryption, encryptionPassword);
			// Track encryption state
			const wasEncrypted = enableEncryption && !!encryptionPassword;
			if (wasEncrypted) {
				setIsCurrentDbEncrypted(true);
			}
			currentTodoListNameStore.set(list.displayName);
			currentDbNameStore.set(list.dbName);
			currentDbAddressStore.set(list.address);
		} else {
			// No address stored, switch normally
			await switchToTodoList(list.displayName, preferences, enableEncryption, encryptionPassword);
			// Track encryption state
			const wasEncrypted = enableEncryption && !!encryptionPassword;
			if (wasEncrypted) {
				setIsCurrentDbEncrypted(true);
			}
		}
	} else if (identityId && hashValue.startsWith(`${identityId}_`)) {
		// It's a full dbName from current identity
		const displayName = extractDisplayName(hashValue, identityId);
		await switchToTodoList(displayName, preferences, enableEncryption, encryptionPassword);
		// Track encryption state
		const wasEncrypted = enableEncryption && !!encryptionPassword;
		if (wasEncrypted) {
			setIsCurrentDbEncrypted(true);
		}
	} else {
		// Not found, try to open as displayName (will create if doesn't exist)
		await switchToTodoList(hashValue, preferences, enableEncryption, encryptionPassword);
		// Track encryption state
		const wasEncrypted = enableEncryption && !!encryptionPassword;
		if (wasEncrypted) {
			setIsCurrentDbEncrypted(true);
		}
	}
}

/**
 * Setup hash router on mount
 * @param {Object} context - Context object with state and handlers
 * @returns {Function} Cleanup function
 */
export function setupHashRouter(context) {
	const { initializationStore, hasHash } = context;
	const handleHashChange = createHashChangeHandler(context);

	// Listen for hash changes
	window.addEventListener('hashchange', handleHashChange);

	// Set up subscription to handle hash after initialization completes
	let hashHandled = false;
	const unsubscribe = initializationStore.subscribe(async (state) => {
		if (state.isInitialized && hasHash && !hashHandled) {
			// Only handle hash once after initialization
			const currentAddress = get(currentDbAddressStore);
			const hash = window.location.hash;
			if (hash && hash.startsWith('#/')) {
				const hashValue = hash.slice(2);
				if (hashValue !== currentAddress) {
					hashHandled = true;
					await handleHashChange();
				}
			}
		}
	});

	// Return cleanup function
	return () => {
		window.removeEventListener('hashchange', handleHashChange);
		unsubscribe();
	};
}
