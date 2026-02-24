import { writable, get } from 'svelte/store';

import { createLibp2p } from 'libp2p';
import { createHelia } from 'helia';
import {
	createOrbitDB,
	OrbitDBAccessController,
	MemoryStorage,
	Identities,
	useIdentityProvider
} from '@orbitdb/core';
import SimpleEncryption from '@le-space/orbitdb-simple-encryption';
import { createLibp2pConfig } from './libp2p-config.js';
// Dynamic import to avoid circular dependency with db-actions.js
// import { initializeDatabase } from './db-actions.js';
import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';
import { systemToasts, showToast } from './toast-store.js';
import { currentIdentityStore, peerIdStore } from './stores.js';
import { isWebAuthnAvailable, hasExistingCredentials } from './identity/webauthn-identity.js';
import {
	getOrCreateVarsigIdentity,
	createWebAuthnVarsigIdentities,
	createIpfsIdentityStorage,
	wrapWithVarsigVerification
} from './identity/varsig-identity.js';
import {
	OrbitDBWebAuthnIdentityProviderFunction,
	loadWebAuthnCredential,
	loadWebAuthnVarsigCredential,
	WebAuthnVarsigProvider
} from '@le-space/orbitdb-identity-provider-webauthn-did';

function describeEncryptionSecret(secret) {
	if (!secret) return 'NO';
	if (typeof secret === 'string') {
		return `YES (length: ${secret.length}, first 3 chars: ${secret.substring(0, 3)}***)`;
	}
	if (secret?.subarray) {
		return `YES (bytes: ${secret.length})`;
	}
	return 'YES';
}

// Export libp2p instance for plugins
export const libp2pStore = writable(null);
// Remove this line - don't re-export peerIdStore
// export { peerIdStore };

// Export OrbitDB instance for backup/restore operations
export const orbitDBStore = writable(null);

// Add initialization state store
export const initializationStore = writable({
	isInitializing: false,
	isInitialized: false,
	error: null
});

let libp2p = null;
let helia = null;
let orbitdb = null;

let peerId = null;
let todoDB = null;
// currentIdentity moved to stores.js to break circular dependency
// let currentIdentity = null;

/**
 * Build standard database options for OrbitDB
 * @param {string} identityId - The identity ID that should have write access
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether encryption is enabled
 * @param {Object|null} encryption - Encryption configuration (if enabled)
 * @param {boolean} create - Whether to create the database if it doesn't exist
 * @returns {Object} Database options for orbitdb.open()
 */
function buildDatabaseOptions(
	identityId,
	preferences = {},
	enableEncryption = false,
	encryption = null,
	create = false
) {
	const { enableNetworkConnection = true } = preferences;

	// Set up access controller - allow the specified identity to write
	const accessController = OrbitDBAccessController({
		write: [identityId]
	});

	const baseOptions = {
		type: 'keyvalue',
		create: create,
		sync: enableNetworkConnection,
		AccessController: accessController
	};

	// Add encryption if enabled
	if (enableEncryption && encryption) {
		baseOptions.encryption = encryption;
	}

	return baseOptions;
}

/**
 * Open or create a todo list database
 * @param {string} todoListName - Name of the todo list (default: 'projects')
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether to enable encryption
 * @param {string} encryptionPassword - Password for encryption (required if enableEncryption is true)
 * @returns {Promise<Object>} The opened database
 */
