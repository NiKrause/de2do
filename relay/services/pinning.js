import { createOrbitDB, useIdentityProvider } from "@orbitdb/core";
import OrbitDBIdentityProviderDID from "@orbitdb/identity-provider-did";
import * as KeyDIDResolver from "key-did-resolver";
import { createHelia } from 'helia';
import { CID } from 'multiformats/cid';
import PQueue from 'p-queue';
// import { createBlockstoreAdapter } from './blockstore-adapter.js';

export class PinningService {
	constructor(options = {}) {
		this.allowedIdentities = new Set();
		this.pinnedDatabases = new Map(); // Map of dbAddress -> { db, metadata }
		this.syncQueue = new PQueue({ concurrency: 2 });
		this.updateTimers = new Map(); // Debouncing timers for update events
		this.processedCIDs = new Map(); // Map of dbAddress -> Set of processed CIDs to avoid duplicates
		this.activeSyncs = new Set(); // Track databases currently being synced to prevent concurrent syncs
		this.queuedSyncs = new Set(); // Track databases queued for sync to prevent duplicate queue entries
		this.metrics = {
			totalPinned: 0,
			syncOperations: 0,
			failedSyncs: 0
		};

		// Logging configuration
		this.logLevel = options.logLevel || 'debug'; // 'debug', 'info', 'warn', 'error'
		this.verboseLogging = options.verboseLogging || false;

		// Load allowed identities from environment
		this.loadAllowedIdentities();

		this.log('📌 PinningService initialized', 'info');
		if (this.allowedIdentities.size > 0) {
			this.log(`   - Allowed identities: ${this.allowedIdentities.size}`, 'info');
		}
	}

	/**
	 * Load allowed identity IDs from environment variables
	 */
	loadAllowedIdentities() {
		const envValue = process.env.PINNING_ALLOWED_IDENTITIES;

		if (envValue) {
			// Single pass processing: split, trim, filter, and add to Set
			const identities = envValue.split(',').reduce((acc, id) => {
				const trimmed = id.trim();
				if (trimmed) {
					acc.push(trimmed);
				}
				return acc;
			}, []);

			identities.forEach((id) => this.allowedIdentities.add(id));
			this.log(
				`📋 Loaded ${identities.length} identities from PINNING_ALLOWED_IDENTITIES`,
				'debug'
			);
		}

		// If no specific pinning identities are configured, warn the user
		if (this.allowedIdentities.size === 0) {
			this.log('⚠️  No identity filters configured. All OrbitDB databases will be pinned!', 'warn');
			this.log('   Set PINNING_ALLOWED_IDENTITIES in .env to filter by identity IDs', 'warn');
		}
	}

	/**
	 * Initialize the pinning service with libp2p and IPFS
	 */
	async initialize(libp2p, datastore, blockstore) {
		this.libp2p = libp2p;

		// Create Helia (IPFS) instance
		this.helia = await createHelia({
			libp2p,
			datastore,
			blockstore
		});

		// Wrap Helia's blockstore with adapter after creation
		// Helia might wrap our blockstore, so we need to wrap it again
		// if (this.helia.blockstore) {
		// 	this.log('🔧 Wrapping Helia blockstore with adapter', 'debug');
		// 	const originalBlockstore = this.helia.blockstore;
		// 	this.helia.blockstore = createBlockstoreAdapter(originalBlockstore);
		// 	this.log('🔧 Helia blockstore wrapped successfully', 'debug');
		// } else {
		// 	this.log('⚠️  WARNING: Helia has no blockstore property!', 'warn');
		// }
		// Create OrbitDB instance with access controllers registered
		// Register DID provider so we can verify entries from did:key identities (writers).
		OrbitDBIdentityProviderDID.setDIDResolver(KeyDIDResolver.getResolver());
		useIdentityProvider(OrbitDBIdentityProviderDID);

		this.orbitdb = await createOrbitDB({
			ipfs: this.helia
		});

		this.log('✅ PinningService initialized with OrbitDB', 'info');
	}

