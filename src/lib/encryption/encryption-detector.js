import { isDatabaseEncrypted } from '@le-space/orbitdb-simple-encryption';

/**
 * Detect if a database is encrypted using the official isDatabaseEncrypted function
 * from @le-space/orbitdb-simple-encryption
 * 
 * This is the single source of truth for encryption detection across the app.
 * 
 * @param {Object} db - OrbitDB database instance
 * @returns {Promise<boolean>} True if database is encrypted, false otherwise
 */
export async function detectDatabaseEncryption(db) {
	if (!db) {
		console.warn('⚠️ detectDatabaseEncryption: No database provided');
		return false;
	}

	try {
		console.log('🔍 Checking if database is encrypted:', db.address);
		
		const isEncrypted = await isDatabaseEncrypted(db);
		
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
