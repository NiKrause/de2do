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
 * Detect if a database is encrypted using the official isDatabaseEncrypted function
 * from @le-space/orbitdb-simple-encryption
 *
 * This is the single source of truth for encryption detection across the app.
 *
 * @param {Object} db - OrbitDB database instance
 * @param {Object} options - Detection options
 * @param {boolean} options.isRemoteAccess - Whether this is remote access (URL, address-based)
 * @returns {Promise<boolean>} True if database is encrypted, false otherwise
 */
export async function detectDatabaseEncryption(db, options = {}) {
	const { isRemoteAccess = false } = options;

	if (!db) {
		console.warn('⚠️ detectDatabaseEncryption: No database provided');
		return false;
	}

	try {
		console.log('🔍 Checking if database is encrypted:', {
			address: db.address,
			isRemoteAccess
		});

		// Get current entries to check state
		let entries = await db.all();
		console.log(`📊 Database has ${entries.length} entries initially`);

		// Special case: Empty database accessed remotely
		// When opening a database by address/URL that has 0 entries, we need to wait
		// for sync before determining encryption status. The database might be:
		// 1. Actually empty (unencrypted)
		// 2. Encrypted and not synced yet
		// 3. Unencrypted but not synced yet
		if (entries.length === 0 && isRemoteAccess) {
			console.log('⏳ Empty database accessed remotely - waiting for sync before encryption detection...');
			
			// Check peer count to determine wait time
			const peerCount = db.peers?.length || 0;
			const hasPeers = peerCount > 0;
			const waitTime = hasPeers ? 15000 : 5000; // Wait longer if peers are connected
			
			console.log(`   → Peers connected: ${peerCount}, wait time: ${waitTime}ms`);
			
			// Wait for sync events
			const { syncOccurred, entries: syncedEntries } = await waitForDatabaseSync(db, waitTime);
			
			if (syncOccurred && syncedEntries.length > 0) {
				entries = syncedEntries;
				console.log(`📊 After sync event: ${entries.length} entries`);
				
				// Check if entries have undefined values (encryption indicator)
				const hasUndefinedValues = entries.some((e) => e.value === undefined);
				if (hasUndefinedValues) {
					console.log('🔐 Database is encrypted - entries have undefined values');
					return true;
				}
				// Entries have values, fall through to normal detection below
			} else if (syncOccurred) {
				// Sync occurred but no entries - could still be empty or not yet replicated
				entries = syncedEntries;
				console.log(`📊 Sync occurred but no entries received`);
			} else {
				console.log('   → No sync event occurred within timeout');
			}
			
			// If still empty after waiting for sync, check isDatabaseEncrypted()
			// to determine if it's actually encrypted or just empty
			if (entries.length === 0) {
				console.log('   → Still empty after sync wait - checking isDatabaseEncrypted()...');
				console.log('   → Database state:', {
					address: db.address,
					name: db.name,
					opened: db.opened,
					sync: db.sync,
					peers: peerCount,
					hasEncryptionOption: !!db.options?.encryption
				});
				
				const isEncrypted = await isDatabaseEncrypted(db);
				console.log(`   → isDatabaseEncrypted() returned: ${isEncrypted}`);

				if (isEncrypted) {
					console.log('🔐 Database is encrypted (confirmed by isDatabaseEncrypted)');
					return true;
				} else {
					console.log('✅ Database is not encrypted (just empty)');
					return false;
				}
			}
			// If entries arrived, fall through to normal detection logic below
		}

		// Use official isDatabaseEncrypted check
		const isEncrypted = await isDatabaseEncrypted(db);

		// Double-check: even if isDatabaseEncrypted says false, verify values
		// If we have entries with undefined values, the database IS encrypted
		if (!isEncrypted && entries.length > 0) {
			const hasUndefinedValues = entries.some((e) => e.value === undefined);
			if (hasUndefinedValues) {
				console.warn('⚠️ Override: entries have undefined values - database IS encrypted!');
				return true;
			}
		}

		if (isEncrypted) {
			console.log('🔐 Database is encrypted');
		} else {
			console.log('✅ Database is not encrypted');
		}

		return isEncrypted;
	} catch (err) {
		console.error('❌ Error detecting database encryption:', err);
		// If we can't determine encryption status, assume it might be encrypted
		// This is safer than assuming unencrypted
		console.warn('⚠️ Assuming database might be encrypted due to detection error');
		return true;
	}
}