	/**
	 * Check if a database identity should be pinned
	 */
	shouldPinDatabase(identityId) {
		// If no filters configured, pin everything (with warning)
		if (this.allowedIdentities.size === 0) {
			return true;
		}

		return this.allowedIdentities.has(identityId);
	}

	/**
	 * Enhanced record counting for OrbitDB 3.0
	 */
	async getRecordCount(db) {
		try {
			const dbType = this.getDatabaseType(db);
			this.log(`🔍 Counting records for ${db.name}`, 'debug');

			// For events databases, use iterator approach
			if (dbType === 'events' && typeof db.iterator === 'function') {
				try {
					let count = 0;
					const iterator = db.iterator();
					// eslint-disable-next-line no-unused-vars
					for await (const _ of iterator) {
						count++;
						// Limit to prevent infinite loops
						if (count > 10000) {
							this.log(`⚠️  Reached count limit of 10000 for ${db.name}`, 'warn');
							break;
						}
					}
					this.log(`📊 ${db.name}: ${count} entries`, 'debug');
					return count;
				} catch {
					this.log(`⚠️  Iterator failed for ${db.name}, trying all() method`, 'debug');
				}
			}

			// Try the all() method as fallback or for other database types
			const records = await db.all();

			// Handle different return types from all()
			if (Array.isArray(records)) {
				this.log(`📊 ${db.name}: ${records.length} items`, 'debug');
				return records.length;
			} else if (records && typeof records === 'object') {
				// For key-value stores or object-based returns
				const keyCount = Object.keys(records).length;
				this.log(`📊 ${db.name}: ${keyCount} keys`, 'debug');
				return keyCount;
			} else if (records === null || records === undefined) {
				this.log(`📊 ${db.name}: empty`, 'debug');
				return 0;
			} else {
				// Check if it's an iterator or has Symbol.iterator
				if (records && typeof records[Symbol.iterator] === 'function') {
					try {
						let count = 0;
						// eslint-disable-next-line no-unused-vars
						for (const _ of records) {
							count++;
							if (count > 10000) break; // Safety limit
						}
						this.log(`📊 ${db.name}: ${count} items`, 'debug');
						return count;
					} catch {
						this.log(`⚠️  Failed to iterate over records for ${db.name}`, 'debug');
					}
				}

				this.log(`⚠️  Unexpected records structure for ${db.name}: ${typeof records}`, 'debug');
				return 0;
			}
		} catch (error) {
			this.log(`❌ Error counting records for ${db.name}: ${error.message}`, 'error');
			return 0;
		}
	}

	/**
	 * Enhanced database type detection for OrbitDB 3.0
	 */
	getDatabaseType(db) {
		try {
			// Check multiple properties to determine type
			if (db.type) {
				return db.type;
			}
			return 'unknown';
		} catch (error) {
			this.log(`❌ Error detecting database type for ${db.name}: ${error.message}`, 'error');
			return 'unknown';
		}
	}

	/**
	 * Get full identity information
	 */
	getIdentityInfo(db) {
		try {
			const identity = db.identity;
			if (!identity) {
				return { id: null, fullId: null, publicKey: null, type: null };
			}

			return {
				id: identity.id,
				fullId: identity.id, // Full ID without truncation
				publicKey: identity.publicKey ? identity.publicKey.toString() : null,
				type: identity.type || 'unknown',
				hash: identity.hash || null
			};
		} catch (error) {
			this.log(`❌ Error extracting identity info: ${error.message}`, 'error');
			return { id: null, fullId: null, publicKey: null, type: null };
		}
	}

