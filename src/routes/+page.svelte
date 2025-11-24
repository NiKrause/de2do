<script>
	/* eslint-disable no-undef */
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { initializeP2P, initializationStore, libp2pStore } from '$lib/p2p.js';
	import { peerIdStore } from '$lib/stores.js';
	import {
		todosStore,
		addTodo,
		deleteTodo,
		toggleTodoComplete,
		todoDBStore,
		loadTodos,
		orbitdbStore
	} from '$lib/db-actions.js';
	import ConsentModal from '$lib/components/ui/ConsentModal.svelte';
	import SocialIcons from '$lib/components/ui/SocialIcons.svelte';
	import SystemToast from '$lib/components/ui/SystemToast.svelte';
	import LoadingSpinner from '$lib/components/ui/LoadingSpinner.svelte';
	import ErrorAlert from '$lib/components/ui/ErrorAlert.svelte';
	import AddTodoForm from '$lib/components/todo/AddTodoForm.svelte';
	import TodoList from '$lib/components/todo/TodoList.svelte';
	import ConnectedPeers from '$lib/components/p2p/ConnectedPeers.svelte';
	import PeerIdCard from '$lib/components/p2p/PeerIdCard.svelte';
	import StorachaIntegration from '$lib/components/integration/StorachaIntegration.svelte';
	import QRCodeModal from '$lib/components/ui/QRCodeModal.svelte';
	import TodoListSelector from '$lib/components/todo/TodoListSelector.svelte';
	import UsersList from '$lib/UsersList/index.svelte';
	import BreadcrumbNavigation from '$lib/components/todo/BreadcrumbNavigation.svelte';