export async function openTodoList(
	todoListName = 'projects',
	preferences = {},
	enableEncryption = false,
	encryptionPassword = null
) {
	if (!orbitdb) {
		throw new Error('OrbitDB instance not initialized. Please initialize P2P first.');
	}

	let identity = get(currentIdentityStore);
	if (!identity) {
		identity = orbitdb.identity;
		currentIdentityStore.set(identity);
	}

	// Create database name: identityId + "_" + todoListName
	const identityId = identity.id;
	const dbName = `${identityId}_${todoListName}`;
	console.log(`📂 Opening todo list database: ${dbName} (display name: ${todoListName})`);

	// Close existing database if open
	if (todoDB) {
		console.log('🔒 Closing existing database...');
		await todoDB.close();
		todoDB = null;
	}

	const {
		enablePersistentStorage = true,
		enableNetworkConnection = true,
		// eslint-disable-next-line no-unused-vars
		enablePeerConnections: _enablePeerConnections = true
	} = preferences;

	// Set up encryption if enabled
	let encryption = null;
	if (enableEncryption && encryptionPassword) {
		console.log('🔐 Setting up encryption for database...');
		const dataEncryption = await SimpleEncryption({ password: encryptionPassword });
		encryption = { data: dataEncryption };
	}

	// Build standard database options using shared function
	const dbOptions = buildDatabaseOptions(
		identityId,
		preferences,
		enableEncryption,
		encryption,
		true
	);

	// Open the database
	if (!enablePersistentStorage && !enableNetworkConnection) {
		// In-memory storage only
		const headsStorage = await MemoryStorage();
		const entryStorage = await MemoryStorage();
		todoDB = await orbitdb.open(dbName, {
			...dbOptions,
			headsStorage,
			entryStorage
		});
	} else {
		todoDB = await orbitdb.open(dbName, dbOptions);
	}

	// Try to read entries, but handle decryption errors gracefully
	// This can happen after migration if old entries are still in cache
	let entryCount = 0;
	try {
		entryCount = (await todoDB.all()).length;
		console.log('🔍 TodoDB records:', entryCount);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (errorMessage.includes('decrypt')) {
			console.warn(
				'⚠️ Could not read entries immediately after opening (decryption error):',
				errorMessage
			);
			console.warn('   This may happen after migration - entries will be loaded after sync');
			entryCount = 0;
		} else {
			throw error; // Re-throw if it's not a decryption error
		}
	}
	console.log('✅ Database opened successfully:', todoDB);

	// Initialize database stores and actions (dynamic import to avoid circular dependency)
	const { initializeDatabase } = await import('./db-actions.js');
	await initializeDatabase(orbitdb, todoDB, preferences);

	return todoDB;
}

/**
 * Open a database by its full database name (identityId_displayName)
 * @param {string} dbName - The full database name (e.g., "c852aa330a611daf24dd8f039d5990f96a4a498f5_orbitdb-storacha-bridge")
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether to enable encryption
 * @param {string} encryptionPassword - Password for encryption (required if enableEncryption is true)
 * @returns {Promise<Object>} The opened database
 */
