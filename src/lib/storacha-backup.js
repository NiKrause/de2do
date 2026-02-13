/**
 * Simple Todo OrbitDB Storacha Backup Integration
 *
 * Uses the orbitdb-storacha-bridge library from npm
 */

import { listStorachaSpaceFiles, OrbitDBStorachaBridge } from 'orbitdb-storacha-bridge';

// Note: These are equivalent:
// 1. restoreDatabaseFromSpace(orbitdb, options) - Direct function call
// 2. new OrbitDBStorachaBridge().restoreFromSpace(orbitdb, options) - Class method
// Both call the exact same underlying implementation
import * as Client from '@storacha/client';
import { StoreMemory } from '@storacha/client/stores/memory';
import { Signer } from '@storacha/client/principal/ed25519';
import * as Proof from '@storacha/client/proof';
import * as Delegation from '@ucanto/core/delegation';
import { get } from 'svelte/store';
import { todoDBStore } from './db-actions.js';
// Import orbitDBStore from p2p.js for consistency with the rest of the codebase
import { orbitDBStore } from './p2p.js';

/**
 * Initialize Storacha client with credentials
 */
export async function initializeStorachaClient(storachaKey, storachaProof) {
	try {
		console.log('🔐 Initializing Storacha client with provided credentials...');

		const principal = Signer.parse(storachaKey);
		const store = new StoreMemory();
		const client = await Client.create({ principal, store });

		console.log('✅ Client created with principal:', principal.did());

		const proof = await Proof.parse(storachaProof);
		console.log('✅ Proof parsed successfully');

		const space = await client.addSpace(proof);
		console.log('✅ Space added:', space.did());

		await client.setCurrentSpace(space.did());
		console.log('✅ Current space set');

		return client;
	} catch (error) {
		console.error('❌ Failed to initialize Storacha client:', error);
		throw error;
	}
}

/**
 * Initialize Storacha client with UCAN delegation
 */
export async function initializeStorachaClientWithUCAN(ucanToken, recipientKey) {
	try {
		console.log('🔐 Initializing Storacha client with UCAN...');

		// Parse recipient identity from JSON archive
		const recipientKeyData = JSON.parse(recipientKey);
		const fixedArchive = {
			id: recipientKeyData.id,
			keys: {
				[recipientKeyData.id]: new Uint8Array(
					Object.values(recipientKeyData.keys[recipientKeyData.id])
				)
			}
		};

		const recipientPrincipal = Signer.from(fixedArchive);
		const store = new StoreMemory();
		const client = await Client.create({
			principal: recipientPrincipal,
			store
		});

		// Parse delegation token
		const delegationBytes = Buffer.from(ucanToken, 'base64');
		const delegation = await Delegation.extract(delegationBytes);

		if (!delegation.ok) {
			throw new Error('Failed to extract delegation from token');
		}

		// Add space using delegation
		const space = await client.addSpace(delegation.ok);
		await client.setCurrentSpace(space.did());

		console.log(`✅ Storacha client initialized with UCAN space: ${space.did()}`);
		return client;
	} catch (error) {
		console.error('❌ Failed to initialize Storacha client with UCAN:', error);
		throw error;
	}
}

/**
 * List spaces for authenticated client
 */
export async function listSpaces(client) {
	try {
		console.log('📋 Listing available spaces...');

		// Check if client has a current space (which means it was initialized with credentials)
		const currentSpace = client.currentSpace();
		if (currentSpace) {
			console.log('✅ Using current space from credentials:', currentSpace.did());

			// Handle different space object types - currentSpace might not have registered() method
			let registered = false;
			try {
				registered =
					typeof currentSpace.registered === 'function' ? currentSpace.registered() : false;
			} catch {
				console.log('🔍 currentSpace.registered() not available, defaulting to false');
				registered = false;
			}

			return [
				{
					did: currentSpace.did(),
					name: currentSpace.name || 'Current Space',
					registered: registered,
					current: true
				}
			];
		}

		// Otherwise try to get accounts (for email-based login)
		const accounts = client.accounts();
		if (accounts.length === 0) {
			console.warn('⚠️ No accounts found - this might be expected for credential-based login');
			return [];
		}

		// List spaces from first account
		const account = accounts[0];
		const spaces = [];
		for (const space of account.spaces()) {
			spaces.push({
				did: space.did(),
				name: space.name || 'Unnamed Space',
				registered: space.registered()
			});
		}

		console.log(`✅ Found ${spaces.length} spaces`);
		return spaces;
	} catch (error) {
		console.error('❌ Failed to list spaces:', error);
		throw error;
	}
}

