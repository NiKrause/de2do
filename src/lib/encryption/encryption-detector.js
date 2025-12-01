import { isDatabaseEncrypted } from '@le-space/orbitdb-simple-encryption';

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
		const entries = await db.all();
		console.log(`📊 Database has ${entries.length} entries`);
		
		// Special case: Empty database accessed remotely
		// When opening a database by address/URL that has 0 entries, we cannot
		// determine if it's encrypted or just empty. For security, assume encrypted
		// when accessed remotely (not created locally).
		if (entries.length === 0 && isRemoteAccess) {
			console.log('🔐 Empty database accessed remotely - treating as potentially encrypted');
			console.log('⚠️ Will prompt for password to be safe (database might be encrypted and not synced yet)');
			return true;
		}
		
		// Use official isDatabaseEncrypted check
		const isEncrypted = await isDatabaseEncrypted(db);
		
		// Double-check: even if isDatabaseEncrypted says false, verify values
		if (!isEncrypted && entries.length > 0) {
			const hasUndefinedValues = entries.some(e => e.value === undefined);
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