import ShareEmbedButtons from '$lib/components/todo/ShareEmbedButtons.svelte';
import PasswordModal from '$lib/components/ui/PasswordModal.svelte';
import {
switchToTodoList,
		createSubList,
		currentTodoListNameStore,
		currentDbNameStore,
		currentDbAddressStore,
		extractDisplayName,
		listAvailableTodoLists,
		availableTodoListsStore,
		todoListHierarchyStore,
		buildHierarchyPath,
		listUniqueUsers,
		selectedUserIdStore
	} from '$lib/todo-list-manager.js';
	import { openDatabaseByAddress } from '$lib/p2p.js';
	import { getCurrentIdentityId } from '$lib/stores.js';
	import { get } from 'svelte/store';
	// import { Cloud } from 'lucide-svelte'; // Unused for now
	import { toastStore } from '$lib/toast-store.js';
	import { browser } from '$app/environment';
	import { replaceState, goto } from '$app/navigation';

	// Expose database address to window for e2e testing
	// Move reactive statements outside the if block and ensure they always run
	// Expose database address to window for e2e testing
	$: if (browser && $currentDbAddressStore) {
		window.__currentDbAddress__ = $currentDbAddressStore;
	}

	$: if (browser && !$currentDbAddressStore) {
		delete window.__currentDbAddress__;
	}

	$: if (browser && $todoDBStore) {
		window.__todoDB__ = $todoDBStore;
		// Also set address from todoDB if currentDbAddressStore is not set
		if ($todoDBStore.address && !$currentDbAddressStore) {
			window.__currentDbAddress__ = $todoDBStore.address;
		}
	}

	// Expose orbitdb and identity ID to window for e2e testing
	$: if (browser && $orbitdbStore) {
		window.__orbitdb__ = $orbitdbStore;
		if ($orbitdbStore.identity && $orbitdbStore.identity.id) {
			window.__currentIdentityId__ = $orbitdbStore.identity.id;
		}
	}

	// Expose currentDbNameStore to window for e2e testing
	$: if (browser && $currentDbNameStore) {
		window.__currentDbName__ = $currentDbNameStore;
	}

	const CONSENT_KEY = `consentAccepted@${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}`;

	let error = null;
	let myPeerId = null;

	// Modal state
	let showModal = true;
	let rememberDecision = false;
	let preferences = {
		enablePersistentStorage: true,
		enableNetworkConnection: true,
		enablePeerConnections: true
	};

	// Storacha integration state
	let showStorachaIntegration = false;

	// QR Code modal state
	let showQRCodeModal = false;

	// Encryption state
	let enableEncryption = false;
	let encryptionPassword = '';
	let isCurrentDbEncrypted = false; // Track if currently open database is encrypted

	// Password modal state
	let showPasswordModal = false;
	let passwordModalDbName = '';
	let passwordRetryCount = 0;
	let pendingDatabaseOpen = null; // Store pending database open operation

	// Flag to prevent infinite loop when updating hash from store changes
	let isUpdatingFromHash = false;

	// Embed mode state
	let isEmbedMode = false;
	let embedAllowAdd = false;

	const handleModalClose = async (event) => {
		showModal = false;

		// Extract preferences from the event detail
		preferences = event?.detail || {};
		console.log('🔧 DEBUG: Received preferences from ConsentModal:', preferences);

		try {
			if (rememberDecision) {
				localStorage.setItem(CONSENT_KEY, 'true');
			}
		} catch {
			// ignore storage errors
		}

		try {
			// Pass the preferences to initializeP2P
			// Check if already initializing/initialized to avoid duplicate initialization
			const currentState = get(initializationStore);
			if (!currentState.isInitialized && !currentState.isInitializing) {
				await initializeP2P(preferences);
			}
		} catch (err) {
			error = `Failed to initialize P2P or OrbitDB: ${err.message}`;
			console.error('P2P initialization failed:', err);
		}
	};

	onMount(async () => {
		try {
			// Check if there's a hash in the URL - if so, auto-initialize even without consent
			const hasHash = window.location.hash && window.location.hash.startsWith('#/');
			const hasConsent = localStorage.getItem(CONSENT_KEY) === 'true';

			// Check for embed mode on initial load
			if (hasHash && window.location.hash.startsWith('#/embed/')) {
				isEmbedMode = true;
				const embedPath = window.location.hash.slice(8); // Remove '#/embed/'
				const [, queryString] = embedPath.split('?');
				if (queryString) {
					const params = new URLSearchParams(queryString);
					embedAllowAdd = params.get('allowAdd') === 'true';
				} else {
					embedAllowAdd = false;
				}
				
				// IMPORTANT: Also trigger the hash handler after initialization
				// This ensures the database is opened even on initial load
			}

			// Check for hash in URL to open specific database
			const handleHashChange = async () => {
				if (!$initializationStore.isInitialized || isUpdatingFromHash) {
					return; // Wait for initialization or skip if we're updating hash
				}

				const hash = window.location.hash;
				if (hash && hash.startsWith('#/')) {
					// Check if this is an embed route
					if (hash.startsWith('#/embed/')) {
						isEmbedMode = true;
					// Extract address and query params from #/embed/orbitdb/...?allowAdd=true
					const embedPath = hash.slice(8); // Remove '#/embed/'
					const [addressPart, queryString] = embedPath.split('?');
					const address = addressPart;

						// Parse query params
						if (queryString) {
							const params = new URLSearchParams(queryString);
							embedAllowAdd = params.get('allowAdd') === 'true';
						} else {
							embedAllowAdd = false;
						}

						// Open the database if address is valid
						// Address might be 'orbitdb/...' or '/orbitdb/...'
						const normalizedAddress = address.startsWith('/') ? address : `/${address}`;
						if (address && (address.startsWith('orbitdb/') || address.startsWith('/orbitdb/'))) {
							const currentAddress = get(currentDbAddressStore);
							if (normalizedAddress === currentAddress || address === currentAddress) {
								return; // Already on this database
							}

							console.log(`📂 Opening database from embed hash: ${normalizedAddress}`);
							isUpdatingFromHash = true;

						try {
							toastStore.show('🌐 Loading database from network...', 'info', 5000);
							const opened = await tryOpenDatabaseWithEncryptionDetection(normalizedAddress, preferences);
							if (opened) {
								await loadTodos();
							} else {
								// Password modal will be shown automatically, wait for user
								toastStore.show('🔐 This database is encrypted. Please enter the password.', 'info');
								return;
							}

								// Load hierarchy for breadcrumb navigation
								try {
									await listAvailableTodoLists();
									const availableLists = get(availableTodoListsStore);
									const list = availableLists.find(
										(l) => l.address === normalizedAddress || l.address === address
									);
									if (list) {
										const hierarchy = await buildHierarchyPath(list.displayName);
										todoListHierarchyStore.set(hierarchy);
									} else {
										const currentListName = get(currentTodoListNameStore);
										if (currentListName) {
											todoListHierarchyStore.set([{ name: currentListName, parent: null }]);
										}
									}
								} catch (hierarchyError) {
									console.warn('Could not load hierarchy:', hierarchyError);
									const currentListName = get(currentTodoListNameStore);
									if (currentListName) {
										todoListHierarchyStore.set([{ name: currentListName, parent: null }]);
									}
								}
							} catch (error) {
								console.error('❌ Error opening database from embed hash:', error);
								toastStore.show(`Failed to open database: ${error.message}`, 'error');
							} finally {
								isUpdatingFromHash = false;
							}
						}
						return; // Don't process as regular hash
					} else {
			isEmbedMode = false;
			embedAllowAdd = false;
		}

		const hashValue = hash.slice(2); // Remove '#/'
		if (!hashValue) return;

					const currentAddress = get(currentDbAddressStore);
					if (hashValue === currentAddress) {
						return; // Already on this database
					}

					console.log(`📂 Opening database from URL hash: ${hashValue}`);
					isUpdatingFromHash = true;

				try {
					console.log('🔧 DEBUG: Hash value:', hashValue);
				if (hashValue.startsWith('orbitdb/') || hashValue.startsWith('/orbitdb/')) {
					// It's an OrbitDB address - open directly by address
					// Normalize to have leading slash
					const normalizedAddress = hashValue.startsWith('/') ? hashValue : `/${hashValue}`;
					console.log(`🔗 Opening database by address from URL: ${normalizedAddress}`);
					toastStore.show('🌐 Loading database from network...', 'info', 5000);
					const opened = await tryOpenDatabaseWithEncryptionDetection(normalizedAddress, preferences);
					if (!opened) {
						// Password modal will be shown automatically
						toastStore.show('🔐 This database is encrypted. Please enter the password.', 'info');
						let waitForPassword = true;
						while (waitForPassword && showPasswordModal) {
							await new Promise((resolve) => setTimeout(resolve, 100));
						}
					}
					const openedDB = get(todoDBStore);
					
					// Also use normalizedAddress when looking up in registry and storing
					const hashValueForLookup = normalizedAddress;

							// Log database information
							console.log('📊 Database Information:');
							console.log('  - Address:', openedDB.address);
							console.log('  - Name:', openedDB.name);
							console.log('  - Type:', openedDB.type);
							console.log('  - Opened:', openedDB.opened);
							console.log('  - Writable:', openedDB.access?.write || false);

							// Get all data from the database
							try {
								const allData = await openedDB.all();
								console.log('📦 Database Contents:');
								console.log(
									'  - Total Records:',
									Array.isArray(allData) ? allData.length : 'Unknown format'
								);

								if (Array.isArray(allData)) {
									console.log('  - Records:', allData);

									// Log each record in detail
									allData.forEach((entry, index) => {
										console.log(`  Record ${index + 1}:`, {
											key: entry.key || entry.hash,
											hash: entry.hash,
											value: entry.value,
											fullEntry: entry
										});
									});
								} else {
									console.log('  - Raw Data:', allData);
								}

								// Try to get todos if available
								const currentTodoDB = get(todoDBStore);
								if (currentTodoDB && currentTodoDB === openedDB) {
									const todos = get(todosStore);
									console.log('  - Parsed Todos:', todos);
									console.log('  - Todo Count:', todos.length);
								}
							} catch (dataError) {
								console.error('  ❌ Error reading database contents:', dataError);
							}

							// Extract display name and dbName from database name
							const currentIdentityId = getCurrentIdentityId();
							let displayName = openedDB.name || 'Unknown';
							let dbName = openedDB.name || null;
							let extractedIdentityId = null;

					if (currentIdentityId) {
						// Try to find this address in our registry FIRST
						await listAvailableTodoLists();
						const availableLists = get(availableTodoListsStore);
						const list = availableLists.find((l) => l.address === hashValueForLookup);

								if (list) {
									// Found in registry - use registry values (most reliable)
									displayName = list.displayName;
									dbName = list.dbName;
									console.log('  - Found in registry:', {
										displayName,
										dbName,
										parent: list.parent
									});

									// Extract identity from dbName if we have it
									if (dbName && dbName.includes('_')) {
										const underscoreIndex = dbName.indexOf('_');
										if (underscoreIndex > 0) {
											extractedIdentityId = dbName.substring(0, underscoreIndex);
										}
									}

								// Update users list from dbName prefixes (even if found in registry)
								await listUniqueUsers();
								
								// If this is a foreign database, select that user in the userlist
								if (extractedIdentityId && extractedIdentityId !== currentIdentityId) {
									console.log('  - Setting selected user to foreign identity:', extractedIdentityId);
									selectedUserIdStore.set(extractedIdentityId);
								}
								} else {
									// Not in registry - extract from database name
									// The dbName should have format: identityId_displayName or identityId_displayName_timestamp
									if (dbName && dbName.includes('_')) {
										const parts = dbName.split('_');
										if (parts.length >= 2) {
											extractedIdentityId = parts[0];
											
											// Check if last part is a timestamp (all digits)
											const lastPart = parts[parts.length - 1];
											const isTimestamp = /^\d+$/.test(lastPart);
											
											if (isTimestamp && parts.length >= 3) {
												// Format: identityId_displayName_timestamp
												// Join all middle parts (in case displayName has underscores)
												displayName = parts.slice(1, -1).join('_');
											} else {
												// Format: identityId_displayName (no timestamp)
												displayName = parts.slice(1).join('_');
											}
											
											console.log('  - Extracted from database name:', {
												displayName,
												dbName,
												extractedIdentityId,
												isTimestamp
											});
										}
									} else if (displayName && displayName !== 'Unknown') {
										// We have a displayName without identity prefix
										// Try to construct proper dbName with current identity if available
										if (currentIdentityId && !dbName) {
											dbName = `${currentIdentityId}_${displayName}`;
											extractedIdentityId = currentIdentityId;
											console.log('  - Constructed dbName with current identity:', {
												displayName,
												dbName
											});
										}
									} else {
										// Fallback: create display name from address
										displayName = `Database ${hashValue.slice(-8)}`;
										if (!dbName) {
											dbName = `unknown_${displayName}`;
										}
									}

									// Add to available lists store so it appears in combo box
									const newList = {
										dbName: dbName,
										displayName: displayName,
										address: hashValueForLookup,
										parent: null
									};

									const updatedLists = [...availableLists, newList];
									availableTodoListsStore.set(updatedLists);
									console.log('  - Added to available lists:', newList);

									// Persist in our registry so it survives refreshes/switches
									try {
										const { addTodoListToRegistry } = await import('$lib/todo-list-manager.js');
										await addTodoListToRegistry(displayName, dbName, hashValueForLookup, null);
										console.log('  - Persisted in registry');
									} catch (e) {
										console.warn('  ⚠️ Could not persist to registry:', e);
									}

									// Update users list from dbName prefixes
									await listUniqueUsers();
								}
							} else {
								// No current identity, just use database name
								if (!displayName || displayName === 'Unknown' || !dbName) {
									displayName = `Database ${hashValue.slice(-8)}`;
									if (!dbName) {
										dbName = `unknown_${displayName}`;
									}
								}

								// Add to available lists store
								const newList = {
									dbName: dbName,
									displayName: displayName,
									address: hashValueForLookup,
									parent: null
								};

								const currentLists = get(availableTodoListsStore);
								const updatedLists = [...currentLists, newList];
								availableTodoListsStore.set(updatedLists);
								console.log('  - Added to available lists (no identity):', newList);

								// Persist in our registry if possible (may fail if not initialized yet)
								try {
									const { addTodoListToRegistry } = await import('$lib/todo-list-manager.js');
									await addTodoListToRegistry(displayName, dbName, hashValueForLookup, null);
									console.log('  - Persisted in registry');
								} catch (e) {
									console.warn('  ⚠️ Could not persist to registry (no identity yet?):', e);
								}

								// Update users list from dbName prefixes
								await listUniqueUsers();
								
								// If this is a foreign database, select that user in the userlist
								if (extractedIdentityId && extractedIdentityId !== currentIdentityId) {
									console.log('  - Setting selected user to foreign identity:', extractedIdentityId);
									selectedUserIdStore.set(extractedIdentityId);
								}
							}

							// Update stores
							currentTodoListNameStore.set(displayName);
							if (dbName) {
								currentDbNameStore.set(dbName);
							}
							currentDbAddressStore.set(hashValueForLookup);

							// Re-extract identity from final dbName to ensure we have it
							if (dbName && dbName.includes('_')) {
								const underscoreIndex = dbName.indexOf('_');
								if (underscoreIndex > 0) {
									extractedIdentityId = dbName.substring(0, underscoreIndex);
								}
							}

							// Ensure users list is updated after all store updates
							await listUniqueUsers();

							// Show final toast with identity and dbName (after all processing)
							if (extractedIdentityId && dbName) {
								console.log(
									'📢 Showing success toast with identity:',
									extractedIdentityId,
									'and dbName:',
									dbName
								);
								toastStore.show(
									`✅ Database loaded! Identity: ${extractedIdentityId.slice(0, 8)}... | Name: ${dbName}`,
									'success',
									5000
								);
							} else if (dbName) {
								console.log('📢 Showing success toast with dbName:', dbName);
								toastStore.show(`✅ Database loaded! Name: ${dbName}`, 'success', 5000);
							}

							// Update hierarchy
							if (currentIdentityId) {
								await listAvailableTodoLists();
								const availableLists = get(availableTodoListsStore);
								const list = availableLists.find((l) => l.address === hashValueForLookup);
								if (list && list.parent) {
									// Build hierarchy for this list
									const hierarchy = await buildHierarchyPath(list.displayName);
									todoListHierarchyStore.set(hierarchy);
									console.log('  - Hierarchy:', hierarchy);
								} else {
									// Not in registry or no parent, set as root
									todoListHierarchyStore.set([{ name: displayName, parent: null }]);
								}
							} else {
								// No identity, set as root
								todoListHierarchyStore.set([{ name: displayName, parent: null }]);
							}

							console.log('✅ Database opened and logged successfully');
						} else {
							// Not an address - treat as displayName or dbName (backward compatibility)
							const identityId = getCurrentIdentityId();

							// Try to find it in available lists first
							await listAvailableTodoLists();
							const availableLists = get(availableTodoListsStore);
							const list = availableLists.find((l) => l.displayName === hashValue);

							if (list) {
								// Found in available lists - check if we have an address
								if (list.address) {
									// Use the address to open
									await openDatabaseByAddress(
										list.address,
										preferences,
										enableEncryption,
										encryptionPassword
									);
									// Track encryption state
									isCurrentDbEncrypted = enableEncryption && !!encryptionPassword;
									if (isCurrentDbEncrypted) {
										enableEncryption = false;
										encryptionPassword = '';
									}
									currentTodoListNameStore.set(list.displayName);
									currentDbNameStore.set(list.dbName);
									currentDbAddressStore.set(list.address);
								} else {
									// No address stored, switch normally (will create/get address)
									await switchToTodoList(
										list.displayName,
										preferences,
										enableEncryption,
										encryptionPassword
									);
									// Track encryption state
									isCurrentDbEncrypted = enableEncryption && !!encryptionPassword;
									if (isCurrentDbEncrypted) {
										enableEncryption = false;
										encryptionPassword = '';
									}
								}
							} else if (identityId && hashValue.startsWith(`${identityId}_`)) {
								// It's a full dbName from current identity
								const displayName = extractDisplayName(hashValue, identityId);
								await switchToTodoList(
									displayName,
									preferences,
									enableEncryption,
									encryptionPassword
								);
								// Track encryption state
								isCurrentDbEncrypted = enableEncryption && !!encryptionPassword;
								if (isCurrentDbEncrypted) {
									enableEncryption = false;
									encryptionPassword = '';
								}
							} else {
								// Not found, try to open as displayName (will create if doesn't exist)
								await switchToTodoList(
									hashValue,
									preferences,
									enableEncryption,
									encryptionPassword
								);
								// Track encryption state
								isCurrentDbEncrypted = enableEncryption && !!encryptionPassword;
								if (isCurrentDbEncrypted) {
									enableEncryption = false;
									encryptionPassword = '';
								}
							}
						}
					} catch (error) {
						console.error('❌ Error opening database from hash:', error);
						toastStore.show(`Failed to open database: ${error.message}`, 'error');
					} finally {
						isUpdatingFromHash = false;
					}
				}
			};

			// Listen for hash changes
			window.addEventListener('hashchange', handleHashChange);

			// Set up subscription to handle hash after initialization completes
			let hashHandled = false;
			const unsubscribe = initializationStore.subscribe(async (state) => {
				if (state.isInitialized && hasHash && !hashHandled) {
					// Only handle hash once after initialization
					const currentAddress = get(currentDbAddressStore);
			const hash = window.location.hash;
			if (hash && hash.startsWith('#/')) {
				const hashValue = hash.slice(2);
				if (hashValue !== currentAddress) {
					hashHandled = true;
					await handleHashChange();
				}
			}
				}
			});

			// If there's a hash in URL, auto-initialize even without consent (user wants to open a specific DB)
			// Accessing a database via URL implies consent
			if (hasHash || hasConsent) {
				if (hasHash && !hasConsent) {
					// Auto-initialize when hash is present - accessing DB via URL implies consent
					showModal = false;
					console.log(
						'🔧 DEBUG: Hash detected, auto-initializing to open database (implied consent)...'
					);
					// Initialize - skip default database since we'll open from hash
					// Hash will be handled by subscription once initialized
					await initializeP2P({
						enablePersistentStorage: true,
						enableNetworkConnection: true,
						enablePeerConnections: true,
						skipDefaultDatabase: true
					});
					// Hash will be handled by subscription
				} else if (hasConsent) {
					// Normal flow: consent remembered
					showModal = false;
					console.log('🔧 DEBUG: Auto-initializing with default preferences');
					await initializeP2P({
						enablePersistentStorage: true,
						enableNetworkConnection: true,
						enablePeerConnections: true
					});

					// After initialization, check hash
					await handleHashChange();
					hashHandled = true;
				}
			}

			// Add this in onMount or as a global function
			if (browser) {
				window.__getDbAddress = () => {
					return $currentDbAddressStore || $todoDBStore?.address || null;
				};
			}

			// Cleanup on component destroy
			return () => {
				window.removeEventListener('hashchange', handleHashChange);
				unsubscribe();
			};
		} catch {
			// ignore storage errors
		}
	});

	// Update hash when currentDbAddressStore changes (but not when updating from hash or in embed mode)
	$: {
		if (
			typeof window !== 'undefined' &&
			$initializationStore.isInitialized &&
			!isUpdatingFromHash &&
			!isEmbedMode
		) {
			const currentAddress = $currentDbAddressStore;
			if (currentAddress) {
				const hash = currentAddress.startsWith('/') ? currentAddress : `/${currentAddress}`;
				if (window.location.hash !== `#${hash}`) {
					// Use replaceState to avoid adding to history
					// eslint-disable-next-line svelte/no-navigation-without-resolve
					replaceState(`#${hash}`, { replaceState: true });
				}
			}
		}
	}

	// Password modal handlers
	const handlePasswordSubmit = async (event) => {
		const { password, rememberForSession } = event.detail;
		if (!pendingDatabaseOpen) {
			console.error('No pending database open operation');
			showPasswordModal = false;
			return;
		}

		try {
			console.log('🔐 Attempting to open database with provided password...');
			
			// Check if this is an address-based open or list-name-based open
			if (pendingDatabaseOpen.address) {
				// Address-based open (from hash/URL)
				const { address, preferences: pendingPreferences } = pendingDatabaseOpen;
				await openDatabaseByAddress(address, pendingPreferences, true, password);
				await loadTodos();
				
				// Mark database as encrypted
				isCurrentDbEncrypted = true;
				enableEncryption = false;
				encryptionPassword = '';
			} else if (pendingDatabaseOpen.listName) {
				// List-name-based open (from TodoListSelector)
				const { listName, preferences: pendingPreferences, parentList } = pendingDatabaseOpen;
				await switchToTodoList(listName, pendingPreferences, true, password, parentList);
				// Password is now cached automatically by switchToTodoList
				isCurrentDbEncrypted = true;
			}

			toastStore.show('✅ Database unlocked successfully!', 'success');
			showPasswordModal = false;
			pendingDatabaseOpen = null;
			passwordRetryCount = 0;
		} catch (err) {
			console.error('❌ Failed to open database with password:', err);
			passwordRetryCount++;
			if (passwordRetryCount >= 3) {
				toastStore.show('❌ Too many failed attempts. Please try again later.', 'error');
				showPasswordModal = false;
				pendingDatabaseOpen = null;
				passwordRetryCount = 0;
				isUpdatingFromHash = false;
			} else {
				toastStore.show(`❌ Incorrect password. Attempt ${passwordRetryCount}/3`, 'error');
			}
		}
	};

	const handlePasswordCancel = () => {
		showPasswordModal = false;
		pendingDatabaseOpen = null;
		passwordRetryCount = 0;
		isUpdatingFromHash = false;
		toastStore.show('⚠️ Database open cancelled', 'info');
	};

	const tryOpenDatabaseWithEncryptionDetection = async (address, preferences) => {
		let dataLooksEncrypted = false;
		
		try {
			console.log('🔍 Attempting to open database without encryption...');
			// Try to open without encryption first
			await openDatabaseByAddress(address, preferences, false, null);
			const db = get(todoDBStore);
			const entries = await db.all();
			
			console.log('🔍 Database opened, checking entries:', entries.length, 'entries');

			// If database has entries, check if they look encrypted/corrupted
			if (entries.length > 0) {
				// Check if data looks valid OR encrypted
				const validCount = entries.filter(isDataLooksValid).length;
				const invalidCount = entries.length - validCount;
				
				console.log(`🔍 Valid entries: ${validCount}, Invalid/Encrypted entries: ${invalidCount}`);
				
				// If more than 50% of entries are invalid, likely encrypted
				if (invalidCount > entries.length / 2) {
					console.log('⚠️ Most entries appear corrupted/encrypted');
					dataLooksEncrypted = true;
				} else if (validCount > 0) {
					// Some valid entries found, database is unencrypted
					console.log('✅ Database opened successfully without encryption (has valid entries)');
					isCurrentDbEncrypted = false;
					enableEncryption = false;
					encryptionPassword = '';
					await loadTodos();
					return true;
				} else {
					// All entries invalid, likely encrypted
					console.log('⚠️ All entries appear corrupted/encrypted');
					dataLooksEncrypted = true;
				}
			} else {
				// Empty database - not encrypted, just empty
				console.log('✅ Database opened successfully (empty, not encrypted)');
				isCurrentDbEncrypted = false;
				enableEncryption = false;
				encryptionPassword = '';
				await loadTodos();
				return true;
			}
		} catch (err) {
			console.log('⚠️ Error opening without encryption:', err.message);
			// Opening failed - might be encrypted or other error
			dataLooksEncrypted = true;
		}

		// If we detected encryption, prompt for password
		if (dataLooksEncrypted) {
			console.log('🔐 Database appears to be encrypted, prompting for password...');
			passwordModalDbName = address.split('/').pop() || address;
			pendingDatabaseOpen = { address, preferences };
			passwordRetryCount = 0;
			showPasswordModal = true;
			return false;
		}
		
		// Unexpected case - database opened but all entries invalid and not clearly encrypted
		console.warn('⚠️ Database in unexpected state');
		return true;
	};

	const isDataLooksValid = (entry) => {
		// Check if a single entry looks like valid todo data
		if (!entry || !entry.value) {
			return false;
		}
		
		try {
			const value = entry.value;
			
			// If value is a string (might be encrypted), it's invalid
			if (typeof value === 'string') {
				return false;
			}
			
			// If value is an object, check if it has expected todo properties
			if (typeof value === 'object' && value !== null) {
				// Valid if it has typical todo properties
				return Boolean(value.text || value.title || value.content || value.completed !== undefined);
			}
			
			return false;
		} catch (err) {
			// If we can't parse/check the entry, consider it invalid
			return false;
		}
	};

	// Handle switching to an encrypted list - prompt for password if needed
	const handleEncryptedListSwitch = async (listName, prefs, parentList = null) => {
		try {
			await switchToTodoList(listName, prefs, false, '', parentList);
			return true;
		} catch (error) {
			if (error.message === 'ENCRYPTION_PASSWORD_REQUIRED') {
				// Show password modal
				console.log('🔐 Password required for encrypted list:', listName);
				passwordModalDbName = listName;
				pendingDatabaseOpen = { listName, preferences: prefs, parentList };
				passwordRetryCount = 0;
				showPasswordModal = true;
				return false; // Will retry after password is entered
			} else {
				// Other error
				throw error;
			}
		}
	};

	const handleAddTodo = async (event) => {
		const { text, description, priority, estimatedTime, estimatedCosts } = event.detail;
		const success = await addTodo(
			text,
			null, // assignee
			description,
			priority,
			estimatedTime,
			estimatedCosts
		);
		if (success) {
			toastStore.show('✅ Todo added successfully!', 'success');
		} else {
			toastStore.show('❌ Failed to add todo', 'error');
		}
	};

	const handleDelete = async (event) => {
		const success = await deleteTodo(event.detail.key);
		if (success) {
			toastStore.show('🗑️ Todo deleted successfully!', 'success');
		} else {
			toastStore.show('❌ Failed to delete todo', 'error');
		}
	};

	const handleToggleComplete = async (event) => {
		const success = await toggleTodoComplete(event.detail.key);
		if (success) {
			toastStore.show('✅ Todo status updated!', 'success');
		} else {
			toastStore.show('❌ Failed to update todo', 'error');
		}
	};

	const handleCreateSubList = async (event) => {
		const { text } = event.detail;
		const currentList = get(currentTodoListNameStore);

		try {
			const success = await createSubList(
				text,
				currentList,
				preferences,
				enableEncryption,
				encryptionPassword
			);
			if (success) {
				await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for stores to update

				if (isEmbedMode && typeof window !== 'undefined') {
					const newListAddress = get(currentDbAddressStore);
					if (newListAddress) {
						await loadTodos(); // Reload todos from the new database

						// Update hierarchy
						try {
							await listAvailableTodoLists();
							const availableLists = get(availableTodoListsStore);
							const list = availableLists.find((l) => l.address === newListAddress);
							if (list) {
								const hierarchy = await buildHierarchyPath(list.displayName);
								todoListHierarchyStore.set(hierarchy);
							} else {
								const newListName = get(currentTodoListNameStore);
								if (newListName) {
									todoListHierarchyStore.set([{ name: newListName, parent: null }]);
								}
							}
						} catch (hierarchyError) {
							console.warn('Could not update hierarchy:', hierarchyError);
						}

						// Navigate to new embed route using goto (like the embed route does)
						const embedPath = `/embed/${encodeURIComponent(newListAddress)}`;
						const queryParams = embedAllowAdd ? '?allowAdd=true' : '';
						const newUrl = embedPath + queryParams;
						await goto(newUrl, { noScroll: true });

						toastStore.show('✅ Sub-list created!', 'success');
					}
				} else {
					toastStore.show('✅ Sub-list created!', 'success');
				}
			} else {
				toastStore.show('❌ Failed to create sub-list', 'error');
			}
		} catch (err) {
			console.error('Failed to create sub-list:', err);
			toastStore.show('❌ Failed to create sub-list', 'error');
		}
	};

	// Reactively update encryption state based on current list
	$: if ($currentTodoListNameStore && $availableTodoListsStore.length > 0) {
		const currentList = $availableTodoListsStore.find(
			(list) => list.displayName === $currentTodoListNameStore
		);
		
		if (currentList) {
			// Update encryption state to match the current database
			const wasEncrypted = isCurrentDbEncrypted;
			isCurrentDbEncrypted = currentList.encryptionEnabled || false;
			
			// Log state change for debugging
			if (wasEncrypted !== isCurrentDbEncrypted) {
				console.log(`🔐 Encryption state changed: ${wasEncrypted} → ${isCurrentDbEncrypted} for list: ${$currentTodoListNameStore}`);
			}
			
			// Reset form state when switching to unencrypted database
			if (!isCurrentDbEncrypted) {
				enableEncryption = false;
				encryptionPassword = '';
			}
		}
	}

	// Subscribe to the peerIdStore
	$: myPeerId = $peerIdStore;

	let connectedPeersRef;

	// Custom restore event handler for debugging (currently unused)
	// const handleRestoreComplete = async (event) => {
	// 	console.log('🔄 Restore event received:', event.detail);
	// 	const { success, orbitdb, database, message } = event.detail;

	// 	if (success) {
	// 		console.log('🎉 Restore successful, updating application databases...');
	// 		console.log('🔍 New OrbitDB instance:', orbitdb);
	// 		console.log('🔍 New database instance:', database);

	// 		// Check if the restored database has entries
	// 		const restoredEntries = await database.all();
	// 		console.log('🔍 Restored database entries:', restoredEntries.length, restoredEntries);

	// 		// Manually update the stores
	// 		orbitdbStore.set(orbitdb);
	// 		todoDBStore.set(database);

	// 		// Force reload of todos from the new database
	// 		await loadTodos();

	// 		toastStore.show(`✅ Restore completed! ${restoredEntries.length} todos loaded.`, 'success');
	// 	} else {
	// 		console.error('❌ Restore failed:', message);
	// 		toastStore.show(`❌ Restore failed: ${message}`, 'error');
	// 	}
	// };

	// Add debugging to monitor store changes
	$: if ($orbitdbStore) {
		console.log('🔍 OrbitDB store changed:', $orbitdbStore.id || 'no-id');
	}

	$: if ($todoDBStore) {
		console.log('🔍 TodoDB store changed:', $todoDBStore.address || 'no-address');
	}

	$: if ($todosStore) {
		console.log('🔍 Todos store changed:', $todosStore.length, 'todos');
	}

	// Manual database debugging - expose to window for console debugging
	if (typeof window !== 'undefined') {
		window.debugDatabase = async () => {
			console.log('🔍 Current OrbitDB store:', $orbitdbStore?.id);
			console.log('🔍 Current TodoDB store:', $todoDBStore?.address);
			if ($todoDBStore) {
				const entries = await $todoDBStore.all();
				console.log('🔍 Current database entries:', entries.length, entries);
			}
			console.log('🔍 Current todos store:', $todosStore.length, $todosStore);
		};

		window.forceReloadTodos = async () => {
			console.log('🔄 Force reloading todos...');
			await loadTodos();
			console.log('🔄 Reload complete');
		};
	}