	/**
	 * Wait for database to be ready and potentially for peers to join
	 */
	async waitForDatabaseReady(db, timeoutMs = 3000) {
		const startTime = Date.now();
		const dbType = this.getDatabaseType(db);

		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				this.log(`⏰ Timeout waiting for database ${db.name} to be ready`, 'debug');
				resolve(false); // Don't reject, just indicate it's not ready
			}, timeoutMs);

			// For keyvalue databases that are already opened, they might be ready immediately
			if (dbType === 'keyvalue' && db.opened) {
				this.log(`📋 Keyvalue database ${db.name} is already opened`, 'debug');
				// Give a short grace period for potential peer connections
				setTimeout(() => {
					if (db.peers?.length > 0) {
						this.log(`✅ Database ${db.name} found peers: ${db.peers.length}`, 'debug');
						clearTimeout(timeout);
						resolve(true);
					} else {
						this.log(`🔄 Database ${db.name} has no peers but is opened - proceeding`, 'debug');
						clearTimeout(timeout);
						resolve(true);
					}
				}, 500); // 500ms grace period
				return;
			}

			// If database already has peers, resolve immediately
			if (db.peers?.length > 0) {
				this.log(`✅ Database ${db.name} already has ${db.peers.length} peers`, 'debug');
				clearTimeout(timeout);
				resolve(true);
				return;
			}

			let hasResolved = false;

			// Listen for update events (might indicate activity)
			const onUpdate = () => {
				if (hasResolved) return;
				hasResolved = true;
				const elapsed = Date.now() - startTime;
				this.log(`📝 Database ${db.name} update after ${elapsed}ms`, 'debug');
				db.events.off('update', onUpdate);
				db.events.off('join', onJoin);
				clearTimeout(timeout);
				resolve(true);
			};

			// Listen for peer joins
			const onJoin = (peer) => {
				if (hasResolved) return;
				hasResolved = true;
				const elapsed = Date.now() - startTime;
				const peerStr = typeof peer === 'string' ? peer : peer?.toString() || 'unknown';
				this.log(
					`👤 Peer joined ${db.name} after ${elapsed}ms: ${peerStr.slice(0, 8)}...`,
					'debug'
				);

				db.events.off('update', onUpdate);
				db.events.off('join', onJoin);
				clearTimeout(timeout);
				resolve(true);
			};

			db.events.on('update', onUpdate);
			db.events.on('join', onJoin);
		});
	}

	/**
	 * Sync and pin an OrbitDB database
	 */
	async syncAndPinDatabase(dbAddress) {
		// Check if this database is already being synced
		if (this.activeSyncs.has(dbAddress)) {
			this.log(
				`⏸️  Database ${dbAddress} is already being synced, skipping duplicate sync`,
				'debug'
			);
			return;
		}

		// Check if database is already open and pinned
		if (this.pinnedDatabases.has(dbAddress)) {
			const existing = this.pinnedDatabases.get(dbAddress);
			if (existing.db) {
				// Check if database is still open
				try {
					if (existing.db.opened) {
						this.log(
							`✅ Database ${dbAddress} is already open and pinned, updating metadata`,
							'debug'
						);
						try {
							// Update metadata without reopening
							const recordCount = await this.getRecordCount(existing.db);
							existing.metadata.recordCount = recordCount;
							existing.metadata.lastSynced = new Date().toISOString();
							existing.metadata.syncCount = (existing.metadata.syncCount || 0) + 1;
							this.metrics.syncOperations++;
							return existing.metadata;
						} catch (error) {
							this.log(`⚠️  Error updating existing database metadata: ${error.message}`, 'warn');
							// Continue to full sync if update fails
						}
					} else {
						this.log(`🔄 Database ${dbAddress} exists but is closed, will reopen`, 'debug');
						// Remove closed database from map so we can reopen it
						this.pinnedDatabases.delete(dbAddress);
					}
				} catch (error) {
					this.log(`⚠️  Error checking database state: ${error.message}, will reopen`, 'warn');
					// Remove potentially corrupted entry
					this.pinnedDatabases.delete(dbAddress);
				}
			}
		}

		this.log(`🔄 Starting sync for database: ${dbAddress}`, 'info');
		this.metrics.syncOperations++;
		this.activeSyncs.add(dbAddress);

		try {
			// Open the database with proper access controller configuration
			// Wrap in try-catch to handle gossipsub publish errors gracefully
			let db;
			try {
				db = await this.orbitdb.open(dbAddress);
			} catch (openError) {
				// Check if it's a PublishError - this can happen when OrbitDB tries to publish but no peers are subscribed
				const isPublishErr =
					openError &&
					((openError.message &&
						openError.message.includes('PublishError.NoPeersSubscribedToTopic')) ||
						(openError.message && openError.message.includes('NoPeersSubscribedToTopic')) ||
						openError.name === 'PublishError');
				if (isPublishErr) {
					this.log(
						`⚠️  Gossipsub publish error during database open (no peers subscribed - this is normal): ${dbAddress}`,
						'warn'
					);
					// Retry opening - the error might be transient
					try {
						db = await this.orbitdb.open(dbAddress);
					} catch (retryError) {
						// If retry also fails, check if it's still the publish error
						const isRetryPublishErr =
							retryError &&
							((retryError.message &&
								retryError.message.includes('PublishError.NoPeersSubscribedToTopic')) ||
								(retryError.message && retryError.message.includes('NoPeersSubscribedToTopic')) ||
								retryError.name === 'PublishError');
						if (isRetryPublishErr) {
							this.log(
								`⚠️  Gossipsub publish error persists, but continuing anyway: ${dbAddress}`,
								'warn'
							);
							// Try one more time with a small delay
							await new Promise((resolve) => setTimeout(resolve, 100));
							db = await this.orbitdb.open(dbAddress);
						} else {
							throw retryError;
						}
					}
				} else {
					throw openError;
				}
			}

			this.log(`📂 Database opened: ${db.name}`, 'debug');

			// Get basic database information first
			const identityInfo = this.getIdentityInfo(db);
			const dbType = this.getDatabaseType(db);

			// Enhanced identity logging with full ID
			if (!identityInfo.id) {
				this.log(`⚠️  Database ${db.name} has no identity ID, skipping`, 'warn');
				await db.close();
				return;
			}

			if (!this.shouldPinDatabase(identityInfo.id)) {
				this.log(
					`🚫 Database ${db.name} identity ${identityInfo.id.slice(0, 8)}... not in allowed list, skipping`,
					'debug'
				);
				await db.close();
				return;
			}

			// Wait for database to be ready and for potential peer joins
			this.log(`⏳ Waiting for database ${db.name} to be ready...`, 'debug');
			const isReady = await this.waitForDatabaseReady(db, 3000);

			if (isReady) {
				this.log(`✅ Database ${db.name} is ready`, 'debug');
			} else {
				this.log(`⚠️  Database ${db.name} readiness timeout, but proceeding`, 'debug');
			}

			// Now count records after waiting for readiness
			const recordCount = await this.getRecordCount(db);

			await this.processExistingCIDs(db, dbAddress);

			// Create enhanced database metadata
			const metadata = {
				name: db.name,
				type: dbType,
				address: dbAddress,
				identityId: identityInfo.id,
				fullIdentityId: identityInfo.fullId,
				identityType: identityInfo.type,
				publicKey: identityInfo.publicKey,
				recordCount,
				lastSynced: new Date().toISOString(),
				syncCount: 1,
				opened: db.opened || false,
				writable: db.access?.write || false
			};

			// Store database reference and metadata
			if (this.pinnedDatabases.has(dbAddress)) {
				const existing = this.pinnedDatabases.get(dbAddress);
				metadata.syncCount = (existing.metadata?.syncCount || 0) + 1;
				// Close previous instance if it exists
				if (existing.db && existing.db !== db) {
					try {
						await existing.db.close();
					} catch (error) {
						this.log(`⚠️  Error closing previous database instance: ${error.message}`, 'warn');
					}
				}
			} else {
				this.metrics.totalPinned++;
			}

			this.pinnedDatabases.set(dbAddress, { db, metadata });

			// Set up event listeners for future updates
			this.setupDatabaseListeners(db, dbAddress, metadata);

			// Enhanced logging with full information
			this.log(`✅ Pinned database: ${db.name}`, 'info');
			this.log(`   - Identity: ${identityInfo.id.slice(0, 8)}...`, 'debug');
			this.log(`   - Records: ${recordCount}`, 'debug');
			this.log(`   - Type: ${dbType}`, 'debug');
			this.log(`   - Sync count: ${metadata.syncCount}`, 'debug');

			return metadata;
		} catch (error) {
			// Check if it's a PublishError - this is not a fatal error, just means no peers are subscribed
			const isPublishErr =
				error &&
				((error.message && error.message.includes('PublishError.NoPeersSubscribedToTopic')) ||
					(error.message && error.message.includes('NoPeersSubscribedToTopic')) ||
					error.name === 'PublishError');
			if (isPublishErr) {
				this.log(
					`⚠️  Gossipsub publish error during sync (no peers subscribed - this is normal): ${dbAddress}`,
					'warn'
				);
				// Don't count this as a failed sync, it's just a warning
				// Return null or empty metadata to indicate partial success
				return null;
			}

			this.metrics.failedSyncs++;
			this.log(`❌ Error syncing database ${dbAddress}: ${error.message}`, 'error');
			throw error;
		} finally {
			// Always remove from active syncs, even if there was an error
			this.activeSyncs.delete(dbAddress);
		}
	}

	/**
	 * Process existing CIDs in a database during initial sync
	 * Only extracts CIDs from OrbitDB log entries (automatically pinned)
	 * Without Storacha backup functionality
	 */
	async processExistingCIDs(db, dbAddress) {
		console.log(`🔍 processExistingCIDs called with: ${db.name}`);
		try {
			this.log(`🔍 Processing existing CIDs for ${db.name}...`, 'debug');
			const processedCIDs = new Set();

			// Extract CIDs from OrbitDB log entries
			this.log(`📄 Extracting CIDs from OrbitDB log entries for ${db.name}...`, 'debug');

			try {
				// Use the log iterator to get all entries
				if (typeof db.log?.iterator === 'function') {
					const iterator = db.log.iterator();
					let logEntryCount = 0;

					for await (const entry of iterator) {
						logEntryCount++;

						// Each OrbitDB log entry has a hash (CID) that's automatically pinned in IPFS
						if (entry.hash && typeof entry.hash === 'string') {
							if (!processedCIDs.has(entry.hash)) {
								try {
									this.log(`📌 Pinning OrbitDB log entry CID: ${entry.hash}`, 'info');
									await this.helia.pins.add(CID.parse(entry.hash));
									processedCIDs.add(entry.hash);
								} catch (cidError) {
									this.log(
										`❌ Error pinning log entry CID ${entry.hash}: ${cidError.message}`,
										'error'
									);
								}
							} else {
								this.log(`🔄 Log entry CID ${entry.hash} already processed, skipping`, 'debug');
							}
						}
					}

					this.log(`📊 Processed ${logEntryCount} log entries for ${db.name}`, 'debug');
				} else {
					this.log(
						`⚠️ No log iterator available for ${db.name}, skipping log entry CID extraction`,
						'warn'
					);
				}
			} catch (logError) {
				this.log(`❌ Error processing log entries for ${db.name}: ${logError.message}`, 'error');
			}

			// Store the processed CIDs
			this.processedCIDs.set(dbAddress, processedCIDs);
			this.log(`✅ Processed ${processedCIDs.size} total CIDs for ${db.name}`, 'info');
		} catch (error) {
			this.log(`❌ Error processing existing CIDs for ${db.name}: ${error.message}`, 'error');
		}
	}

	/**
	 * Set up event listeners for a database
	 */
	setupDatabaseListeners(db, dbAddress, metadata) {
		// Log all available events for debugging
		this.log(`🔧 Setting up event listeners for ${db.name}`, 'debug');

		// Handle database updates with debouncing
		db.events.on('update', async (entry) => {
			try {
				this.log(`🔄 Database updated: ${db.name}`, 'info');
				this.log(`📝 Raw update entry: ${JSON.stringify(entry)}`, 'debug');

				// Clear existing timer if it exists
				if (this.updateTimers.has(dbAddress)) {
					clearTimeout(this.updateTimers.get(dbAddress));
				}

				// Set a new timer to debounce multiple rapid updates
				const timer = setTimeout(async () => {
					try {
						// Use enhanced record counting
						const newRecordCount = await this.getRecordCount(db);
						metadata.recordCount = newRecordCount;
						metadata.lastSynced = new Date().toISOString();
						metadata.syncCount++;

						this.log(
							`📊 Database ${db.name} updated: ${newRecordCount} records (sync #${metadata.syncCount})`,
							'debug'
						);

						// Clean up the timer
						this.updateTimers.delete(dbAddress);
					} catch (error) {
						// Check if it's a PublishError - not fatal
						const isPublishErr =
							error &&
							((error.message && error.message.includes('PublishError.NoPeersSubscribedToTopic')) ||
								(error.message && error.message.includes('NoPeersSubscribedToTopic')) ||
								error.name === 'PublishError');
						if (isPublishErr) {
							this.log(
								`⚠️  Gossipsub publish error in update handler (no peers subscribed - this is normal): ${db.name}`,
								'warn'
							);
						} else {
							this.log(`❌ Error processing update for ${db.name}: ${error.message}`, 'error');
						}
					}
				}, 500); // 500ms debounce delay

				this.updateTimers.set(dbAddress, timer);
			} catch (error) {
				// Check if it's a PublishError - not fatal
				const isPublishErr =
					error &&
					((error.message && error.message.includes('PublishError.NoPeersSubscribedToTopic')) ||
						(error.message && error.message.includes('NoPeersSubscribedToTopic')) ||
						error.name === 'PublishError');
				if (isPublishErr) {
					this.log(
						`⚠️  Gossipsub publish error in update event (no peers subscribed - this is normal): ${db.name}`,
						'warn'
					);
				} else {
					this.log(`❌ Error in update event handler for ${db.name}: ${error.message}`, 'error');
				}
			}
		});

		// Handle peer joins with enhanced logging
		db.events.on('join', async (peer) => {
			const peerStr = typeof peer === 'string' ? peer : peer?.toString() || 'unknown';
			this.log(`👤 Peer joined ${db.name}: ${peerStr.slice(0, 8)}...`, 'debug');
		});
	}

	/**
	 * Handle subscription change events
	 */
	async handleSubscriptionChange(topic) {
		if (!topic || !topic.startsWith('/orbitdb/')) {
			return;
		}

		// Skip if already queued or actively syncing
		if (this.queuedSyncs.has(topic) || this.activeSyncs.has(topic)) {
			this.log(`⏭️  Database ${topic} already queued or syncing, skipping`, 'debug');
			return;
		}

		// Check if database is already open and pinned (fast path)
		if (this.pinnedDatabases.has(topic)) {
			const existing = this.pinnedDatabases.get(topic);
			if (existing.db && existing.db.opened) {
				this.log(`✅ Database ${topic} already open, skipping queue`, 'debug');
				return;
			}
		}

		this.log(`📡 Subscription change detected: ${topic}`, 'debug');

		// Mark as queued
		this.queuedSyncs.add(topic);

		// Queue the sync operation with cleanup
		this.syncQueue
			.add(() => this.syncAndPinDatabase(topic))
			.finally(() => {
				// Remove from queued set when done (whether success or failure)
				this.queuedSyncs.delete(topic);
			})
			.catch((error) => {
				// Log error but don't throw (p-queue handles errors)
				this.log(`⚠️  Sync task failed for ${topic}: ${error.message}`, 'warn');
			});
	}

	/**
	 * Handle pubsub message events
	 */
	async handlePubsubMessage(message) {
		const topic = message.topic;
		if (!topic || !topic.startsWith('/orbitdb/')) {
			return;
		}

		this.log(`💬 OrbitDB message received on topic: ${topic}`, 'debug');
		await this.handleSubscriptionChange(topic);
	}

	/**
	 * Get pinning statistics
	 */
	getStats() {
		return {
			totalPinned: this.metrics.totalPinned,
			syncOperations: this.metrics.syncOperations,
			failedSyncs: this.metrics.failedSyncs,
			allowedIdentities: this.allowedIdentities.size,
			queueSize: this.syncQueue.size,
			queuePending: this.syncQueue.pending
		};
	}

	/**
	 * Get list of pinned databases
	 */
	getPinnedDatabases() {
		const databases = [];
		for (const [address, { metadata }] of this.pinnedDatabases) {
			databases.push({
				address,
				...metadata
			});
		}
		return databases;
	}

	/**
	 * Cleanup and close all pinned databases
	 */
	async cleanup() {
		this.log('🧹 Cleaning up PinningService...', 'info');

		// Clear all update timers
		for (const timer of this.updateTimers.values()) {
			clearTimeout(timer);
		}
		this.updateTimers.clear();

		// Clear active syncs tracking
		this.activeSyncs.clear();

		// Clear queued syncs tracking
		this.queuedSyncs.clear();

		// Close all pinned databases
		const closePromises = [];
		for (const [address, { db }] of this.pinnedDatabases) {
			if (db) {
				closePromises.push(
					db
						.close()
						.catch((error) =>
							this.log(`⚠️  Error closing database ${address}: ${error.message}`, 'warn')
						)
				);
			}
		}

		await Promise.allSettled(closePromises);
		this.pinnedDatabases.clear();

		// Close OrbitDB and Helia
		if (this.orbitdb) {
			try {
				await this.orbitdb.stop();
			} catch (error) {
				this.log(`⚠️  Error stopping OrbitDB: ${error.message}`, 'warn');
			}
		}

		if (this.helia) {
			try {
				await this.helia.stop();
			} catch (error) {
				this.log(`⚠️  Error stopping Helia: ${error.message}`, 'warn');
			}
		}

		this.log('✅ PinningService cleanup completed', 'info');
	}

	/**
	 * Get comprehensive service status
	 */
	getDetailedStats() {
		const basicStats = this.getStats();
		const databases = this.getPinnedDatabases();

		return {
			...basicStats,
			databases,
			systemInfo: {
				nodeEnv: process.env.NODE_ENV,
				uptime: process.uptime(),
				memoryUsage: process.memoryUsage(),
				pid: process.pid
			},
			orbitdbInfo: {
				initialized: !!this.orbitdb,
				heliaInitialized: !!this.helia
			},
			queueInfo: {
				size: this.syncQueue.size,
				pending: this.syncQueue.pending,
				isPaused: this.syncQueue.isPaused,
				queuedSyncs: this.queuedSyncs.size,
				activeSyncs: this.activeSyncs.size
			},
			timers: {
				activeUpdateTimers: this.updateTimers.size
			},
			// Removed storacha bridge stats since we don't have it
			storachaBridge: {
				enabled: false,
				uploadsCompleted: 0,
				uploadsFailed: 0,
				queuedUploads: 0,
				inProgressUploads: 0
			}
		};
	}

	/**
	 * Enhanced logging method with levels
	 */
	log(message, level = 'info') {
		const levels = { debug: 0, info: 1, warn: 2, error: 3 };
		const currentLevel = levels[this.logLevel] || 1;

		if (levels[level] >= currentLevel) {
			const timestamp = new Date().toISOString();
			const prefix =
				level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'info' ? 'ℹ️' : '📌';
			console.log(`[${timestamp}] [PinningService] ${prefix} ${message}`);
		}
	}
}