/**
 * Create a new space
 */
export async function createSpace(client, spaceName) {
	try {
		console.log(`🌟 Creating new space: ${spaceName}`);

		const space = await client.createSpace(spaceName);
		console.log('✅ Space created:', space.did());

		return {
			success: true,
			space: {
				did: space.did(),
				name: spaceName,
				registered: space.registered()
			}
		};
	} catch (error) {
		console.error('❌ Failed to create space:', error);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Backup the current todo database using the working bridge
 */
export async function backupTodoDatabase(storachaKey, storachaProof) {
	console.log('🚀 Starting Todo Database Backup using orbitdb-storacha-bridge');

	try {
		const todoDB = get(todoDBStore);
		const orbitdb = get(orbitDBStore);

		if (!todoDB) {
			throw new Error('No todo database available');
		}

		if (!orbitdb) {
			throw new Error('No OrbitDB instance available');
		}

			console.log(`📍 Database: ${todoDB.address}`);

			// Create bridge instance for progress tracking
			const bridge = new OrbitDBStorachaBridge({
				storachaKey,
				storachaProof
			});

		// Use the bridge backup method for progress tracking
		const backupResult = await bridge.backup(orbitdb, todoDB.address, {
			timeout: 60000
		});

		if (backupResult.success) {
			console.log('🎉 Backup completed successfully!');

			return {
				success: true,
				manifestCID: backupResult.manifestCID,
				databaseAddress: backupResult.databaseAddress,
				databaseName: backupResult.databaseName,
				blocksTotal: backupResult.blocksTotal,
				blocksUploaded: backupResult.blocksUploaded,
				blockSummary: backupResult.blockSummary,
				cidMappings: backupResult.cidMappings,
				timestamp: new Date().toISOString(),
				usingWorkingBridge: true
			};
		} else {
			throw new Error(backupResult.error);
		}
	} catch (error) {
		console.error('❌ Backup failed:', error.message);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Restore database using the working bridge mapping-independent approach
 */
export async function restoreFromStorachaSpace(storachaKey, storachaProof) {
	console.log('🔄 Starting Todo Database Restore using orbitdb-storacha-bridge');
	console.log('🚀 Using MAPPING-INDEPENDENT restore from space');

	try {
		const orbitdb = get(orbitDBStore);

		if (!orbitdb) {
			throw new Error('No OrbitDB instance available');
			}

			// Create bridge instance for progress tracking
			const bridge = new OrbitDBStorachaBridge({
				storachaKey,
				storachaProof
			});

		// Use the bridge restore method with working options (like Miles&Smiles)
		const restoreResult = await bridge.restoreFromSpace(orbitdb, {
			timeout: 120000, // 2 minutes timeout (like Miles&Smiles)
			preferredDatabaseName: 'simple-todos', // Specific database name
			restartAfterRestore: true, // Restart after restore
			verifyIntegrity: true // Verify integrity
			// No forceFallback: false - let fallback be enabled!
		});

		if (restoreResult.success) {
			console.log('🎉 Restore completed successfully!');
			console.log(`📊 Entries recovered: ${restoreResult.entriesRecovered}`);
			console.log(`📍 Database address: ${restoreResult.address}`);

			return {
				success: true,
				database: restoreResult.database,
				manifestCID: restoreResult.manifestCID,
				databaseAddress: restoreResult.address,
				databaseName: restoreResult.name,
				entriesRecovered: restoreResult.entriesRecovered,
				blocksRestored: restoreResult.blocksRestored,
				addressMatch: restoreResult.addressMatch,
				entries: restoreResult.entries,
				spaceFilesFound: restoreResult.spaceFilesFound,
				analysis: restoreResult.analysis,
				usingWorkingBridge: true
			};
		} else {
			throw new Error(restoreResult.error);
		}
	} catch (error) {
		console.error('❌ Restore failed:', error.message);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * List files in Storacha space using the working bridge
 */
export async function listStorachaFiles(storachaKey, storachaProof) {
	try {
		console.log('📋 Listing files in Storacha space using bridge...');

		const spaceFiles = await listStorachaSpaceFiles({
			storachaKey,
			storachaProof,
			size: 1000
		});

		console.log(`✅ Found ${spaceFiles.length} files`);

		return spaceFiles;
	} catch (error) {
		console.error('❌ Failed to list space files:', error);
		throw error;
	}
}

/**
 * Restore from backup - alias for restoreFromStorachaSpace to maintain API compatibility
 * This function is used by the UI component to restore from a specific backup CID
 */
export async function restoreFromBackup(client, backupCID, orbitDBInstance) {
	console.log('🔄 restoreFromBackup called - using simplified space restore approach');
	console.log(`📍 Backup CID requested: ${backupCID}`);
	console.log(`📍 OrbitDB instance: ${orbitDBInstance?.address || 'not provided'}`);

	// Get the stored credentials from the client for the restore
	const storedCredentials = loadCredentialsForRestore();
	if (!storedCredentials) {
		throw new Error('No stored credentials available for restore');
	}

	return await restoreFromStorachaSpace(storedCredentials.key, storedCredentials.proof);
}

/**
 * Helper function to get stored credentials for restore operations
 */
function loadCredentialsForRestore() {
	try {
		const key = localStorage.getItem('storacha_key');
		const proof = localStorage.getItem('storacha_proof');

		if (key && proof) {
			return { key, proof };
		}
	} catch (err) {
		console.warn('Failed to load credentials for restore:', err);
	}
	return null;
}

/**
 * Download backup metadata from IPFS using CID
 */
export async function downloadBackupMetadata(cid) {
	try {
		console.log(`�� Downloading backup metadata from IPFS: ${cid}`);

		const response = await fetch(`https://w3s.link/ipfs/${cid}`);
		if (!response.ok) {
			throw new Error(`Failed to fetch backup metadata: ${response.statusText}`);
		}

		const metadata = await response.json();
		console.log('✅ Backup metadata downloaded successfully');
		return metadata;
	} catch (error) {
		console.error('❌ Failed to download backup metadata:', error);
		throw error;
	}
}

/**
 * Get space usage information with optional detailed analysis
 */
export async function getSpaceUsage(client, detailed = false) {
	try {
		console.log('📊 Getting space usage information...');

		const result = await client.capability.upload.list({ size: 1000 });
		const uploads = result.results || [];

		if (uploads.length === 0) {
			return {
				totalFiles: 0,
				lastUploadDate: null,
				oldestUploadDate: null,
				uploads: [],
				backupFiles: 0,
				blockFiles: 0,
				otherFiles: 0,
				analyzed: false
			};
		}

		// Sort by date to find oldest and newest
		const sortedUploads = uploads.sort((a, b) => new Date(b.insertedAt) - new Date(a.insertedAt));

		const lastUploadDate = sortedUploads[0].insertedAt;
		const oldestUploadDate = sortedUploads[sortedUploads.length - 1].insertedAt;

		let backupFiles = 0;
		let blockFiles = 0;
		let otherFiles = 0;
		const processedUploads = [];

		if (detailed && uploads.length <= 50) {
			// Only do detailed analysis for smaller numbers of files to avoid performance issues
			console.log('🔍 Performing detailed file type analysis...');

			// Analyze up to first 20 files to get a sample
			const samplesToAnalyze = uploads.slice(0, 20);

			for (const upload of samplesToAnalyze) {
				const cid = upload.root.toString();
				let fileType = 'block'; // Default assumption

				try {
					// Quick check - try to fetch first few bytes
					const response = await fetch(`https://w3s.link/ipfs/${cid}`, {
						headers: { Range: 'bytes=0-512' }, // Smaller range
						signal: AbortSignal.timeout(3000) // 3 second timeout
					});

					if (response.ok) {
						const text = await response.text();

						// Check if it looks like JSON backup metadata
						if (
							text.trim().startsWith('{') &&
							(text.includes('backupVersion') || text.includes('simple-todo'))
						) {
							fileType = 'backup';
						}
					}
				} catch {
					// Keep default 'block' type
				}

				if (fileType === 'backup') backupFiles++;
				else if (fileType === 'block') blockFiles++;
				else otherFiles++;

				processedUploads.push({
					cid,
					uploadedAt: upload.insertedAt,
					size: upload.size || null,
					type: fileType
				});
			}

			// For remaining files, just estimate based on patterns
			const remaining = uploads.length - samplesToAnalyze.length;
			if (remaining > 0) {
				// Assume remaining files are mostly blocks since backups are rare
				blockFiles += remaining;

				// Add remaining files without detailed analysis
				for (let i = samplesToAnalyze.length; i < uploads.length; i++) {
					const upload = uploads[i];
					processedUploads.push({
						cid: upload.root.toString(),
						uploadedAt: upload.insertedAt,
						size: upload.size || null,
						type: 'block'
					});
				}
			}

			console.log(
				`✅ Analyzed ${uploads.length} files: ${backupFiles} backups, ${blockFiles} blocks, ${otherFiles} other`
			);
		} else {
			// Fast mode: just return basic info without detailed analysis
			blockFiles = uploads.length; // Assume most are blocks
			backupFiles = 0; // We'll estimate this is very small
			otherFiles = 0;

			for (const upload of uploads) {
				processedUploads.push({
					cid: upload.root.toString(),
					uploadedAt: upload.insertedAt,
					size: upload.size || null,
					type: 'unknown'
				});
			}

			console.log(`✅ Space contains ${uploads.length} files (fast mode)`);
		}

		return {
			totalFiles: uploads.length,
			lastUploadDate,
			oldestUploadDate,
			uploads: processedUploads,
			backupFiles,
			blockFiles,
			otherFiles,
			analyzed: detailed && uploads.length <= 50
		};
	} catch (error) {
		console.error('❌ Failed to get space usage:', error);
		throw error;
	}
}

/**
 * List all backup metadata files in the current space (simplified)
 */
export async function listBackups(client) {
	try {
		console.log('📋 Listing backups in current space...');

		const result = await client.capability.upload.list({ size: 1000 });
		const backups = [];

		// Filter for backup metadata files by trying to download and parse them
		for (const upload of result.results) {
			const cid = upload.root.toString();
			try {
				// Try to download as JSON to see if it's a backup metadata file
				const response = await fetch(`https://w3s.link/ipfs/${cid}`);
				if (response.ok) {
					const data = await response.json();
					if (data.backupVersion && data.databaseInfo && data.appInfo?.name === 'simple-todo') {
						backups.push({
							cid,
							timestamp: data.timestamp,
							databaseName: data.databaseInfo.name,
							manifestCID: data.databaseInfo.manifestCID,
							blockCount: Object.values(data.blockSummary || {}).reduce((a, b) => a + b, 0),
							uploaded: upload.insertedAt
						});
					}
				}
			} catch {
				// Not a backup metadata file, skip
				continue;
			}
		}

		// Sort by timestamp descending
		backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

		console.log(`✅ Found ${backups.length} backup(s)`);
		return backups;
	} catch (error) {
		console.error('❌ Failed to list backups:', error);
		return [];
	}
}
