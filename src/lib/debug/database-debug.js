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

	// Verify that identities referenced by current DB entries can be resolved and verified.
	// Useful for debugging signature verification issues across peers.
	window.debugIdentityCoverage = async (limit = 200) => {
		const orbitdb = get(orbitdbStore);
		const todoDB = get(todoDBStore);
		if (!orbitdb || !todoDB) {
			console.warn('⚠️ OrbitDB or TodoDB not available');
			return null;
		}

		const identities = orbitdb.identities;
		if (!identities?.getIdentity || !identities?.verifyIdentity) {
			console.warn('⚠️ OrbitDB identities API not available');
			return null;
		}

		const identityHashes = new Set();
		let scannedEntries = 0;

		for await (const entry of todoDB.log.traverse()) {
			scannedEntries += 1;
			if (entry?.identity) {
				identityHashes.add(entry.identity);
			}
			if (scannedEntries >= limit) break;
		}

		const rows = [];
		for (const hash of identityHashes) {
			try {
				const resolved = await identities.getIdentity(hash);
				const verified = resolved ? await identities.verifyIdentity(resolved) : false;
				rows.push({
					identityHash: hash,
					resolved: Boolean(resolved),
					verified,
					id: resolved?.id || null,
					type: resolved?.type || null,
					publicKeyLength: resolved?.publicKey?.length ?? null
				});
			} catch (error) {
				rows.push({
					identityHash: hash,
					resolved: false,
					verified: false,
					id: null,
					type: null,
					publicKeyLength: null,
					error: error?.message || String(error)
				});
			}
		}

		const summary = {
			currentIdentity: orbitdb.identity?.id || null,
			databaseAddress: todoDB.address?.toString?.() || String(todoDB.address || ''),
			scannedEntries,
			distinctIdentityHashes: identityHashes.size,
			missingIdentityCount: rows.filter((r) => !r.resolved).length,
			failedVerificationCount: rows.filter((r) => r.resolved && !r.verified).length
		};

		console.log('🔍 Identity coverage summary:', summary);
		console.table(rows);
		return { summary, rows };
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
	console.log(
		'  - window.debugIdentityCoverage(limit?) - Resolve/verify identities used by current DB oplog'
	);
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