export async function openDatabaseByName(
	dbName,
	preferences = {},
	enableEncryption = false,
	encryptionPassword = null
) {
	if (!orbitdb) {
		throw new Error('OrbitDB instance not initialized. Please initialize P2P first.');
	}

	let identity = get(currentIdentityStore);
	if (!identity) {
		identity = orbitdb.identity;
		currentIdentityStore.set(identity);
	}

	const currentInstanceIdentity = identity?.id || orbitdb.identity?.id;
	console.log(`📂 Opening database by name: ${dbName}`);
	console.log('🔑 Current OrbitDB instance identity:', currentInstanceIdentity);

	// Extract identity from dbName (part before first underscore)
	let dbNameIdentity = null;
	if (dbName && dbName.includes('_')) {
		const underscoreIndex = dbName.indexOf('_');
		if (underscoreIndex > 0) {
			dbNameIdentity = dbName.substring(0, underscoreIndex);
		}
	}

	const isOurIdentity = dbNameIdentity === currentInstanceIdentity;
	console.log('🔧 Database identity (from name):', dbNameIdentity);
	console.log('🔧 Is our identity?', isOurIdentity);

	// Close existing database if open
	if (todoDB) {
		console.log('🔒 Closing existing database...');
		await todoDB.close();
		todoDB = null;
	}

	// If it's NOT our identity, use the same standard options but with the other identity's ID
	// This ensures we calculate the correct address that matches how Browser A created it
	if (!isOurIdentity && dbNameIdentity) {
		console.log(
			'🔧 Opening database from different identity - using standard options with their identity ID'
		);

		try {
			// Set up encryption if enabled (though unlikely for other user's databases)
			let encryption = null;
			if (enableEncryption && encryptionPassword) {
				console.log('🔐 Setting up encryption for database...');
				const dataEncryption = await SimpleEncryption({ password: encryptionPassword });
				encryption = { data: dataEncryption };
			}

			// Build standard database options using the OTHER identity's ID
			// This ensures we use the same AccessController configuration that Browser A used
			const dbOptions = buildDatabaseOptions(
				dbNameIdentity,
				preferences,
				enableEncryption,
				encryption,
				false
			);

			// Open with the same standard options - this will calculate the correct address
			todoDB = await orbitdb.open(dbName, dbOptions);

			console.log('🔍 TodoDB records:', (await todoDB.all()).length);
			console.log('✅ Database opened successfully by name:', todoDB);
			console.log('🔧 Database address after open:', todoDB.address);
			console.log('🔧 Database name:', todoDB.name);

			// Initialize database stores and actions (dynamic import to avoid circular dependency)
			const { initializeDatabase } = await import('./db-actions.js');
			await initializeDatabase(orbitdb, todoDB, preferences);

			return todoDB;
		} catch (error) {
			console.error('❌ Error opening database by name (different identity):', error);
			throw error;
		}
	}

	// If it's our identity, use standard options with our own identity ID
	const {
		enablePersistentStorage = true,
		enableNetworkConnection = true,
		// eslint-disable-next-line no-unused-vars
		enablePeerConnections: _enablePeerConnections = true
	} = preferences;

	// Set up encryption if enabled
	let encryption = null;
	if (enableEncryption && encryptionPassword) {
		console.log('🔐 Setting up encryption for database...');
		const dataEncryption = await SimpleEncryption({ password: encryptionPassword });
		encryption = { data: dataEncryption };
	}

	// Build standard database options using shared function
	const dbOptions = buildDatabaseOptions(
		currentInstanceIdentity,
		preferences,
		enableEncryption,
		encryption,
		false
	);

	// Try to open the database by name (our identity)
	try {
		if (!enablePersistentStorage && !enableNetworkConnection) {
			// In-memory storage only
			const headsStorage = await MemoryStorage();
			const entryStorage = await MemoryStorage();
			todoDB = await orbitdb.open(dbName, {
				...dbOptions,
				headsStorage,
				entryStorage,
				sync: false // Override sync for in-memory
			});
		} else {
			todoDB = await orbitdb.open(dbName, dbOptions);
		}

		// Try to read entries, but handle decryption errors gracefully
		// This can happen after migration if old entries are still in cache
		let entryCount = 0;
		try {
			entryCount = (await todoDB.all()).length;
			console.log('🔍 TodoDB records:', entryCount);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.includes('decrypt')) {
				console.warn(
					'⚠️ Could not read entries immediately after opening (decryption error):',
					errorMessage
				);
				console.warn('   This may happen after migration - entries will be loaded after sync');
				entryCount = 0;
			} else {
				throw error; // Re-throw if it's not a decryption error
			}
		}
		console.log('✅ Database opened successfully by name:', todoDB);

		// Initialize database stores and actions (dynamic import to avoid circular dependency)
		const { initializeDatabase } = await import('./db-actions.js');
		await initializeDatabase(orbitdb, todoDB, preferences);

		return todoDB;
	} catch (error) {
		console.error('❌ Error opening database by name:', error);
		throw error;
	}
}

/**
 * Open a database by its address (hash)
 * @param {string} dbAddress - The database address/hash (e.g., "031d947594b8d02f69041280fd5bdd6ff6a07ec3130e075b86893179c543e3e305_simpletodo")
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether to enable encryption
 * @param {string} encryptionPassword - Password for encryption (required if enableEncryption is true)
 * @returns {Promise<Object>} The opened database
 */
