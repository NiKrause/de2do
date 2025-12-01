import { get } from 'svelte/store';
import { orbitdbStore, todoDBStore, todosStore } from '$lib/db-actions.js';
import { loadTodos } from '$lib/db-actions.js';
import { availableTodoListsStore } from '$lib/todo-list-manager.js';

/**
 * Setup database debugging utilities
 * Exposes database instances and helper functions to window for debugging
 */
export function setupDatabaseDebug() {
	if (typeof window === 'undefined') {
		return;
	}
	
	// Debug function to inspect current database state
	window.debugDatabase = async () => {
		const orbitdb = get(orbitdbStore);
		const todoDB = get(todoDBStore);
		const todos = get(todosStore);
		
		console.log('🔍 Current OrbitDB store:', orbitdb?.id);
		console.log('🔍 Current TodoDB store:', todoDB?.address);
		
		if (todoDB) {
			try {
				const entries = await todoDB.all();
				console.log('🔍 Current database entries:', entries.length, entries);
			} catch (err) {
				console.error('❌ Error reading database entries:', err);
			}
		}
		
		console.log('🔍 Current todos store:', todos.length, todos);
	};
	
	// Force reload todos
	window.forceReloadTodos = async () => {
		console.log('🔄 Force reloading todos...');
		await loadTodos();
		console.log('🔄 Reload complete');
	};
	
	// Get current database address
	window.__getDbAddress = () => {
		const todoDB = get(todoDBStore);
		return todoDB?.address || null;
	};
	
	// Subscribe to availableTodoListsStore and expose to window
	availableTodoListsStore.subscribe((lists) => {
		if (typeof window !== 'undefined') {
			window.__availableTodoLists__ = lists;
		}
	});
	
	console.log('🔧 Database debugging utilities loaded. Available functions:');
	console.log('  - window.debugDatabase() - Inspect database state');
	console.log('  - window.forceReloadTodos() - Force reload todos');
	console.log('  - window.__getDbAddress() - Get current database address');
}

/**
 * Expose database stores to window for e2e testing
 * @param {Object} stores - Store values to expose
 */
export function exposeDatabaseToWindow(stores) {
	if (typeof window === 'undefined') {
		return;
	}
	
	const { currentDbAddress, todoDB, orbitdb, currentIdentityId, currentDbName } = stores;
	
	// Expose database address
	if (currentDbAddress) {
		window.__currentDbAddress__ = currentDbAddress;
	} else if (typeof window.__currentDbAddress__ !== 'undefined') {
		delete window.__currentDbAddress__;
	}
	
	// Expose database instance
	if (todoDB) {
		window.__todoDB__ = todoDB;
		// Also set address from todoDB if not already set
		if (todoDB.address && !currentDbAddress) {
			window.__currentDbAddress__ = todoDB.address;
		}
	}
	
	// Expose orbitdb instance
	if (orbitdb) {
		window.__orbitdb__ = orbitdb;
		if (orbitdb.identity && orbitdb.identity.id) {
			window.__currentIdentityId__ = orbitdb.identity.id;
		}
	} else if (currentIdentityId) {
		window.__currentIdentityId__ = currentIdentityId;
	}
	
	// Expose current database name
	if (currentDbName) {
		window.__currentDbName__ = currentDbName;
	}
}
