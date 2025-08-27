import { writable } from 'svelte/store';

import { createLibp2p } from 'libp2p';
import { createHelia } from 'helia';
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core';
import { createLibp2pConfig } from './libp2p-config.js';
import { initializeDatabase, currentDbAddressStore } from './db-actions.js';

// Export libp2p instance for plugins
export const libp2pStore = writable(null);
export const peerIdStore = writable(null);

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

/**
 * Initialize the P2P network after user consent
 * This function should be called only after the user has accepted the consent modal
 */
export async function initializeP2P() {
	console.log('🚀 Starting P2P initialization after user consent...');

	try {
		// Set initialization state
		initializationStore.set({ isInitializing: true, isInitialized: false, error: null });

		// Create libp2p configuration and node
		const config = await createLibp2pConfig();
		libp2p = await createLibp2p(config);
		libp2pStore.set(libp2p); // Make available to plugins
		console.log(`✅ libp2p node created`);

		// Get and set peer ID
		peerId = libp2p.peerId.toString();
		console.log(`✅ peerId is ${peerId}`);
		peerIdStore.set(peerId);

		// Create Helia (IPFS) instance
		helia = await createHelia({ libp2p });
		console.log(`✅ Helia created`);

		// Create OrbitDB instance
		console.log('🛬 Creating OrbitDB instance...');
		orbitdb = await createOrbitDB({ ipfs: helia, id: 'simple-todo-app' });
		todoDB = await orbitdb.open('simple-todos', {
			type: 'keyvalue', //Stores data as key-value pairs supports basic operations: put(), get(), delete()
			create: true, // Allows the database to be created if it doesn't exist
			sync: true, // Enables automatic synchronization with other peers
			AccessController: IPFSAccessController({ write: ['*'] }) //defines who can write to the database, ["*"] is a wildcard that allows all peers to write to the database, This creates a fully collaborative environment where any peer can add/edit TODOs
		});

		console.log('✅ Database opened successfully with OrbitDBAccessController:', {
			address: todoDB.address,
			type: todoDB.type,
			accessController: todoDB.access
		});

	// Initialize database stores and actions
	await initializeDatabase(orbitdb, todoDB);
	
	// Set current database address
	currentDbAddressStore.set('simple-todos');

		// Mark initialization as complete
		initializationStore.set({ isInitializing: false, isInitialized: true, error: null });
		console.log('🎉 P2P initialization completed successfully!');
	} catch (error) {
		console.error('❌ Failed to initialize P2P:', error);
		initializationStore.set({
			isInitializing: false,
			isInitialized: false,
			error: error.message
		});
		throw error;
	}
}
