<script>
	import { onMount } from 'svelte';
	import { Upload, Key, LogOut, Loader2, AlertCircle, CheckCircle, Download } from 'lucide-svelte';
	import {
		initializeStorachaClient,
		initializeStorachaClientWithUCAN,
		listSpaces,
		getSpaceUsage
	} from '../../storacha-backup.js';
	import { OrbitDBStorachaBridge } from 'orbitdb-storacha-bridge';
	import { todosStore } from '../../db-actions.js';
	import { initializationStore, orbitDBStore } from '../../p2p.js';
	import { loadTodos, todoDBStore } from '../../db-actions.js';

	// Component state
	let showStoracha = true; // Start expanded by default
	let isLoading = false;
	// eslint-disable-next-line no-unused-vars
	let status = ''; // Used for internal state tracking, could be displayed in UI
	let error = null;
	let success = null;

	// Auth state
	let isLoggedIn = false;
	let client = null;
	let currentSpace = null;

	// Progress tracking state
	let showProgress = false;
	let progressType = ''; // 'upload' or 'download'
	let progressCurrent = 0;
	let progressTotal = 0;
	let progressPercentage = 0;
	let progressCurrentBlock = null;
	let progressError = null;

	// Bridge instance
	let bridge = null;

	// LocalStorage keys
	const STORAGE_KEYS = {
		STORACHA_KEY: 'storacha_key',
		STORACHA_PROOF: 'storacha_proof',
		UCAN_TOKEN: 'storacha_ucan_token',
		RECIPIENT_KEY: 'storacha_recipient_key',
		AUTH_METHOD: 'storacha_auth_method',
		AUTO_LOGIN: 'storacha_auto_login'
	};

	// Form state
	let showCredentialsForm = false;
	let authMethod = 'credentials'; // 'credentials' or 'ucan'
	let storachaKey = '';
	let storachaProof = '';
	let ucanToken = '';
	let recipientKey = '';
	// Data state
	// eslint-disable-next-line no-unused-vars
	let spaces = [];
	let spaceUsage = null; // Will contain file count and last upload info

	// Progress tracking functions
	function initializeBridge(authMethod, authData) {
		if (bridge) {
			// Remove existing listeners
			bridge.removeAllListeners();
		}

		const bridgeOptions = {};

		if (authMethod === 'credentials') {
			bridgeOptions.storachaKey = authData.key;
			bridgeOptions.storachaProof = authData.proof;
		} else if (authMethod === 'ucan') {
			// UCAN authentication support
			if (!client) {
				throw new Error('UCAN client is required but not available');
			}

			bridgeOptions.ucanClient = client;

			// Get current space DID if available
			try {
				const currentSpace = client.currentSpace();
				if (currentSpace) {
					bridgeOptions.spaceDID = currentSpace.did();
				}
			} catch (error) {
				console.warn('Could not get current space DID:', error.message);
			}
		} else {
			throw new Error(`Bridge with ${authMethod} authentication not yet implemented`);
		}

		bridge = new OrbitDBStorachaBridge(bridgeOptions);

		// Set up progress event listeners
		bridge.on('uploadProgress', (progress) => {
			console.log(
				`Upload Progress: ${progress.current}/${progress.total} (${progress.percentage}%)`
			);

			progressType = 'upload';
			progressCurrent = progress.current;
			progressTotal = progress.total;
			progressPercentage = progress.percentage;
			progressCurrentBlock = progress.currentBlock;
			progressError = progress.error;
			showProgress = true;

			// Update status text
			if (progress.error) {
				status = `Upload error: ${progress.error.message}`;
			} else if (progress.currentBlock) {
				status = `Uploading block ${progress.current} of ${progress.total} (${progress.currentBlock.hash.slice(0, 8)}...)`;
			} else {
				status = `Uploading block ${progress.current} of ${progress.total}`;
			}
		});

		bridge.on('downloadProgress', (progress) => {
			console.log(
				`Download Progress: ${progress.current}/${progress.total} (${progress.percentage}%)`
			);

			progressType = 'download';
			progressCurrent = progress.current;
			progressTotal = progress.total;
			progressPercentage = progress.percentage;
			progressCurrentBlock = progress.currentBlock;
			progressError = progress.error;
			showProgress = true;

			// Update status text
			if (progress.error) {
				status = `Download error: ${progress.error.message}`;
			} else if (progress.currentBlock) {
				status = `Downloading block ${progress.current} of ${progress.total} (${progress.currentBlock.storachaCID.slice(0, 8)}...)`;
			} else {
				status = `Downloading block ${progress.current} of ${progress.total}`;
			}
		});

		return bridge;
	}

	function resetProgress() {
		showProgress = false;
		progressType = '';
		progressCurrent = 0;
		progressTotal = 0;
		progressPercentage = 0;
		progressCurrentBlock = null;
		progressError = null;
	}

	// LocalStorage functions
	function saveCredentials(method, data) {
		try {
			console.log(`💾 Saving ${method} credentials to localStorage...`);
			localStorage.setItem(STORAGE_KEYS.AUTH_METHOD, method);
			localStorage.setItem(STORAGE_KEYS.AUTO_LOGIN, 'true');

			if (method === 'credentials') {
				localStorage.setItem(STORAGE_KEYS.STORACHA_KEY, data.key);
				localStorage.setItem(STORAGE_KEYS.STORACHA_PROOF, data.proof);
			} else if (method === 'ucan') {
				localStorage.setItem(STORAGE_KEYS.UCAN_TOKEN, data.ucanToken);
				localStorage.setItem(STORAGE_KEYS.RECIPIENT_KEY, data.recipientKey);
			}

			console.log('✅ Credentials saved successfully');
		} catch (err) {
			console.warn('❌ Failed to save credentials to localStorage:', err);
		}
	}

	function loadCredentials() {
		try {
			console.log('📖 Checking localStorage for credentials...');
			const method = localStorage.getItem(STORAGE_KEYS.AUTH_METHOD) || 'credentials';
			const autoLogin = localStorage.getItem(STORAGE_KEYS.AUTO_LOGIN);

			if (autoLogin !== 'true') {
				console.log('❌ Auto-login disabled');
				return null;
			}

			if (method === 'credentials') {
				const key = localStorage.getItem(STORAGE_KEYS.STORACHA_KEY);
				const proof = localStorage.getItem(STORAGE_KEYS.STORACHA_PROOF);
				if (key && proof) {
					console.log('✅ Valid credentials found!');
					return { method, key, proof };
				}
			} else if (method === 'ucan') {
				const ucanToken = localStorage.getItem(STORAGE_KEYS.UCAN_TOKEN);
				const recipientKey = localStorage.getItem(STORAGE_KEYS.RECIPIENT_KEY);
				if (ucanToken && recipientKey) {
					console.log('✅ Valid UCAN credentials found!');
					return { method, ucanToken, recipientKey };
				}
			}

			console.log('❌ No valid credentials found');
		} catch (err) {
			console.warn('❌ Failed to load credentials from localStorage:', err);
		}
		return null;
	}

	function clearStoredCredentials() {
		try {
			Object.values(STORAGE_KEYS).forEach((key) => {
				localStorage.removeItem(key);
			});
		} catch (err) {
			console.warn('Failed to clear credentials from localStorage:', err);
		}
	}

	// Auto-hide messages
	function showMessage(message, type = 'info') {
		if (type === 'error') {
			error = message;
			success = null;
		} else {
			success = message;
			error = null;
		}

		setTimeout(() => {
			error = null;
			success = null;
		}, 5000);
	}

	// Clear forms
	function clearForms() {
		showCredentialsForm = false;
		storachaKey = '';
		storachaProof = '';
		ucanToken = '';
		recipientKey = '';
	}

	// Login with credentials
	async function handleCredentialsLogin(useStoredCredentials = false) {
		console.log(
			'🚀 handleCredentialsLogin called with useStoredCredentials =',
			useStoredCredentials
		);

		let keyToUse = storachaKey.trim();
		let proofToUse = storachaProof.trim();

		console.log('🔍 Form values:', {
			hasKey: !!storachaKey.trim(),
			hasProof: !!storachaProof.trim(),
			keyLength: storachaKey.trim().length,
			proofLength: storachaProof.trim().length
		});

		// If using stored credentials, load them
		if (useStoredCredentials) {
			console.log('🔄 Loading stored credentials for auto-login...');
			const stored = loadCredentials();
			if (!stored) {
				console.log('⚠️ Auto-login failed: no stored credentials');
				showMessage('No stored credentials found', 'error');
				return;
			}
			keyToUse = stored.key;
			proofToUse = stored.proof;
			console.log('✅ Loaded stored credentials successfully');
		} else {
			console.log('🔐 Manual login with form credentials');
		}

		if (!keyToUse || !proofToUse) {
			showMessage('Please provide both Storacha key and proof', 'error');
			return;
		}

		isLoading = true;
		status = useStoredCredentials ? 'Auto-logging in...' : 'Logging in...';

		try {
			client = await initializeStorachaClient(keyToUse, proofToUse);

			// Initialize the bridge with credentials
			initializeBridge('credentials', { key: keyToUse, proof: proofToUse });

			// For credential-based login, check current space instead of accounts
			currentSpace = client.currentSpace();
			if (currentSpace) {
				// Credential-based login successful
				isLoggedIn = true;

				// Save credentials for future auto-login (only if not already stored)
				if (!useStoredCredentials) {
					saveCredentials('credentials', { key: keyToUse, proof: proofToUse });
					showMessage('Successfully logged in to Storacha! Credentials saved for auto-login.');
				} else {
					showMessage('Successfully auto-logged in to Storacha!');
				}

				clearForms();

				// Load spaces (will handle credential-based client properly)
				await loadSpaces();
			} else {
				// Try traditional account-based approach as fallback
				const accounts = client.accounts();
				if (accounts.length > 0) {
					isLoggedIn = true;

					if (!useStoredCredentials) {
						saveCredentials('credentials', { key: keyToUse, proof: proofToUse });
						showMessage('Successfully logged in to Storacha! Credentials saved for auto-login.');
					} else {
						showMessage('Successfully auto-logged in to Storacha!');
					}

					clearForms();
					await loadSpaces();
				} else {
					throw new Error('Failed to authenticate - no space or account found');
				}
			}
		} catch (err) {
			showMessage(`Login failed: ${err.message}`, 'error');
			// If auto-login failed, clear stored credentials
			if (useStoredCredentials) {
				clearStoredCredentials();
			}
		} finally {
			isLoading = false;
			status = '';
		}
	}

	// Login with UCAN
	async function handleUCANLogin(useStoredCredentials = false) {
		console.log('🚀 handleUCANLogin called with useStoredCredentials =', useStoredCredentials);

		let tokenToUse = ucanToken.trim();
		let keyToUse = recipientKey.trim();

		// If using stored credentials, load them
		if (useStoredCredentials) {
			console.log('🔄 Loading stored UCAN credentials for auto-login...');
			const stored = loadCredentials();
			if (!stored || stored.method !== 'ucan') {
				console.log('⚠️ UCAN auto-login failed: no stored credentials');
				showMessage('No stored UCAN credentials found', 'error');
				return;
			}
			tokenToUse = stored.ucanToken;
			keyToUse = stored.recipientKey;
			console.log('✅ Loaded stored UCAN credentials successfully');
		} else {
			console.log('🎫 Manual UCAN login with form credentials');
		}

		if (!tokenToUse || !keyToUse) {
			showMessage('Please provide both UCAN token and recipient key', 'error');
			return;
		}

		isLoading = true;
		status = useStoredCredentials ? 'Auto-logging in with UCAN...' : 'Logging in with UCAN...';

		try {
			client = await initializeStorachaClientWithUCAN(tokenToUse, keyToUse);

			// Initialize the bridge with UCAN support
			initializeBridge('ucan', { ucanToken: tokenToUse, recipientKey: keyToUse });

			currentSpace = client.currentSpace();
			if (currentSpace) {
				isLoggedIn = true;

				if (!useStoredCredentials) {
					saveCredentials('ucan', { ucanToken: tokenToUse, recipientKey: keyToUse });
					showMessage(
						'Successfully logged in to Storacha with UCAN! Credentials saved for auto-login.'
					);
				} else {
					showMessage('Successfully auto-logged in to Storacha with UCAN!');
				}

				clearForms();
				await loadSpaces();
			} else {
				throw new Error('Failed to authenticate with UCAN - no space found');
			}
		} catch (err) {
			showMessage(`UCAN login failed: ${err.message}`, 'error');
			if (useStoredCredentials) {
				clearStoredCredentials();
			}
		} finally {
			isLoading = false;
			status = '';
		}
	}

	// Logout
	function handleLogout() {
		isLoggedIn = false;
		client = null;
		currentSpace = null;
		spaces = [];
		spaceUsage = null; // Clear space usage info
		clearForms();
		clearStoredCredentials(); // Clear stored credentials on logout

		// Clean up bridge
		if (bridge) {
			bridge.removeAllListeners();
			bridge = null;
		}

		resetProgress();
		showMessage('Logged out successfully');
	}

	// Load space usage information
	async function loadSpaceUsage() {
		if (!client) return;

		try {
			spaceUsage = await getSpaceUsage(client);
			console.log('📊 Space usage loaded:', spaceUsage);
		} catch (err) {
			console.warn('⚠️ Failed to load space usage info:', err.message);
			spaceUsage = null;
		}
	}

	// Load spaces
	async function loadSpaces() {
		if (!client) return;

		isLoading = true;
		status = 'Loading spaces...';

		try {
			spaces = await listSpaces(client);
			// Also load space usage information
			await loadSpaceUsage();
		} catch (err) {
			showMessage(`Failed to load spaces: ${err.message}`, 'error');
		} finally {
			isLoading = false;
			status = '';
		}
	}

	// Backup database with progress tracking
	async function handleBackup() {
		if (!bridge) {
			showMessage('Please log in first', 'error');
			return;
		}

		if (!$initializationStore.isInitialized) {
			showMessage('OrbitDB is not initialized yet', 'error');
			return;
		}

		if ($todosStore.length === 0) {
			showMessage('No todos to backup', 'error');
			return;
		}

		isLoading = true;
		resetProgress();
		status = 'Preparing backup...';

		try {
			console.log('🚀 Starting backup with real progress tracking...', $todoDBStore);

			const result = await bridge.backup($orbitDBStore, $todoDBStore.address);

			if (result.success) {
				showMessage(
					`Backup completed! ${result.blocksUploaded}/${result.blocksTotal} blocks uploaded`
				);
			} else {
				showMessage(result.error, 'error');
			}
		} catch (err) {
			showMessage(`Backup failed: ${err.message}`, 'error');
		} finally {
			isLoading = false;
			status = '';
			resetProgress();
		}
	}

	// Format date (currently unused but may be needed for future features)
	// function formatDate(dateString) {
	// 	return new Date(dateString).toLocaleString();
	// }

	// Format relative time for space usage
	function formatRelativeTime(dateString) {
		if (!dateString) return 'Never';

		const date = new Date(dateString);
		const now = new Date();
		const diffInSeconds = Math.floor((now - date) / 1000);

		if (diffInSeconds < 60) return 'Just now';
		if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
		if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
		if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;
		if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)} months ago`;
		return `${Math.floor(diffInSeconds / 31536000)} years ago`;
	}

	// Format space name
	function formatSpaceName(space) {
		return space.name === 'Unnamed Space' ? `Space ${space.did.slice(-8)}` : space.name;
	}

	// Auto-login on component mount
	onMount(async () => {
		console.log('🚀 StorachaIntegration component mounted');

		// Try to auto-login with stored credentials (but don't show error for first-time users)
		const stored = loadCredentials();
		if (stored) {
			console.log(`🔐 Found stored ${stored.method} credentials, attempting auto-login...`);

			// Set the auth method and form values from stored credentials
			authMethod = stored.method;

			try {
				if (stored.method === 'credentials') {
					storachaKey = stored.key;
					storachaProof = stored.proof;
					await handleCredentialsLogin(true);
				} else if (stored.method === 'ucan') {
					ucanToken = stored.ucanToken;
					recipientKey = stored.recipientKey;
					await handleUCANLogin(true);
				}
			} catch (err) {
				console.warn('⚠️ Auto-login failed, clearing stored credentials:', err);
				clearStoredCredentials();
			}
		} else {
			console.log('🔒 No stored credentials found, user needs to login manually');
		}
	});

	// Fallback-only restore (more reliable but loses some metadata)
	async function restoreFromSpaceFallback() {
		if (!$orbitDBStore) {
			showMessage('OrbitDB not initialized. Please wait for initialization to complete.', 'error');
			return;
		}

		isLoading = true;
		resetProgress();
		status = 'Preparing fallback restore...';

		try {
			console.log('🔄 Starting fallback-only restore from Storacha space...');

			// Get Storacha credentials based on authentication method
			const stored = loadCredentials();
			if (!stored) {
				throw new Error('Storacha credentials not found. Please login to Storacha first.');
			}

			// Clean up existing database before restore to prevent conflicts
			status = 'Cleaning up existing database...';
			console.log('🧹 Cleaning up existing database before restore...');

			try {
				// Close and clean up existing todo database
				if ($todoDBStore) {
					console.log('📥 Closing existing todo database...');
					await $todoDBStore.close();
					todoDBStore.set(null);
				}

				// Try to drop the default database if it exists
				try {
					const existingDB = await $orbitDBStore.open('simple-todos', { type: 'keyvalue' });
					console.log(`🗑️ Dropping existing database 'simple-todos':`, existingDB.address);
					await existingDB.drop();
					await existingDB.close();
				} catch {
					console.log(`ℹ️ No existing 'simple-todos' database to drop`);
				}
			} catch (cleanupError) {
				console.warn('⚠️ Cleanup warning (continuing anyway):', cleanupError.message);
			}

			// Use the current OrbitDB instance for fallback restore with progress tracking
			status = 'Starting fallback restore...';
			console.log('🔄 Using fallback restore method with current OrbitDB instance...');

			// Initialize bridge for progress tracking if not already initialized
			if (!bridge) {
				initializeBridge(stored.method, stored);
			}

			// Use unique database name to prevent conflicts
			const uniqueDbName = `restored-todos-${Date.now()}`;
			console.log('🆆 Using unique database name:', uniqueDbName);

			// Use working restore method with fallback enabled (like Miles&Smiles)
			const result = await bridge.restoreFromSpace($orbitDBStore, {
				timeout: 120000, // 2 minutes timeout (shorter like Miles&Smiles)
				preferredDatabaseName: 'simple-todos', // Specific database name
				restartAfterRestore: true, // Restart after restore
				verifyIntegrity: true // Verify integrity
				// forceFallback: false REMOVED - let fallback be enabled!
			});

			console.log('Fallback restore result:', result);

			if (result.success) {
				// Update the todo database store with the restored database
				todoDBStore.set(result.database);

				// Load todos from the restored database
				await loadTodos();

				showMessage(
					`Restore completed! ${result.entriesRecovered} entries recovered to database '${uniqueDbName}'.`
				);

				console.log('🎉 Fallback restore completed:', {
					restoredAddress: result.database.address,
					entriesRecovered: result.entriesRecovered,
					method: result.method
				});
			} else {
				showMessage(`Fallback restore failed: ${result.error}`, 'error');
			}
		} catch (error) {
			console.error('❌ Fallback restore failed:', error);
			showMessage(`Fallback restore failed: ${error.message}`, 'error');
		} finally {
			isLoading = false;
			status = '';
			resetProgress();
		}
	}
</script>

<div
	class="max-h-[70vh] overflow-y-auto rounded-xl border border-red-300 bg-gradient-to-br from-[#FFE4AE] to-[#EFE3F3] p-4 shadow-2xl ring-1 ring-red-200/50 backdrop-blur-sm dark:border-red-600/50 dark:from-gray-800 dark:to-gray-700 dark:ring-red-400/20"
	style="backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
>
	<!-- Header -->
	<div
		class="mb-4 flex items-center justify-between border-b border-red-200/30 pb-3 dark:border-red-600/50"
	>
		<div class="flex items-center space-x-3">
			<!-- Official Storacha Rooster Logo -->
			<div class="rounded-lg border border-red-200 bg-white p-2 shadow-lg">
				<svg
					width="20"
					height="22"
					viewBox="0 0 154 172"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M110.999 41.5313H71.4081C70.2881 41.5313 69.334 42.4869 69.334 43.6087V154.359C69.334 159.461 69.1847 164.596 69.334 169.698C69.334 169.773 69.334 169.839 69.334 169.914C69.334 171.036 70.2881 171.992 71.4081 171.992H111.646C112.766 171.992 113.72 171.036 113.72 169.914V129.613L111.646 131.69H151.884C153.004 131.69 153.959 130.735 153.959 129.613V95.7513C153.959 91.6796 154.041 87.5996 153.942 83.5362C153.685 72.9996 149.512 62.8038 142.318 55.1091C135.125 47.4144 125.319 42.7029 114.907 41.7141C113.604 41.5894 112.302 41.5313 110.991 41.5313C108.319 41.523 108.319 45.6777 110.991 45.6861C120.772 45.7193 130.305 49.4171 137.457 56.1229C144.608 62.8287 149.022 71.9443 149.702 81.6416C149.993 85.813 149.802 90.0592 149.802 94.2306V124.677C149.802 126.231 149.694 127.826 149.802 129.38C149.802 129.455 149.802 129.53 149.802 129.604L151.876 127.527H111.638C110.518 127.527 109.564 128.483 109.564 129.604V169.906L111.638 167.829H71.3998L73.474 169.906V48.7689C73.474 47.1319 73.5818 45.4617 73.474 43.8247C73.474 43.7499 73.474 43.6834 73.474 43.6087L71.3998 45.6861H110.991C113.662 45.6861 113.662 41.5313 110.991 41.5313H110.999Z"
						fill="#E91315"
					/>
					<path
						d="M108.519 68.9694C108.452 62.9532 104.727 57.66 99.1103 55.5494C93.4935 53.4387 87.0886 55.2669 83.3718 59.779C79.5554 64.4157 78.9165 71.0966 82.0277 76.2901C85.1389 81.4836 91.2037 84.0762 97.1025 82.9544C103.723 81.6996 108.444 75.617 108.527 68.9694C108.56 66.2937 104.412 66.2937 104.379 68.9694C104.329 73.1325 101.749 77.0878 97.7579 78.4838C93.7673 79.8798 89.03 78.6749 86.3087 75.2265C83.5875 71.778 83.4879 67.2077 85.6865 63.6346C87.8851 60.0615 92.2076 58.1752 96.2811 59.0477C100.985 60.0532 104.32 64.1664 104.379 68.9777C104.412 71.6533 108.56 71.6533 108.527 68.9777L108.519 68.9694Z"
						fill="#E91315"
					/>
					<path
						d="M94.265 73.3237C96.666 73.3237 98.6124 71.3742 98.6124 68.9695C98.6124 66.5647 96.666 64.6152 94.265 64.6152C91.8641 64.6152 89.9177 66.5647 89.9177 68.9695C89.9177 71.3742 91.8641 73.3237 94.265 73.3237Z"
						fill="#E91315"
					/>
					<path
						d="M71.4081 36.8029H132.429C144.642 36.8029 150.64 28.5764 151.752 23.8981C152.863 19.2281 147.263 7.43685 133.624 22.1199C133.624 22.1199 141.754 6.32336 130.869 2.76686C119.984 -0.789637 107.473 10.1042 102.512 20.5577C102.512 20.5577 103.109 7.6529 91.8923 10.769C80.6754 13.8851 71.4081 36.7946 71.4081 36.7946V36.8029Z"
						fill="#E91315"
					/>
					<path
						d="M18.186 66.1195C17.879 66.0531 17.8707 65.6126 18.1694 65.5212C31.6927 61.4246 42.2376 70.7895 46.0457 76.6312C48.3189 80.1212 51.6956 83.3868 54.1182 85.5058C55.4042 86.6276 55.0889 88.7216 53.5292 89.4113C52.4589 89.8849 50.7498 90.9402 49.2316 91.846C46.3859 93.5495 42.4699 100.554 33.0948 101.884C26.1921 102.856 17.6716 98.7014 13.6561 96.4329C13.3408 96.2584 13.5399 95.793 13.8884 95.8761C19.8536 97.3137 24.2673 94.8291 22.4753 91.5302C21.1395 89.0706 17.5223 88.1482 12.2789 90.2339C7.61621 92.087 2.07414 86.0376 0.597357 84.2843C0.439724 84.1015 0.555875 83.8106 0.788177 83.7857C5.16044 83.3453 9.41656 78.8664 12.2291 74.1715C14.801 69.8755 20.5837 69.4849 22.4255 69.4683C22.6744 69.4683 22.8154 69.1858 22.6661 68.9863C22.0605 68.1886 20.6169 66.6513 18.186 66.1112V66.1195ZM30.1413 87.9571C29.7264 87.9322 29.4692 88.3975 29.7181 88.7299C30.7967 90.1342 33.5345 92.5855 38.7448 90.9818C45.8134 88.8047 46.1038 84.3175 40.9516 80.3455C36.4798 76.9054 29.2204 77.5618 24.8647 79.8968C24.4084 80.1461 24.5992 80.8441 25.1136 80.8026C26.8641 80.6696 30.133 80.8607 32.0827 82.2401C34.7126 84.0932 35.617 88.331 30.1413 87.9654V87.9571Z"
						fill="#E91315"
					/>
				</svg>
			</div>
			<div>
				<h3
					class="text-lg font-bold text-[#E91315] dark:text-white"
					style="font-family: 'Epilogue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
				>
					Storacha
				</h3>
				<p
					class="text-xs text-gray-600 dark:text-gray-300"
					style="font-family: 'DM Mono', monospace;"
				>
					Keep it Spicy 🌶️
				</p>
			</div>
		</div>

		<button
			on:click={() => (showStoracha = !showStoracha)}
			class="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-300"
			title={showStoracha ? 'Collapse' : 'Expand'}
			aria-label={showStoracha ? 'Collapse Storacha panel' : 'Expand Storacha panel'}
		>
			<svg
				class="h-4 w-4 transform transition-transform duration-200 {showStoracha
					? 'rotate-180'
					: ''}"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</button>
	</div>

	{#if showStoracha}
		<!-- OrbitDB Initialization Status -->
		{#if !$initializationStore.isInitialized}
			<div
				class="mb-4 rounded-lg border border-amber-300/40 bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 p-4 shadow-md ring-1 ring-amber-200/30 dark:border-amber-500/40 dark:from-amber-900/20 dark:via-yellow-900/20 dark:to-orange-900/20 dark:ring-amber-400/20"
			>
				<div class="flex items-start space-x-3">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg"
					>
						<Loader2 class="h-4 w-4 animate-spin text-white" />
					</div>
					<div class="flex-1 text-sm">
						<div
							class="font-semibold text-amber-900 dark:text-amber-100"
							style="font-family: 'Epilogue', sans-serif;"
						>
							⚡ Database Initializing
						</div>
						<div
							class="mt-1 text-amber-800/90 dark:text-amber-200/90"
							style="font-family: 'DM Sans', sans-serif;"
						>
							OrbitDB is still setting up your database. You can login to Storacha now, but backup &
							restore features will be available once initialization completes.
						</div>
						<div class="mt-2 flex items-center space-x-2">
							<div class="h-1.5 w-24 rounded-full bg-amber-200 dark:bg-amber-700">
								<div
									class="h-full w-3/4 animate-pulse rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
								></div>
							</div>
							<span
								class="text-xs text-amber-700 dark:text-amber-300"
								style="font-family: 'DM Mono', monospace;">Please wait...</span
							>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Status Messages -->
		{#if error}
			<div
				class="mb-4 rounded-lg border border-red-300/40 bg-gradient-to-r from-red-50 via-pink-50 to-rose-50 p-4 shadow-md ring-1 ring-red-200/30 dark:border-red-500/40 dark:from-red-900/20 dark:via-pink-900/20 dark:to-rose-900/20 dark:ring-red-400/20"
			>
				<div class="flex items-start space-x-3">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-red-400 to-rose-500 shadow-lg"
					>
						<AlertCircle class="h-4 w-4 text-white" />
					</div>
					<div class="flex-1">
						<div
							class="font-semibold text-red-900 dark:text-red-100"
							style="font-family: 'Epilogue', sans-serif;"
						>
							❌ Error
						</div>
						<div
							class="mt-1 text-sm text-red-800/90 dark:text-red-200/90"
							style="font-family: 'DM Sans', sans-serif;"
						>
							{error}
						</div>
					</div>
				</div>
			</div>
		{/if}

		{#if success}
			<div
				class="mb-4 rounded-lg border border-emerald-300/40 bg-gradient-to-r from-emerald-50 via-green-50 to-teal-50 p-4 shadow-md ring-1 ring-emerald-200/30 dark:border-emerald-500/40 dark:from-emerald-900/20 dark:via-green-900/20 dark:to-teal-900/20 dark:ring-emerald-400/20"
			>
				<div class="flex items-start space-x-3">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg"
					>
						<CheckCircle class="h-4 w-4 text-white" />
					</div>
					<div class="flex-1">
						<div
							class="font-semibold text-emerald-900 dark:text-emerald-100"
							style="font-family: 'Epilogue', sans-serif;"
						>
							✅ Success
						</div>
						<div
							class="mt-1 text-sm text-emerald-800/90 dark:text-emerald-200/90"
							style="font-family: 'DM Sans', sans-serif;"
						>
							{success}
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Progress Bar -->
		{#if showProgress}
			<div
				class="mb-4 rounded-lg border border-indigo-300/40 bg-gradient-to-r from-indigo-50 via-purple-50 to-blue-50 p-4 shadow-md ring-1 ring-indigo-200/30 dark:border-indigo-500/40 dark:from-indigo-900/20 dark:via-purple-900/20 dark:to-blue-900/20 dark:ring-indigo-400/20"
			>
				<div class="flex items-start space-x-3">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 shadow-lg"
					>
						<svg
							class="h-4 w-4 animate-spin text-white"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/>
						</svg>
					</div>
					<div class="flex-1">
						<div class="mb-2 flex items-center justify-between">
							<span
								class="font-semibold text-indigo-900 dark:text-indigo-100"
								style="font-family: 'Epilogue', sans-serif;"
							>
								🔄 {progressType === 'upload' ? 'Uploading' : 'Downloading'} Progress
							</span>
							<span
								class="text-sm font-medium text-indigo-700 dark:text-indigo-300"
								style="font-family: 'DM Mono', monospace;"
							>
								{progressPercentage}% ({progressCurrent}/{progressTotal})
							</span>
						</div>
						<div class="h-3 w-full rounded-full bg-indigo-100 shadow-inner dark:bg-indigo-800">
							<div
								class="h-3 rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500 shadow-sm transition-all duration-500 ease-out"
								style="width: {progressPercentage}%"
							></div>
						</div>
						{#if progressCurrentBlock}
							<div
								class="mt-2 text-xs text-indigo-700/80 dark:text-indigo-300/80"
								style="font-family: 'DM Mono', monospace;"
							>
								💾 {progressType === 'upload' ? 'Current block:' : 'Current CID:'}
								<span class="font-medium">
									{progressType === 'upload'
										? progressCurrentBlock.hash?.slice(0, 16)
										: progressCurrentBlock.storachaCID?.slice(0, 16)}...
								</span>
							</div>
						{/if}
						{#if progressError}
							<div
								class="mt-2 rounded-md bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400"
								style="font-family: 'DM Sans', sans-serif;"
							>
								⚠️ Error: {progressError.message}
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		{#if !isLoggedIn}
			<!-- Login Section -->
			<div class="space-y-4">
				<div
					class="text-center text-sm text-gray-700 dark:text-gray-300"
					style="font-family: 'DM Sans', sans-serif;"
				>
					🌶️ Connect to <span class="font-bold text-[#E91315]">Storacha</span> to backup your todos to
					hot decentralized storage!
				</div>

				<!-- Authentication Method Toggle -->
				<div class="mb-4 flex justify-center">
					<div
						class="rounded-lg border border-red-300 bg-gradient-to-r from-[#EFE3F3] to-[#FFE4AE] p-1 shadow-sm dark:from-gray-700 dark:to-gray-600"
					>
						<button
							on:click={() => (authMethod = 'credentials')}
							class="rounded-md px-4 py-2 text-sm transition-colors {authMethod === 'credentials'
								? 'bg-[#E91315] text-white shadow-lg'
								: 'text-gray-700 hover:bg-red-100 dark:text-gray-300 dark:hover:bg-gray-600'}"
							style="font-family: 'DM Sans', sans-serif;"
						>
							🔑 Credentials
						</button>
						<button
							on:click={() => (authMethod = 'ucan')}
							class="rounded-md px-4 py-2 text-sm transition-colors {authMethod === 'ucan'
								? 'bg-[#E91315] text-white shadow-lg'
								: 'text-gray-700 hover:bg-red-100 dark:text-gray-300 dark:hover:bg-gray-600'}"
							style="font-family: 'DM Sans', sans-serif;"
						>
							🎫 UCAN
						</button>
					</div>
				</div>

				<div class="flex justify-center">
					<button
						on:click={() => {
							clearForms();
							showCredentialsForm = true;
						}}
						disabled={isLoading}
						class="flex items-center justify-center space-x-2 rounded-md bg-[#E91315] px-4 py-2 text-white shadow-lg transition-colors hover:bg-red-700 disabled:opacity-50"
						style="font-family: 'Epilogue', sans-serif; font-weight: 500;"
					>
						<Key class="h-4 w-4" />
						<span>🌶️ Login with {authMethod === 'credentials' ? 'Credentials' : 'UCAN'}</span>
					</button>
				</div>

				<!-- Authentication Forms -->
				{#if showCredentialsForm}
					<div
						class="rounded-md border border-red-300 bg-gradient-to-br from-white to-[#EFE3F3] p-4 shadow-md dark:from-gray-700 dark:to-gray-600"
					>
						{#if authMethod === 'credentials'}
							<!-- Credentials Form -->
							<h4
								class="text-md mb-3 font-bold text-[#E91315] dark:text-white"
								style="font-family: 'Epilogue', sans-serif;"
							>
								🔑 Storacha Key & Proof
							</h4>
							<div class="space-y-3">
								<input
									bind:value={storachaKey}
									type="password"
									placeholder="Private Key (MgCZ9...)"
									class="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-red-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
									style="font-family: 'DM Mono', monospace;"
								/>
								<textarea
									bind:value={storachaProof}
									placeholder="Proof/Delegation (uCAIS...)"
									rows="3"
									class="w-full resize-none rounded-md border border-red-300 bg-white px-3 py-2 text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-red-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
									style="font-family: 'DM Mono', monospace;"
								></textarea>
								<div class="flex space-x-2">
									<button
										on:click={() => handleCredentialsLogin()}
										disabled={isLoading || !storachaKey.trim() || !storachaProof.trim()}
										class="flex-1 rounded-md bg-[#E91315] px-4 py-2 text-white shadow-lg transition-colors hover:bg-red-700 disabled:opacity-50"
										style="font-family: 'Epilogue', sans-serif; font-weight: 600;"
									>
										{isLoading ? '🌶️ Logging in...' : '🔥 Login'}
									</button>
									<button
										on:click={clearForms}
										class="rounded-md bg-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-400 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
										style="font-family: 'DM Sans', sans-serif;"
									>
										Cancel
									</button>
								</div>
							</div>
						{:else}
							<!-- UCAN Form -->
							<h4
								class="text-md mb-3 font-bold text-[#E91315] dark:text-white"
								style="font-family: 'Epilogue', sans-serif;"
							>
								🎫 UCAN Delegation
							</h4>
							<div class="space-y-3">
								<textarea
									bind:value={ucanToken}
									placeholder="UCAN Token (Base64 encoded, eyJh...)"
									rows="3"
									class="w-full resize-none rounded-md border border-red-300 bg-white px-3 py-2 text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-red-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
									style="font-family: 'DM Mono', monospace;"
								></textarea>
								<textarea
									bind:value={recipientKey}
									placeholder="Recipient Key (JSON: did:key with keys object)"
									rows="3"
									class="w-full resize-none rounded-md border border-red-300 bg-white px-3 py-2 text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-red-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
									style="font-family: 'DM Mono', monospace;"
								></textarea>
								<div class="flex space-x-2">
									<button
										on:click={() => handleUCANLogin()}
										disabled={isLoading || !ucanToken.trim() || !recipientKey.trim()}
										class="flex-1 rounded-md bg-[#E91315] px-4 py-2 text-white shadow-lg transition-colors hover:bg-red-700 disabled:opacity-50"
										style="font-family: 'Epilogue', sans-serif; font-weight: 600;"
									>
										{isLoading ? '🌶️ Logging in...' : '🔥 Login'}
									</button>
									<button
										on:click={clearForms}
										class="rounded-md bg-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-400 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
										style="font-family: 'DM Sans', sans-serif;"
									>
										Cancel
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<!-- Logged In Section -->
			<div class="space-y-4">
				<!-- Account Info -->
				<div
					class="flex items-center justify-between rounded-md border border-red-300 bg-gradient-to-r from-[#BDE0FF] to-[#FFE4AE] p-3 shadow-md dark:from-gray-700 dark:to-gray-600"
				>
					<div class="flex items-center space-x-3">
						<div
							class="flex h-8 w-8 items-center justify-center rounded-full bg-[#E91315] shadow-lg"
						>
							<CheckCircle class="h-4 w-4 text-white" />
						</div>
						<div>
							<div
								class="text-sm font-bold text-[#E91315] dark:text-white"
								style="font-family: 'Epilogue', sans-serif;"
							>
								🌶️ Connected to Storacha
							</div>
							{#if currentSpace}
								<div
									class="text-xs text-[#0176CE] dark:text-gray-400"
									style="font-family: 'DM Mono', monospace;"
								>
									🌍 Space: {formatSpaceName(currentSpace)}
								</div>
							{/if}
						</div>
					</div>

					<button
						on:click={handleLogout}
						class="flex items-center space-x-1 px-3 py-1 text-sm text-[#E91315] transition-colors hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
						style="font-family: 'DM Sans', sans-serif;"
					>
						<LogOut class="h-3 w-3" />
						<span>🔥 Logout</span>
					</button>
				</div>

				<!-- Action Buttons -->
				<div class="space-y-3">
					<!-- Backup Button -->
					<button
						on:click={handleBackup}
						disabled={isLoading || !$initializationStore.isInitialized || $todosStore.length === 0}
						class="flex w-full items-center justify-center space-x-2 rounded-md bg-[#FFC83F] px-4 py-2 font-bold text-gray-900 shadow-lg transition-colors hover:bg-yellow-500 disabled:opacity-50"
						style="font-family: 'Epilogue', sans-serif;"
					>
						<Upload class="h-4 w-4" />
						<span>📦 Backup to Storacha</span>
					</button>

					<!-- Restore Button -->
					<button
						on:click={restoreFromSpaceFallback}
						disabled={isLoading || !$initializationStore.isInitialized}
						class="flex w-full items-center justify-center space-x-2 rounded-md bg-[#0176CE] px-4 py-2 font-bold text-white shadow-lg transition-colors hover:bg-blue-700 disabled:opacity-50"
						style="font-family: 'Epilogue', sans-serif;"
						title="Restore database from Storacha backup"
					>
						<Download class="h-4 w-4" />
						<span>🌶️ Restore from Storacha</span>
					</button>
				</div>

				<!-- Space Usage Information -->
				<div
					class="rounded-md border border-red-300 bg-gradient-to-br from-white to-[#FFE4AE] p-4 shadow-md dark:from-gray-700 dark:to-gray-600"
				>
					<div class="mb-3 flex items-center justify-between">
						<h4
							class="flex items-center space-x-2 font-bold text-[#E91315] dark:text-white"
							style="font-family: 'Epilogue', sans-serif;"
						>
							<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
								/>
							</svg>
							<span>🌶️ Storage Analytics</span>
						</h4>
						<div class="flex items-center space-x-1">
							<button
								on:click={loadSpaceUsage}
								disabled={isLoading}
								class="rounded-md p-2 text-[#E91315] transition-all hover:scale-105 hover:bg-red-100 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/30"
								title="Refresh space usage"
								aria-label="Refresh space usage"
							>
								<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
									/>
								</svg>
							</button>
							{#if spaceUsage && spaceUsage.totalFiles <= 50 && !spaceUsage.analyzed}
								<button
									on:click={async () => {
										spaceUsage = await getSpaceUsage(client, true);
									}}
									disabled={isLoading}
									class="rounded-md p-2 text-[#0176CE] transition-all hover:scale-105 hover:bg-blue-100 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
									title="Analyze file types"
									aria-label="Analyze file types"
								>
									<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
										/>
									</svg>
								</button>
							{/if}
						</div>
					</div>

					<!-- Space Usage Information -->
					{#if spaceUsage}
						<div
							class="mb-4 rounded border border-red-300 bg-gradient-to-r from-[#EFE3F3] to-white p-3 shadow-sm dark:border-gray-600 dark:from-gray-700 dark:to-gray-600"
						>
							<div class="flex items-center justify-between text-sm">
								<div class="flex items-center space-x-2">
									<div
										class="flex h-6 w-6 items-center justify-center rounded-full bg-[#E91315] shadow-md"
									>
										<span
											class="text-xs font-bold text-white"
											style="font-family: 'DM Mono', monospace;">{spaceUsage.totalFiles}</span
										>
									</div>
									<span
										class="font-medium text-gray-800 dark:text-gray-300"
										style="font-family: 'DM Sans', sans-serif;"
									>
										🗺️ file{spaceUsage.totalFiles !== 1 ? 's' : ''} stored
									</span>
								</div>
								{#if spaceUsage.lastUploadDate}
									<div
										class="text-[#0176CE] dark:text-gray-400"
										style="font-family: 'DM Mono', monospace;"
									>
										⏰ Last upload: {formatRelativeTime(spaceUsage.lastUploadDate)}
									</div>
								{/if}
							</div>

							<!-- File Type Breakdown -->
							{#if spaceUsage.totalFiles > 0}
								<div class="mt-2 grid grid-cols-3 gap-2 text-xs">
									{#if spaceUsage.backupFiles > 0}
										<div class="flex items-center space-x-1">
											<div class="h-2 w-2 rounded-full bg-[#FFC83F]"></div>
											<span
												class="text-gray-700 dark:text-gray-300"
												style="font-family: 'DM Sans', sans-serif;"
												>{spaceUsage.backupFiles} backup{spaceUsage.backupFiles !== 1
													? 's'
													: ''}</span
											>
										</div>
									{/if}
									{#if spaceUsage.blockFiles > 0}
										<div class="flex items-center space-x-1">
											<div class="h-2 w-2 rounded-full bg-[#0176CE]"></div>
											<span
												class="text-gray-700 dark:text-gray-300"
												style="font-family: 'DM Sans', sans-serif;"
												>{spaceUsage.blockFiles} data block{spaceUsage.blockFiles !== 1
													? 's'
													: ''}</span
											>
										</div>
									{/if}
									{#if spaceUsage.otherFiles > 0}
										<div class="flex items-center space-x-1">
											<div class="h-2 w-2 rounded-full bg-[#E91315]"></div>
											<span
												class="text-gray-700 dark:text-gray-300"
												style="font-family: 'DM Sans', sans-serif;"
												>{spaceUsage.otherFiles} other</span
											>
										</div>
									{/if}
								</div>

								<div
									class="mt-2 text-xs text-gray-600 dark:text-gray-400"
									style="font-family: 'DM Sans', sans-serif;"
								>
									{#if spaceUsage.oldestUploadDate && spaceUsage.oldestUploadDate !== spaceUsage.lastUploadDate}
										<div class="text-[#0176CE]" style="font-family: 'DM Mono', monospace;">
											📅 Oldest upload: {formatRelativeTime(spaceUsage.oldestUploadDate)}
										</div>
									{/if}
									<em class="text-gray-600 dark:text-gray-400"
										>🌶️ Note: Each backup creates many data blocks</em
									>
								</div>
							{/if}
						</div>
					{:else if spaceUsage === null && isLoggedIn}
						<div
							class="mb-4 rounded border border-red-300 bg-gradient-to-r from-[#EFE3F3] to-[#FFE4AE] p-3 shadow-sm dark:border-red-600 dark:from-gray-700 dark:to-gray-600"
						>
							<div class="flex items-center space-x-2">
								<div class="flex h-5 w-5 items-center justify-center rounded-full bg-[#E91315]">
									<svg
										class="h-3 w-3 text-white"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
								</div>
								<div
									class="text-sm font-medium text-[#E91315] dark:text-red-300"
									style="font-family: 'DM Sans', sans-serif;"
								>
									🌶️ Space usage information unavailable
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* Custom scrollbar for webkit browsers */
	.overflow-y-auto::-webkit-scrollbar {
		width: 4px;
	}

	.overflow-y-auto::-webkit-scrollbar-track {
		background: rgba(0, 0, 0, 0.1);
		border-radius: 2px;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb {
		background: rgba(0, 0, 0, 0.3);
		border-radius: 2px;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb:hover {
		background: rgba(0, 0, 0, 0.4);
	}
</style>