export async function openDatabaseByAddress(
	dbAddress,
	preferences = {},
	enableEncryption = false,
	encryptionPassword = null
) {
	if (!orbitdb) {
		throw new Error('OrbitDB instance not initialized. Please initialize P2P first.');
	}

	// Initialize currentIdentity only if it doesn't exist
	let identity = get(currentIdentityStore);
	if (!identity) {
		identity = orbitdb.identity;
		currentIdentityStore.set(identity);
	}

	// Close existing database if open
	if (todoDB) {
		console.log('🔒 Closing existing database...');
		await todoDB.close();
		todoDB = null;
	}

	// Extract preferences
	const {
		enableNetworkConnection = true,
		// eslint-disable-next-line no-unused-vars
		enablePeerConnections: _enablePeerConnections = true
	} = preferences;

	// Set up encryption if enabled
	let encryption = null;
	if (enableEncryption && encryptionPassword) {
		console.log('🔐 Setting up encryption for database...');
		console.log(`  → Password provided: ${describeEncryptionSecret(encryptionPassword)}`);
		const dataEncryption = await SimpleEncryption({ password: encryptionPassword });
		encryption = {
			data: dataEncryption
		};

		console.log(`  → Encryption instances created successfully`);
	} else if (enableEncryption && !encryptionPassword) {
		console.warn('⚠️ Encryption enabled but no password provided!');
	}

	// Open database with sync enabled so it can discover peers via pubsub
	// Note: sync is a runtime option, not stored in manifest, so we must pass it explicitly
	console.log('⏳ Opening database by address...');
	console.log(`  → Address: ${dbAddress}`);
	console.log(`  → Encryption enabled: ${enableEncryption}`);
	console.log(`  → Password provided: ${describeEncryptionSecret(encryptionPassword)}`);
	const dbOptions = {
		sync: enableNetworkConnection
	};

	// Add encryption if enabled
	if (encryption) {
		dbOptions.encryption = encryption;
		console.log(`  → Encryption added to dbOptions`);
	}

	todoDB = await orbitdb.open(dbAddress, dbOptions);
	console.log(`  → Database opened, address: ${todoDB.address}`);
	console.log(`  → Address match: ${dbAddress === todoDB.address ? 'YES ✅' : 'NO ❌'}`);

	// Log database sync state to debug
	console.log('🔍 Database sync state:', {
		address: todoDB.address,
		name: todoDB.name,
		opened: todoDB.opened,
		sync: todoDB.sync,
		peers: todoDB.peers?.length || 0,
		encryption: encryption ? 'enabled' : 'disabled'
	});

	// Try to read entries, but handle decryption errors gracefully
	// This can happen after migration if old entries are still in cache
	let entryCount = 0;
	try {
		entryCount = (await todoDB.all()).length;
		console.log(`✅ Database opened successfully (${entryCount} entries)`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (errorMessage.includes('decrypt')) {
			console.warn(
				'⚠️ Could not read entries immediately after opening (decryption error):',
				errorMessage
			);
			console.warn('   This may happen after migration - entries will be loaded after sync');
			console.log(`✅ Database opened successfully (entries will load after sync)`);
		} else {
			throw error; // Re-throw if it's not a decryption error
		}
	}

	// Initialize database stores and actions (dynamic import to avoid circular dependency)
	const { initializeDatabase } = await import('./db-actions.js');
	await initializeDatabase(orbitdb, todoDB, preferences);

	return todoDB;
}

/**
 * Get the current identity ID
 * @returns {string|null} The identity ID or null if not initialized
 */
// getCurrentIdentityId moved to stores.js to break circular dependency
// Remove the re-export - import directly from stores.js instead
// export { getCurrentIdentityId } from './stores.js';

/**
 * Initialize the P2P network after user consent
 * This function should be called only after the user has accepted the consent modal
 * @param {Object} preferences - Network preferences from user consent
 * @param {boolean} preferences.enablePersistentStorage - Whether to enable persistent storage
 * @param {boolean} preferences.enableNetworkConnection - Whether to enable network connection
 * @param {boolean} preferences.enablePeerConnections - Whether to enable direct peer connections
 * @param {boolean} preferences.skipDefaultDatabase - Whether to skip opening the default 'projects' database (e.g., when opening from URL hash)
 */
export async function initializeP2P(preferences = {}) {
	const {
		enablePersistentStorage = true,
		enableNetworkConnection = true,
		enablePeerConnections = true,
		skipDefaultDatabase = false
	} = preferences;

	console.log('🚀 Starting P2P initialization after user consent...', {
		enablePersistentStorage,
		enableNetworkConnection,
		enablePeerConnections
	});

	try {
		// Set initialization state
		initializationStore.set({ isInitializing: true, isInitialized: false, error: null });

		// Create libp2p configuration and node with network and peer connection preferences
		const config = await createLibp2pConfig({
			enablePeerConnections,
			enableNetworkConnection
		});

		libp2p = await createLibp2p(config);
		libp2pStore.set(libp2p); // Make available to plugins

		// Expose to window for e2e testing
		if (typeof window !== 'undefined') {
			window.__libp2p__ = libp2p;
		}

		console.log(
			`✅ libp2p node created with network connection: ${enableNetworkConnection ? 'enabled' : 'disabled'}, peer connections: ${enablePeerConnections ? 'enabled' : 'disabled'}`
		);

		// Add pubsub event listeners to debug OrbitDB subscriptions
		if (libp2p.services.pubsub) {
			// Listen for subscription changes (when OrbitDB subscribes/unsubscribes to topics)
			libp2p.services.pubsub.addEventListener('subscription-change', (event) => {
				const { peerId, subscriptions } = event.detail;
				subscriptions.forEach((sub) => {
					if (sub.topic.startsWith('/orbitdb/')) {
						console.log(
							`📡 Pubsub subscription ${sub.subscribe ? 'SUBSCRIBED' : 'UNSUBSCRIBED'}:`,
							{
								topic: sub.topic,
								peerId: peerId?.toString().slice(0, 12) + '...',
								isLocal: !peerId // undefined peerId means it's our own subscription
							}
						);
					}
				});
			});

			// Listen for pubsub messages (when OrbitDB publishes/receives messages)
			libp2p.services.pubsub.addEventListener('message', (event) => {
				const message = event.detail;
				if (message.topic && message.topic.startsWith('/orbitdb/')) {
					console.log('💬 OrbitDB pubsub message:', {
						topic: message.topic,
						from: message.from?.toString().slice(0, 12) + '...',
						dataLength: message.data?.length,
						isLocal: !message.from // undefined from means it's our own message
					});
				}
			});
		}

		// Auto-dial discovered peers
		libp2p.addEventListener('peer:discovery', (event) => {
			const { id: peerId, multiaddrs } = event.detail || {};
			if (!peerId || !multiaddrs) return;

			// Filter for dialable addresses (webrtc, webtransport, websocket)
			const dialableAddrs = multiaddrs.filter((addr) => {
				const addrStr = addr.toString();
				return (
					addrStr.includes('/webrtc') ||
					addrStr.includes('/webtransport') ||
					addrStr.includes('/ws')
				);
			});

			if (dialableAddrs.length === 0) return;

			const peerIdShort = peerId.toString().slice(0, 12) + '...';
			console.log('🔍 Peer discovered with dialable addresses:', {
				peerId: peerIdShort,
				addresses: dialableAddrs.map((a) => a.toString())
			});

			// Check if we already have a direct connection
			const existingConnections = libp2p.getConnections(peerId);
			const hasDirectConnection = existingConnections?.some((conn) => {
				const addr = conn.remoteAddr?.toString() || '';
				return !addr.includes('/p2p-circuit');
			});

			if (hasDirectConnection) {
				console.log('✅ Already have direct connection to:', peerIdShort);
				return;
			}

			// Auto-dial if peer connections are enabled (fire-and-forget)
			if (enablePeerConnections) {
				console.log('🔗 Auto-dialing peer:', peerIdShort);
				// Don't await - let dial happen in background
				// Dial by peerId to let libp2p route through relay and upgrade to direct
				libp2p
					.dial(peerId)
					.then(() => {
						console.log('✅ Successfully dialed peer:', peerIdShort);
					})
					.catch((error) => {
						console.warn('⚠️ Failed to dial peer:', peerIdShort, error.message);
					});
			}
		});

		libp2p.addEventListener('peer:connect', (event) => {
			const connection = event.detail?.connection || event.detail;
			if (connection?.remoteAddr) {
				const addrStr = connection.remoteAddr.toString();
				if (addrStr.includes('/webrtc')) {
					console.log('🌐 WebRTC: Direct WebRTC connection established!', {
						peerId: connection.remotePeer?.toString().slice(0, 12) + '...',
						address: addrStr
					});
				}
			}
		});

		libp2p.addEventListener('connection:open', (event) => {
			const connection = event.detail;
			if (connection?.remoteAddr) {
				const addrStr = connection.remoteAddr.toString();
				if (addrStr.includes('/webrtc')) {
					console.log('🌐 WebRTC: Connection opened via WebRTC', {
						peerId: connection.remotePeer?.toString().slice(0, 12) + '...',
						address: addrStr,
						connectionId: connection.id
					});
				}
			}
		});

		// Show toast notification for libp2p creation
		systemToasts.showLibp2pCreated();

		// Get and set peer ID
		peerId = libp2p.peerId.toString();
		console.log(`✅ peerId is ${peerId}`);
		peerIdStore.set(peerId);

		// Create Helia (IPFS) instance with mobile-aware storage handling
		let heliaConfig = { libp2p };
		let actuallyUsePersistentStorage = enablePersistentStorage;

		if (enablePersistentStorage) {
			try {
				console.log('🗄️ Initializing Helia with persistent storage (LevelDB)...');
				const rawBlockstore = new LevelBlockstore('./helia-blocks');
				const blockstore = rawBlockstore;
				// console.log('[p2p.js] Raw blockstore created, wrapping with adapter...');
				// Wrap blockstore with adapter to ensure Uint8Array compatibility
				// const blockstore = createBlockstoreAdapter(rawBlockstore);
				// console.log('[p2p.js] Blockstore adapter created, type:', typeof blockstore, 'has get:', typeof blockstore.get === 'function');
				const datastore = new LevelDatastore('./helia-data');
				heliaConfig = { libp2p, blockstore, datastore };
				console.log('[p2p.js] Helia config prepared with adapted blockstore');

				// Show toast for persistent storage
				systemToasts.showStoragePersistent();
			} catch (levelError) {
				console.warn(
					'⚠️ LevelDB initialization failed, falling back to in-memory storage:',
					levelError
				);
				actuallyUsePersistentStorage = false;

				// Show toast for storage test failure
				systemToasts.showStorageTestFailed();
			}
		}

		if (!actuallyUsePersistentStorage) {
			console.log('💾 Initializing Helia with in-memory storage...');
			// heliaConfig already has just { libp2p }, which defaults to in-memory storage

			// Show toast for in-memory storage (only if not already shown above)
			if (!enablePersistentStorage) {
				systemToasts.showStorageMemory();
			}
		}

		helia = await createHelia(heliaConfig);
		console.log(
			`✅ Helia created with ${actuallyUsePersistentStorage ? 'persistent' : 'in-memory'} storage`
		);

		// Wrap Helia's blockstore with adapter after creation
		// Helia might wrap our blockstore, so we need to wrap it again
		if (helia.blockstore) {
			console.log('🔧 WRAPPING HELIA BLOCKSTORE');
			console.log('🔧 Helia blockstore constructor:', helia.blockstore?.constructor?.name);
			console.log('🔧 Helia blockstore has get:', typeof helia.blockstore?.get === 'function');
			const originalBlockstore = helia.blockstore;
			// helia.blockstore = createBlockstoreAdapter(originalBlockstore);
			helia.blockstore = originalBlockstore;
			console.log('🔧 Helia blockstore wrapped successfully');
		} else {
			console.log('⚠️ WARNING: Helia has no blockstore property!');
		}

		// Show toast for Helia creation
		systemToasts.showHeliaCreated();

		// Create OrbitDB instance
		console.log('🛬 Creating OrbitDB instance...');

		// Try to use WebAuthn identity if available and enabled
		let webauthnCredential = null;
		let varsigCredential = null;
		let useVarsig = false;
		const useWebAuthn = preferences.useWebAuthn !== false; // Default to true

		if (useWebAuthn && isWebAuthnAvailable() && hasExistingCredentials()) {
			try {
				if (WebAuthnVarsigProvider.isSupported()) {
					console.log('🔐 Loading WebAuthn varsig credential...');
					varsigCredential = loadWebAuthnVarsigCredential();
					if (varsigCredential) {
						useVarsig = true;
						console.log('✅ WebAuthn varsig credential loaded successfully');
						showToast('🔐 Using hardware-secured identity (varsig)', 'success', 3000);
					}
				}

				if (!useVarsig) {
					console.log('🔐 Loading WebAuthn keystore credential...');
					webauthnCredential = loadWebAuthnCredential();
					if (webauthnCredential) {
						console.log('✅ WebAuthn credential loaded successfully');
						showToast('🔐 Using WebAuthn-encrypted keystore', 'success', 3000);
					}
				}
			} catch (error) {
				console.warn('⚠️ Failed to load WebAuthn credential, falling back to default:', error);
				showToast('⚠️ WebAuthn load failed, using software identity', 'warning', 3000);
			}
		}

		let orbitdbCreated = false;

		// Create OrbitDB with WebAuthn varsig identity if available
		if (useVarsig && varsigCredential) {
			try {
				const identity = await getOrCreateVarsigIdentity(varsigCredential);
				const identityStorage = createIpfsIdentityStorage(helia);
				const identities = createWebAuthnVarsigIdentities(identity, {}, identityStorage);

				console.log('🔍 Created WebAuthn varsig identity:', {
					id: identity.id,
					type: identity.type,
					hash: identity.hash
				});

				orbitdb = await createOrbitDB({
					ipfs: helia,
					identities,
					identity,
					id: 'simple-todo-app',
					directory: './orbitdb'
				});

				const orbitdbIdentity = orbitdb?.identity;
				console.log('🔍 OrbitDB identity after varsig init:', {
					id: orbitdbIdentity?.id,
					type: orbitdbIdentity?.type,
					expectedId: identity.id,
					expectedType: identity.type
				});
				if (typeof identity.id === 'string' && !identity.id.startsWith('did:key:')) {
					throw new Error(`Varsig identity id is not did:key (got "${identity.id}")`);
				}
				if (
					!orbitdbIdentity ||
					orbitdbIdentity.type !== 'webauthn-varsig' ||
					orbitdbIdentity.id !== identity.id
				) {
					throw new Error('Varsig identity was not applied to OrbitDB (identity mismatch).');
				}

				orbitdbCreated = true;
				showToast('✅ Authenticated with hardware-secured identity (varsig)', 'success', 3000);
			} catch (error) {
				console.error('❌ Failed to create OrbitDB with varsig identity:', error);
				showToast(
					'❌ Varsig identity required but not applied. Initialization stopped.',
					'error',
					5000
				);
				throw error;
			}
		}

		// Create OrbitDB with WebAuthn keystore identity if available
		if (!orbitdbCreated && !useVarsig && webauthnCredential) {
			try {
				// Register WebAuthn provider
				useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction);

				// Create identities instance with varsig verification support
				const baseIdentities = await Identities({ ipfs: helia });
				const identities = wrapWithVarsigVerification(baseIdentities, helia);

				// Create WebAuthn identity
				const identity = await identities.createIdentity({
					provider: OrbitDBWebAuthnIdentityProviderFunction({
						webauthnCredential,
						useKeystoreDID: true,
						keystore: identities.keystore,
						keystoreKeyType: 'Ed25519',
						encryptKeystore: true,
						keystoreEncryptionMethod: 'prf'
					})
				});

				console.log('🔍 Created WebAuthn identity:', {
					id: identity.id,
					type: identity.type,
					hash: identity.hash
				});

				// Create OrbitDB with WebAuthn identity
				orbitdb = await createOrbitDB({
					ipfs: helia,
					identities,
					identity,
					id: 'simple-todo-app',
					directory: './orbitdb'
				});

				orbitdbCreated = true;
				showToast('✅ Authenticated with WebAuthn-encrypted keystore', 'success', 3000);
			} catch (error) {
				console.error('❌ Failed to create OrbitDB with WebAuthn identity:', error);
				showToast('⚠️ WebAuthn failed, using software identity', 'warning', 3000);

				// Fall back to default identity with varsig verification support
				const fallbackIdentities = wrapWithVarsigVerification(
					await Identities({ ipfs: helia }),
					helia
				);
				orbitdb = await createOrbitDB({
					ipfs: helia,
					identities: fallbackIdentities,
					id: 'simple-todo-app',
					directory: './orbitdb'
				});
				orbitdbCreated = true;
			}
		} else if (!orbitdbCreated) {
			// Create OrbitDB with default identity + varsig verification support
			// This enables verifying entries from peers who use varsig identities
			const defaultIdentities = wrapWithVarsigVerification(
				await Identities({ ipfs: helia }),
				helia
			);
			orbitdb = await createOrbitDB({
				ipfs: helia,
				identities: defaultIdentities,
				id: 'simple-todo-app',
				directory: './orbitdb'
			});
			orbitdbCreated = true;
		}

		// Show toast for OrbitDB creation
		systemToasts.showOrbitDBCreated();

		// Make OrbitDB instance available to other components
		orbitDBStore.set(orbitdb);

		// Get the identity from OrbitDB instance and store it
		const identity = orbitdb.identity;
		currentIdentityStore.set(identity);
		console.log('🔑 Current identity:', identity.id);

		// Initialize the registry database for this identity
		const identityId = identity?.id || null;
		const registryDbName = identityId; // Registry DB is just the identityId

		console.log('📋 Initializing registry database...');
		const accessController = OrbitDBAccessController({
			write: [identityId]
		});

		const registryDb = await orbitdb.open(registryDbName, {
			type: 'keyvalue',
			create: true,
			sync: true,
			AccessController: accessController
		});

		// Ensure 'projects' is in the registry (default todo list)
		const projectsEntry = await registryDb.get('projects');
		if (!projectsEntry) {
			await registryDb.put('projects', {
				displayName: 'projects',
				dbName: `${identityId}_projects`,
				parent: null,
				createdAt: new Date().toISOString()
			});
			console.log('✅ Added "projects" to registry');
		}

		// Close registry database (we'll reopen it when needed)
		await registryDb.close();
		console.log('✅ Registry database initialized');

		// Open default todo list 'projects' unless we're skipping it (e.g., when opening from URL hash)
		if (!skipDefaultDatabase) {
			await openTodoList('projects', preferences, null, null);
		} else {
			console.log('⏭️ Skipping default database open (will be opened from URL hash)');
		}

		// Mark initialization as complete
		initializationStore.set({ isInitializing: false, isInitialized: true, error: null });
		console.log('🎉 P2P initialization completed successfully!');
	} catch (error) {
		console.error('❌ Failed to initialize OrbitDB:', error);
		initializationStore.set({
			isInitializing: false,
			isInitialized: false,
			error: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}
