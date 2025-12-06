import { isDatabaseEncrypted } from '@le-space/orbitdb-simple-encryption';

/**
 * Wait for database sync events to complete
 * @param {Object} db - OrbitDB database instance
 * @param {number} timeoutMs - Maximum time to wait in milliseconds
 * @returns {Promise<{syncOccurred: boolean, entries: Array}>} Object with sync status and entries
 */
async function waitForDatabaseSync(db, timeoutMs = 5000) {
	if (!db || !db.events) {
		return { syncOccurred: false, entries: [] };
	}

	return new Promise((resolve) => {
		let hasResolved = false;
		const timeout = setTimeout(async () => {
			if (hasResolved) return;
			hasResolved = true;
			console.log('⏰ Timeout waiting for database sync');
			cleanup();
			try {
				const entries = await db.all();
				resolve({ syncOccurred: false, entries });
			} catch {
				resolve({ syncOccurred: false, entries: [] });
			}
		}, timeoutMs);

		// Listen for 'update' event - fires when entries are added/updated (local or from peers)
		const onUpdate = async () => {
			if (hasResolved) return;
			hasResolved = true;
			console.log('📥 Database sync: update event received');
			cleanup();
			try {
				const entries = await db.all();
				resolve({ syncOccurred: true, entries });
			} catch {
				resolve({ syncOccurred: true, entries: [] });
			}
		};

		// Listen for 'join' event - fires when a peer connects with data
		const onJoin = async (peerId, heads) => {
			if (hasResolved) return;
			// Only resolve if peer has data to share
			if (heads && heads.length > 0) {
				hasResolved = true;
				console.log(`📥 Database sync: peer joined with ${heads.length} heads`);
				cleanup();
				try {
					const entries = await db.all();
					resolve({ syncOccurred: true, entries });
				} catch {
					resolve({ syncOccurred: true, entries: [] });
				}
			}
		};

		const cleanup = () => {
			clearTimeout(timeout);
			if (db.events) {
				db.events.off('update', onUpdate);
				db.events.off('join', onJoin);
			}
		};

		// Set up listeners
		db.events.on('update', onUpdate);
		db.events.on('join', onJoin);

		// Check if database already has entries (might be synced already)
		db.all()
			.then((entries) => {
				if (hasResolved) return;
				if (entries.length > 0) {
					hasResolved = true;
					console.log(`📥 Database already has ${entries.length} entries`);
					cleanup();
					resolve({ syncOccurred: true, entries });
				}
			})
			.catch(() => {
				// Ignore errors, wait for events
			});
	});
}

/**
 * Detect if a database is encrypted
 * Always returns false - databases are opened as unencrypted by default
 * Password can be added manually later if needed
 *
 * @param {Object} db - OrbitDB database instance
 * @param {Object} options - Detection options (ignored)
 * @returns {Promise<boolean>} Always returns false
 */
export async function detectDatabaseEncryption(db, options = {}) {
	if (!db) {
		console.warn('⚠️ detectDatabaseEncryption: No database provided');
		return false;
	}

	// Always return false - open as unencrypted by default
	// Password can be added manually later if needed
	return false;
}