</script>

<SystemToast />

<svelte:head>
	<title
		>Simple TODO Example {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}</title
	>
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta
		name="description"
		content="A simple local-first peer-to-peer TODO list app using OrbitDB, IPFS and libp2p"
	/>
	<!-- Storacha Brand Fonts (Local) -->
	<link rel="stylesheet" href="/fonts/storacha-fonts.css" />
</svelte:head>

<!-- Only render the modal when needed -->
{#if showModal}
	<ConsentModal
		bind:show={showModal}
		bind:rememberDecision
		rememberLabel="Don't show this again on this device"
		proceedButtonText="Accept & Continue"
		on:proceed={handleModalClose}
	/>
{/if}

<!-- Password modal for encrypted databases -->
<PasswordModal
	isOpen={showPasswordModal}
	dbName={passwordModalDbName}
	retryCount={passwordRetryCount}
	on:submit={handlePasswordSubmit}
	on:cancel={handlePasswordCancel}
/>

<main class="container mx-auto max-w-4xl p-6">
	{#if !isEmbedMode}
		<!-- Header with title and social icons -->
		<header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex-1">
				<h1 class="text-2xl font-bold text-gray-800 sm:text-3xl">Simple TODO Example</h1>
				<p class="mt-1 text-sm text-gray-500">
					• A Basic Local-First Peer-To-Peer PWA with IPFS and OrbitDB v{typeof __APP_VERSION__ !==
					'undefined'
						? __APP_VERSION__
						: '0.0.0'} [{typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev'}]
				</p>
			</div>
			<div class="flex flex-shrink-0 items-center gap-4 self-start sm:self-auto">
				<ShareEmbedButtons />
				<SocialIcons size="w-5 h-5" className="" onQRCodeClick={() => (showQRCodeModal = true)} />
			</div>
		</header>
	{/if}

	{#if $initializationStore.isInitializing}
		<LoadingSpinner
			message={preferences.enableNetworkConnection
				? 'Initializing P2P connection...'
				: 'Opening OrbitDB database...'}
			submessage={$initializationStore.enableNetworkConnection
				? 'Please wait while we set up the network...'
				: 'Please wait while we open the database...'}
			version="{typeof __APP_VERSION__ !== 'undefined'
				? __APP_VERSION__
				: '0.0.0'} [{typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev'}]"
		/>
	{:else if error || $initializationStore.error}
		<ErrorAlert error={error || $initializationStore.error} dismissible={true} />
	{:else if isEmbedMode}
		<!-- Embed Mode UI -->
		<div class="mx-auto max-w-2xl">
			<!-- Breadcrumb Navigation -->
			<BreadcrumbNavigation {preferences} {enableEncryption} {encryptionPassword} />

			{#if embedAllowAdd}
				<AddTodoForm on:add={handleAddTodo} />
			{/if}
			<TodoList
				todos={$todosStore}
				showTitle={false}
				allowEdit={embedAllowAdd}
				on:delete={handleDelete}
				on:toggleComplete={handleToggleComplete}
				on:createSubList={handleCreateSubList}
			/>
		</div>
	{:else}
		<!-- Normal Mode UI -->
		<!-- Todo List Selector and Encryption Options -->
		<div class="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
			<div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<UsersList />
				</div>
				<div>
					<TodoListSelector />
				</div>
			</div>
			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
				{#if isCurrentDbEncrypted}
					<!-- Encryption is active - show status -->
					<div class="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 border border-green-200">
						<span class="text-green-600">🔐</span>
						<span class="text-sm font-medium text-green-800">Encryption: Active</span>
					</div>
					<button
						type="button"
						on:click={async () => {
							if (!confirm('Disable encryption? This will create a new unencrypted database and copy all your data to it. The old encrypted database will remain but won\'t be used.')) {
								return;
							}
							
							// Prompt for current password
							const currentPassword = prompt('Enter current encryption password:');
							if (!currentPassword) {
								return;
							}
							
							try {
								// Get current database info
								const { currentTodoListNameStore, currentDbNameStore, currentDbAddressStore } = await import('$lib/todo-list-manager.js');
								const { disableDatabaseEncryption } = await import('$lib/encryption-migration.js');
								const { get } = await import('svelte/store');
								
								const currentList = get(currentTodoListNameStore);
								const currentDbName = get(currentDbNameStore);
								const currentAddress = get(currentDbAddressStore);
								
								// Migrate to unencrypted
								const result = await disableDatabaseEncryption(
									currentList,
									currentDbName,
									currentAddress,
									currentPassword,
									preferences,
									null
								);
								
								if (result.success) {
									// Reopen the new unencrypted database
									await switchToTodoList(currentList, preferences, false, '');
									isCurrentDbEncrypted = false;
									enableEncryption = false;
									encryptionPassword = '';
								}
							} catch (error) {
								toastStore.show(`Failed to disable encryption: ${error.message}`, 'error');
							}
						}}
						disabled={!$initializationStore.isInitialized}
						class="rounded-md bg-gray-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					>
						Disable Encryption
					</button>
				{:else}
					<!-- Encryption is not active - show enable form -->
					<div class="group relative">
						<label class="flex cursor-pointer items-center gap-2">
							<input
								type="checkbox"
								bind:checked={enableEncryption}
								class="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
							/>
							<span class="text-sm font-medium text-gray-700">Enable Encryption</span>
						</label>
						<div
							class="invisible absolute top-full left-0 z-10 mt-2 w-64 rounded-md bg-gray-900 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100"
							role="tooltip"
						>
							Without encryption, the todo list will be visible unencrypted on the internet and might
							be wanted or not wanted.
						</div>
					</div>
					{#if enableEncryption}
						<div class="flex-1">
							<label for="encryption-password" class="mb-1 block text-sm font-medium text-gray-700">
								Encryption Password
							</label>
							<input
								id="encryption-password"
								type="password"
								bind:value={encryptionPassword}
								placeholder="Enter password for encryption"
								on:keydown={(e) => {
									if (e.key === 'Enter' && encryptionPassword.trim() && $initializationStore.isInitialized) {
										e.preventDefault();
										document.getElementById('apply-encryption-button')?.click();
									}
								}}
								class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
							/>
						</div>
						<button
							id="apply-encryption-button"
							type="button"
							on:click={async () => {
								if (enableEncryption && !encryptionPassword.trim()) {
									alert('Please enter an encryption password');
									return;
								}
								
								try {
									// Get current database info
									const { currentTodoListNameStore, currentDbNameStore, currentDbAddressStore } = await import('$lib/todo-list-manager.js');
									const { enableDatabaseEncryption } = await import('$lib/encryption-migration.js');
									const { get } = await import('svelte/store');
									
									const currentList = get(currentTodoListNameStore);
									const currentDbName = get(currentDbNameStore);
									const currentAddress = get(currentDbAddressStore);
									
									// Migrate to encrypted
									const result = await enableDatabaseEncryption(
										currentList,
										currentDbName,
										currentAddress,
										encryptionPassword,
										preferences,
										null
									);
									
								if (result.success) {
									// Reopen the new encrypted database
									await switchToTodoList(currentList, preferences, true, encryptionPassword);
									
									// Update UI state
									isCurrentDbEncrypted = true;
									enableEncryption = false; // Reset checkbox
									// Don't clear password yet - keep it for next operations in this session
									
									// Load todos from the newly encrypted database
									await loadTodos();
									
									// Now clear password field after everything is loaded
									encryptionPassword = '';
								}
								} catch (error) {
									toastStore.show(`Failed to enable encryption: ${error.message}`, 'error');
								}
							}}
							disabled={!$initializationStore.isInitialized || !encryptionPassword.trim()}
							class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
						>
							Apply Encryption
						</button>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Add TODO Form -->
		<AddTodoForm on:add={handleAddTodo} disabled={!$initializationStore.isInitialized} />

		<!-- Breadcrumb Navigation -->
		<BreadcrumbNavigation {preferences} {enableEncryption} {encryptionPassword} />

		<!-- TODO List -->
		<TodoList
			todos={$todosStore}
			on:delete={handleDelete}
			on:toggleComplete={handleToggleComplete}
			on:createSubList={handleCreateSubList}
		/>

		<!-- P2P Status -->
		<div class="grid gap-6 md:grid-cols-2">
			<!-- Connected Peers -->
			<ConnectedPeers bind:this={connectedPeersRef} libp2p={$libp2pStore} />

			<!-- My Identity -->
			<PeerIdCard peerId={myPeerId} />
		</div>

		<!-- Storacha Test Suite - Temporarily disabled
		<StorachaTest />
		-->
	{/if}
</main>

<!-- Floating Storacha Button & Panel - Always Available -->
<!-- Floating Storacha Button -->
<button
	on:click={() => (showStorachaIntegration = !showStorachaIntegration)}
	class="fixed right-6 bottom-36 z-[10000] flex h-16 w-16 items-center justify-center rounded-full border-2 border-white bg-[#E91315] text-white shadow-2xl transition-all duration-300 hover:scale-110 hover:shadow-[0_20px_40px_rgba(233,19,21,0.4)] focus:ring-4 focus:ring-red-300 focus:outline-none sm:bottom-24 {showStorachaIntegration
		? 'scale-105 rotate-12'
		: 'hover:rotate-6'}"
	title={showStorachaIntegration
		? 'Hide Spicy Storacha Backup 🌶️'
		: 'Open Storacha - The Hottest Decentralized Storage! Keep it Spicy! 🔥'}
	aria-label={showStorachaIntegration
		? 'Hide Storacha spicy backup integration'
		: 'Open Storacha spicy backup integration'}
	style="font-family: 'Epilogue', -apple-system, BlinkMacSystemFont, sans-serif; background: linear-gradient(135deg, #E91315 0%, #FFC83F 100%);"
>
	<!-- Official Storacha Rooster Logo -->
	<svg
		width="28"
		height="32"
		viewBox="0 0 154 172"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		class="transition-transform duration-300"
	>
		<path
			d="M110.999 41.5313H71.4081C70.2881 41.5313 69.334 42.4869 69.334 43.6087V154.359C69.334 159.461 69.1847 164.596 69.334 169.698C69.334 169.773 69.334 169.839 69.334 169.914C69.334 171.036 70.2881 171.992 71.4081 171.992H111.646C112.766 171.992 113.72 171.036 113.72 169.914V129.613L111.646 131.69H151.884C153.004 131.69 153.959 130.735 153.959 129.613V95.7513C153.959 91.6796 154.041 87.5996 153.942 83.5362C153.685 72.9996 149.512 62.8038 142.318 55.1091C135.125 47.4144 125.319 42.7029 114.907 41.7141C113.604 41.5894 112.302 41.5313 110.991 41.5313C108.319 41.523 108.319 45.6777 110.991 45.6861C120.772 45.7193 130.305 49.4171 137.457 56.1229C144.608 62.8287 149.022 71.9443 149.702 81.6416C149.993 85.813 149.802 90.0592 149.802 94.2306V124.677C149.802 126.231 149.694 127.826 149.802 129.38C149.802 129.455 149.802 129.53 149.802 129.604L151.876 127.527H111.638C110.518 127.527 109.564 128.483 109.564 129.604V169.906L111.638 167.829H71.3998L73.474 169.906V48.7689C73.474 47.1319 73.5818 45.4617 73.474 43.8247C73.474 43.7499 73.474 43.6834 73.474 43.6087L71.3998 45.6861H110.991C113.662 45.6861 113.662 41.5313 110.991 41.5313H110.999Z"
			fill="currentColor"
		/>
		<path
			d="M108.519 68.9694C108.452 62.9532 104.727 57.66 99.1103 55.5494C93.4935 53.4387 87.0886 55.2669 83.3718 59.779C79.5554 64.4157 78.9165 71.0966 82.0277 76.2901C85.1389 81.4836 91.2037 84.0762 97.1025 82.9544C103.723 81.6996 108.444 75.617 108.527 68.9694C108.56 66.2937 104.412 66.2937 104.379 68.9694C104.329 73.1325 101.749 77.0878 97.7579 78.4838C93.7673 79.8798 89.03 78.6749 86.3087 75.2265C83.5875 71.778 83.4879 67.2077 85.6865 63.6346C87.8851 60.0615 92.2076 58.1752 96.2811 59.0477C100.985 60.0532 104.32 64.1664 104.379 68.9777C104.412 71.6533 108.56 71.6533 108.527 68.9777L108.519 68.9694Z"
			fill="currentColor"
		/>
		<path
			d="M94.265 73.3237C96.666 73.3237 98.6124 71.3742 98.6124 68.9695C98.6124 66.5647 96.666 64.6152 94.265 64.6152C91.8641 64.6152 89.9177 66.5647 89.9177 68.9695C89.9177 71.3742 91.8641 73.3237 94.265 73.3237Z"
			fill="currentColor"
		/>
		<path
			d="M71.4081 36.8029H132.429C144.642 36.8029 150.64 28.5764 151.752 23.8981C152.863 19.2281 147.263 7.43685 133.624 22.1199C133.624 22.1199 141.754 6.32336 130.869 2.76686C119.984 -0.789637 107.473 10.1042 102.512 20.5577C102.512 20.5577 103.109 7.6529 91.8923 10.769C80.6754 13.8851 71.4081 36.7946 71.4081 36.7946V36.8029Z"
			fill="currentColor"
		/>
		<path
			d="M18.186 66.1195C17.879 66.0531 17.8707 65.6126 18.1694 65.5212C31.6927 61.4246 42.2376 70.7895 46.0457 76.6312C48.3189 80.1212 51.6956 83.3868 54.1182 85.5058C55.4042 86.6276 55.0889 88.7216 53.5292 89.4113C52.4589 89.8849 50.7498 90.9402 49.2316 91.846C46.3859 93.5495 42.4699 100.554 33.0948 101.884C26.1921 102.856 17.6716 98.7014 13.6561 96.4329C13.3408 96.2584 13.5399 95.793 13.8884 95.8761C19.8536 97.3137 24.2673 94.8291 22.4753 91.5302C21.1395 89.0706 17.5223 88.1482 12.2789 90.2339C7.61621 92.087 2.07414 86.0376 0.597357 84.2843C0.439724 84.1015 0.555875 83.8106 0.788177 83.7857C5.16044 83.3453 9.41656 78.8664 12.2291 74.1715C14.801 69.8755 20.5837 69.4849 22.4255 69.4683C22.6744 69.4683 22.8154 69.1858 22.6661 68.9863C22.0605 68.1886 20.6169 66.6513 18.186 66.1112V66.1195ZM30.1413 87.9571C29.7264 87.9322 29.4692 88.3975 29.7181 88.7299C30.7967 90.1342 33.5345 92.5855 38.7448 90.9818C45.8134 88.8047 46.1038 84.3175 40.9516 80.3455C36.4798 76.9054 29.2204 77.5618 24.8647 79.8968C24.4084 80.1461 24.5992 80.8441 25.1136 80.8026C26.8641 80.6696 30.133 80.8607 32.0827 82.2401C34.7126 84.0932 35.617 88.331 30.1413 87.9654V87.9571Z"
			fill="currentColor"
		/>
	</svg>
</button>

<!-- Floating Storacha Integration Panel -->
{#if showStorachaIntegration}
	<!-- Backdrop overlay -->
	<div
		class="fixed inset-0 z-[9998] bg-red-900/20 backdrop-blur-[2px]"
		on:click={() => (showStorachaIntegration = false)}
		on:keydown={(e) => e.key === 'Enter' && (showStorachaIntegration = false)}
		transition:fade={{ duration: 200 }}
		role="button"
		tabindex="0"
		aria-label="Close Storacha spicy integration panel"
		style="background: radial-gradient(circle at center, rgba(233, 19, 21, 0.15) 0%, rgba(233, 19, 21, 0.05) 70%, transparent 100%);"
	></div>

	<!-- Floating panel -->
	<div
		class="fixed right-6 bottom-52 z-[9999] w-96 max-w-[calc(100vw-3rem)] sm:right-4 sm:bottom-48 sm:w-80 md:right-6 md:bottom-52"
		transition:fly={{ x: 100, duration: 300 }}
	>
		<StorachaIntegration />
	</div>
{/if}

<!-- QR Code Modal -->
<QRCodeModal bind:show={showQRCodeModal} />
