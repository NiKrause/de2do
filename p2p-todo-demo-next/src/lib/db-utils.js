// Key for storing known databases in localStorage
const STORAGE_KEY = 'simple-todo-known-databases';

/**
 * Get all known databases from localStorage
 * @returns {Array} Array of database objects with {name, address} structure
 */
export function getKnownDatabases() {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return [];
		
		const databases = JSON.parse(stored);
		return Array.isArray(databases) ? databases : [];
	} catch (error) {
		console.error('Error reading known databases from localStorage:', error);
		return [];
	}
}

/**
 * Add a new database to the known databases list
 * @param {string} name - Display name for the database
 * @param {string} address - Database address or identifier
 * @returns {boolean} Success status
 */
export function addKnownDatabase(name, address) {
	try {
		const databases = getKnownDatabases();
		
		// Check if database already exists (by address)
		const existing = databases.find(db => db.address === address);
		if (existing) {
			// Update name if different
			if (existing.name !== name) {
				existing.name = name;
				existing.updatedAt = new Date().toISOString();
				localStorage.setItem(STORAGE_KEY, JSON.stringify(databases));
			}
			return true;
		}
		
		// Add new database
		const newDatabase = {
			name: name.trim(),
			address: address.trim(),
			createdAt: new Date().toISOString(),
			lastUsed: new Date().toISOString()
		};
		
		databases.push(newDatabase);
		
		// Sort by lastUsed (most recent first)
		databases.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
		
		localStorage.setItem(STORAGE_KEY, JSON.stringify(databases));
		console.log('✅ Added database to known list:', newDatabase);
		return true;
	} catch (error) {
		console.error('Error adding database to localStorage:', error);
		return false;
	}
}

/**
 * Remove a database from the known databases list
 * @param {string} address - Database address to remove
 * @returns {boolean} Success status
 */
export function removeKnownDatabase(address) {
	try {
		const databases = getKnownDatabases();
		const filteredDatabases = databases.filter(db => db.address !== address);
		
		if (filteredDatabases.length === databases.length) {
			console.warn('Database not found in known list:', address);
			return false;
		}
		
		localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredDatabases));
		console.log('✅ Removed database from known list:', address);
		return true;
	} catch (error) {
		console.error('Error removing database from localStorage:', error);
		return false;
	}
}

/**
 * Update the last used timestamp for a database
 * @param {string} address - Database address
 * @returns {boolean} Success status
 */
export function updateDatabaseLastUsed(address) {
	try {
		const databases = getKnownDatabases();
		const database = databases.find(db => db.address === address);
		
		if (database) {
			database.lastUsed = new Date().toISOString();
			
			// Sort by lastUsed (most recent first)
			databases.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
			
			localStorage.setItem(STORAGE_KEY, JSON.stringify(databases));
			return true;
		}
		
		return false;
	} catch (error) {
		console.error('Error updating database last used:', error);
		return false;
	}
}

/**
 * Clear all known databases from localStorage
 * @returns {boolean} Success status
 */
export function clearKnownDatabases() {
	try {
		localStorage.removeItem(STORAGE_KEY);
		console.log('✅ Cleared all known databases');
		return true;
	} catch (error) {
		console.error('Error clearing known databases:', error);
		return false;
	}
}

/**
 * Get database info by address
 * @param {string} address - Database address
 * @returns {Object|null} Database object or null if not found
 */
export function getDatabaseByAddress(address) {
	const databases = getKnownDatabases();
	return databases.find(db => db.address === address) || null;
}

/**
 * Validate database address format
 * @param {string} address - Database address to validate
 * @returns {boolean} Whether the address appears to be valid
 */
export function validateDatabaseAddress(address) {
	if (!address || typeof address !== 'string') return false;
	
	const trimmedAddress = address.trim();
	if (trimmedAddress.length === 0) return false;
	
	// Basic validation - could be extended based on OrbitDB address format requirements
	// OrbitDB addresses can be simple names or full addresses like /orbitdb/zdpuB1...
	return true;
}

// Make functions available for browser console debugging
if (typeof window !== 'undefined') {
	window.dbUtils = {
		getKnownDatabases,
		addKnownDatabase,
		removeKnownDatabase,
		updateDatabaseLastUsed,
		clearKnownDatabases,
		getDatabaseByAddress,
		validateDatabaseAddress
	};
	console.log('🔧 Database utilities available at window.dbUtils');
}
