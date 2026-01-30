import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';
import { join } from 'path';
import { loadOrCreateSelfKey } from '@libp2p/config';
import { privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { fromString as uint8ArrayFromString, toString as uint8ArrayToString } from 'uint8arrays';
import { Key } from 'interface-datastore';
// import { createBlockstoreAdapter } from './blockstore-adapter.js';

/**
 * Initialize persistent storage for the relay
 * @param {string} hostDirectory - Directory to store data
 * @param {boolean} isDevMode - Whether running in development mode
 * @param {string} fixedPrivateKey - Fixed private key for dev mode (optional)
 * @returns {Object} Storage components { datastore, blockstore, privateKey }
 */
export async function initializeStorage(hostDirectory, isDevMode = false, fixedPrivateKey = null) {
	console.log('🗄️ Initializing storage...', { hostDirectory, isDevMode });

	// Create datastore
	const datastore = new LevelDatastore(join(hostDirectory, 'data'));
	await datastore.open();
	console.log('✅ Datastore initialized');

	// Create blockstore
	const rawBlockstore = new LevelBlockstore(join(hostDirectory, 'blocks'));
	await rawBlockstore.open();
	const blockstore = rawBlockstore;
	// Wrap blockstore with adapter to ensure Uint8Array compatibility
	// const blockstore = createBlockstoreAdapter(rawBlockstore);
	// console.log('✅ Blockstore initialized');

	let privateKey;

	// Always use fixed private key if provided (not just in dev mode)
	// This is especially important for CI environments where crypto.randomBytes might not work correctly
	if (fixedPrivateKey) {
		// Use fixed private key
		console.log('🔑 Using fixed private key');
		try {
			privateKey = privateKeyFromProtobuf(uint8ArrayFromString(fixedPrivateKey, 'hex'));
			console.log('✅ Fixed private key loaded successfully');
		} catch (error) {
			console.warn(
				'⚠️ Failed to load fixed private key, falling back to generated key:',
				error.message
			);

			// Check if a key already exists in the datastore
			const keyExistsKey = new Key('/self/key');
			let keyExists = false;
			try {
				await datastore.get(keyExistsKey);
				keyExists = true;
			} catch {
				// Key doesn't exist, will be created
				keyExists = false;
			}

			try {
				privateKey = await loadOrCreateSelfKey(datastore);

				// If key didn't exist before, it was just created - print it
				if (!keyExists) {
					try {
						// Convert private key object directly to protobuf bytes, then to hex
						const privateKeyBytes = privateKeyToProtobuf(privateKey);
						const privateKeyHex = uint8ArrayToString(privateKeyBytes, 'hex');

						console.log('\n' + '='.repeat(80));
						console.log('🔑 NEW PRIVATE KEY GENERATED (fallback from invalid RELAY_PRIV_KEY)');
						console.log('='.repeat(80));
						console.log('Add this to your .env file:');
						console.log(`RELAY_PRIV_KEY=${privateKeyHex}`);
						console.log('='.repeat(80) + '\n');
					} catch (printError) {
						console.warn('⚠️ Failed to print private key:', printError.message);
						// Debug: log what the privateKey object actually is
						console.log('Private key type:', typeof privateKey);
						console.log('Private key keys:', Object.keys(privateKey || {}));
					}
				}
			} catch (genError) {
				console.error('❌ Failed to generate private key:', genError);
				throw new Error(
					`Failed to load or generate private key. Please provide a valid RELAY_PRIV_KEY environment variable. Error: ${genError.message}`
				);
			}
		}
	} else {
		// Load or create persistent private key
		console.log('🔑 Loading or creating persistent private key...');

		// Check if a key already exists in the datastore
		// loadOrCreateSelfKey stores the key under '/self/key'
		const keyExistsKey = new Key('/self/key');
		let keyExists = false;
		try {
			await datastore.get(keyExistsKey);
			keyExists = true;
		} catch {
			// Key doesn't exist, will be created
			keyExists = false;
		}

		try {
			privateKey = await loadOrCreateSelfKey(datastore);

			// If key didn't exist before, it was just created - print it
			if (!keyExists) {
				try {
					// Convert private key object directly to protobuf bytes, then to hex
					const privateKeyBytes = privateKeyToProtobuf(privateKey);
					const privateKeyHex = uint8ArrayToString(privateKeyBytes, 'hex');

					console.log('\n' + '='.repeat(80));
					console.log('🔑 NEW PRIVATE KEY GENERATED');
					console.log('='.repeat(80));
					console.log('Add this to your .env file:');
					console.log(`RELAY_PRIV_KEY=${privateKeyHex}`);
					console.log('='.repeat(80) + '\n');
				} catch (printError) {
					console.warn('⚠️ Failed to print private key:', printError.message);
					// Debug: log what the privateKey object actually is
					console.log('Private key type:', typeof privateKey);
					console.log('Private key keys:', Object.keys(privateKey || {}));
				}
			}

			console.log('✅ Private key loaded/created successfully');
		} catch (error) {
			console.error('❌ Failed to load or create private key:', error);
			throw new Error(
				`Failed to load or create private key. This may be due to crypto.randomBytes not working correctly in this environment. Please provide a RELAY_PRIV_KEY environment variable. Error: ${error.message}`
			);
		}
	}

	return { datastore, blockstore, privateKey };
}

/**
 * Close all storage components gracefully
 * @param {Object} storage - Storage components to close
 */
export async function closeStorage(storage) {
	console.log('🔄 Closing storage components...');

	try {
		if (storage.datastore) {
			await storage.datastore.close();
			console.log('✅ Datastore closed');
		}

		if (storage.blockstore) {
			await storage.blockstore.close();
			console.log('✅ Blockstore closed');
		}
	} catch (error) {
		console.error('❌ Error closing storage:', error);
		throw error;
	}

	console.log('✅ Storage closed successfully');
}
