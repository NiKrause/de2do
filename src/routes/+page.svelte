<script>
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import {
		initializeP2P,
		initializationStore,
		libp2pStore,
		reapplyOrbitDbIdentityAfterP2Pass
	} from '$lib/p2p.js';
	import { todosStore, todoDBStore, orbitdbStore, todosCountStore } from '$lib/db-actions.js';
	import { ConsentModal } from '@le-space/orbitdb-ui';
	import { setOnPasskeyPrompt } from '$lib/identity/varsig-identity.js';
	import {
		readSigningPreferenceFromStorage,
		writeSigningPreferenceToStorage
	} from '@le-space/p2pass';
	import WalletProfile from '$lib/components/identity/WalletProfile.svelte';
	import SystemToast from '$lib/components/ui/SystemToast.svelte';
	import LoadingSpinner from '$lib/components/ui/LoadingSpinner.svelte';
	import ErrorAlert from '$lib/components/ui/ErrorAlert.svelte';
	import AddTodoForm from '$lib/components/todo/AddTodoForm.svelte';
	import TodoList from '$lib/components/todo/TodoList.svelte';
	import AppFooter from '$lib/components/layout/AppFooter.svelte';
	import P2PassMount from '$lib/components/integration/P2PassMount.svelte';
	import QRCodeModal from '$lib/components/ui/QRCodeModal.svelte';
	import TodoListSelector from '$lib/components/todo/TodoListSelector.svelte';
	import UsersList from '$lib/UsersList/index.svelte';
	import BreadcrumbNavigation from '$lib/components/todo/BreadcrumbNavigation.svelte';
	import AppHeader from '$lib/components/layout/AppHeader.svelte';
	import EncryptionSettings from '$lib/components/encryption/EncryptionSettings.svelte';
	import { inlineUnlockStore, requestInlineUnlock } from '$lib/encryption/inline-unlock-store.js';
	import { consolidatePasskeyCredentials } from '$lib/wallet/passkey-wallet.js';
	import { setupDatabaseDebug } from '$lib/debug/database-debug.js';
	import { createTodoHandlers } from '$lib/handlers/todo-handlers.js';
	import { setupHashRouter } from '$lib/routing/hash-router.js';
	import {
		currentTodoListNameStore,
		currentDbNameStore,
		currentDbAddressStore,
		availableTodoListsStore
	} from '$lib/todo-list-manager.js';
	import { p2passAuthSnapshotStore } from '$lib/stores.js';
	import { get } from 'svelte/store';
	import { showExternalPasskeyPrompt } from '$lib/passkey-notice.js';

	// Wire package-level passkey prompts (hardware/varsig paths) to the shared explanatory notice UI.
	setOnPasskeyPrompt(showExternalPasskeyPrompt);
	// import { Cloud } from 'lucide-svelte'; // Unused for now
	import { browser } from '$app/environment';
	import { replaceState } from '$app/navigation';

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
	const SECTION_STATE_KEY = 'simple-todo:page-sections:v1';
	const DEFAULT_SECTION_STATE = {
		settings: true,
		wallet: false,
		addTodo: false,
		todoList: true
	};

	let error = null;

	// Modal state
	let showModal = true;
	let rememberDecision = false;
	let preferences = {
		enablePersistentStorage: true,
		enableNetworkConnection: true,
		enablePeerConnections: true
	};

	let sectionState = { ...DEFAULT_SECTION_STATE };

	// QR Code modal state
	let showQRCodeModal = false;

	// Encryption state
	let enableEncryption = false;
	let encryptionPassword = '';
	let isCurrentDbEncrypted = false; // Track if currently open database is encrypted

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
		if (browser) {
			window.__lastConsentPreferences__ = preferences;
		}

		try {
			if (rememberDecision) {
				localStorage.setItem(CONSENT_KEY, 'true');
			}
		} catch {
			// ignore storage errors
		}

		try {
			const currentState = get(initializationStore);
			if (!currentState.isInitialized && !currentState.isInitializing) {
				await initializeP2P(preferences);
			}
		} catch (err) {
			error = `Failed to initialize P2P or OrbitDB: ${err.message}`;
			console.error('P2P initialization failed:', err);
		}
	};

	function loadSectionState() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(SECTION_STATE_KEY);
			if (!raw) {
				sectionState = { ...DEFAULT_SECTION_STATE };
				return;
			}
			const parsed = JSON.parse(raw);
			sectionState = {
				...DEFAULT_SECTION_STATE,
				...(parsed && typeof parsed === 'object' ? parsed : {})
			};
		} catch {
			sectionState = { ...DEFAULT_SECTION_STATE };
		}
	}

	function persistSectionState() {
		if (!browser) return;
		try {
			localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(sectionState));
		} catch {
			// ignore storage errors
		}
	}

	function toggleSection(section) {
		sectionState = { ...sectionState, [section]: !sectionState[section] };
		persistSectionState();
	}

	async function handleP2PassAuthenticate(signingMode) {
		if (signingMode?.did) {
			p2passAuthSnapshotStore.set({
				did: signingMode.did,
				mode: signingMode.mode,
				algorithm: signingMode.algorithm,
				secure: signingMode.secure,
				at: Date.now()
			});
		} else {
			p2passAuthSnapshotStore.set(null);
		}

		try {
			await consolidatePasskeyCredentials();
		} catch (e) {
			console.warn('Passkey consolidate after P2Pass auth:', e);
		}

		const initState = get(initializationStore);
		if (!initState.isInitialized) return;

		try {
			const listName = get(currentTodoListNameStore) || 'projects';
			await reapplyOrbitDbIdentityAfterP2Pass(signingMode, {
				preferences,
				todoListName: listName,
				enableEncryption,
				encryptionPassword: encryptionPassword?.trim() ? encryptionPassword : null
			});
		} catch (e) {
			console.warn('OrbitDB identity bridge after P2Pass:', e);
		}
	}

	function handleP2PassRestore(restoredDb) {
		console.log('[P2Pass] restore:', restoredDb?.address ?? restoredDb);
	}

	function handleP2PassBackup(result) {
		console.log('[P2Pass] backup:', result);
	}

	onMount(async () => {
		try {
			loadSectionState();

			if (browser && !readSigningPreferenceFromStorage()) {
				writeSigningPreferenceToStorage('worker');
			}

			// Check if there's a hash in the URL - if so, auto-initialize even without consent
			const hasHash = window.location.hash && window.location.hash.startsWith('#/');
			const hasConsent = localStorage.getItem(CONSENT_KEY) === 'true';

			// Setup hash router with context
			const routerCleanup = setupHashRouter({
				initializationStore,
				hasHash,
				isUpdatingFromHash,
				setIsUpdatingFromHash: (value) => {
					isUpdatingFromHash = value;
				},
				isEmbedMode,
				setIsEmbedMode: (value) => {
					isEmbedMode = value;
				},
				embedAllowAdd,
				setEmbedAllowAdd: (value) => {
					embedAllowAdd = value;
				},
				preferences,
				enableEncryption,
				encryptionPassword,
				setIsCurrentDbEncrypted: (value) => {
					isCurrentDbEncrypted = value;
				}
			});

			// If there's a hash in URL, auto-initialize even without consent
			if (hasHash || hasConsent) {
				if (hasHash && !hasConsent) {
					// Auto-initialize when hash is present - accessing DB via URL implies consent
					showModal = false;
					console.log(
						'🔧 DEBUG: Hash detected, auto-initializing to open database (implied consent)...'
					);
					// Initialize - skip default database since we'll open from hash
					// Hash will be handled by router once initialized
					await initializeP2P({
						enablePersistentStorage: true,
						enableNetworkConnection: true,
						enablePeerConnections: true,
						skipDefaultDatabase: true
					});
				} else if (hasConsent) {
					// Normal flow: consent remembered
					showModal = false;
					console.log('🔧 DEBUG: Auto-initializing with default preferences');
					await initializeP2P({
						enablePersistentStorage: true,
						enableNetworkConnection: true,
						enablePeerConnections: true
					});
				}
			}

			// Add window function for e2e testing
			if (browser) {
				window.__getDbAddress = () => {
					return $currentDbAddressStore || $todoDBStore?.address || null;
				};
				// Dev-only: let Playwright open the inline unlock panel when P2P timing is flaky
				if (import.meta.env.DEV) {
					window.__e2eRequestInlineUnlock = () => {
						requestInlineUnlock({
							address: get(currentDbAddressStore),
							name: get(currentDbNameStore),
							displayName: get(currentTodoListNameStore)
						});
					};
				}
			}

			// Return cleanup function
			return routerCleanup;
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

	// Create todo event handlers using factory
	$: todoHandlers = createTodoHandlers({ preferences, enableEncryption, encryptionPassword });
	$: delegationEnabledForCurrentDb = $todoDBStore?.access?.type === 'todo-delegation';

	// Delegate to handlers from factory
	const handleAddTodo = async (event) => {
		return await todoHandlers.handleAddTodo(event);
	};

	const handleDelete = async (event) => {
		return await todoHandlers.handleDelete(event);
	};

	const handleToggleComplete = async (event) => {
		return await todoHandlers.handleToggleComplete(event);
	};

	const handleCreateSubList = async (event) => {
		return await todoHandlers.handleCreateSubList(event, { isEmbedMode, embedAllowAdd });
	};

	const handleRevokeDelegation = async (event) => {
		return await todoHandlers.handleRevokeDelegation(event);
	};

	// Track the last manually-set encryption state to prevent overwrites
	let lastManualEncryptionUpdate = { listName: '', encrypted: false, timestamp: 0 };

	// Reactively update encryption state based on current list
	$: if ($currentTodoListNameStore && $availableTodoListsStore.length > 0) {
		const currentList = $availableTodoListsStore.find(
			(list) => list.displayName === $currentTodoListNameStore
		);

		if (currentList) {
			// Check if we just manually updated this list's encryption state
			const recentlyManuallyUpdated =
				lastManualEncryptionUpdate.listName === $currentTodoListNameStore &&
				Date.now() - lastManualEncryptionUpdate.timestamp < 5000; // 5 second grace period

			if (!recentlyManuallyUpdated) {
				// Update encryption state to match the current database
				const wasEncrypted = isCurrentDbEncrypted;
				isCurrentDbEncrypted = currentList.encryptionEnabled || false;

				// Log state change for debugging
				if (wasEncrypted !== isCurrentDbEncrypted) {
					console.log(
						`🔐 Encryption state changed: ${wasEncrypted} → ${isCurrentDbEncrypted} for list: ${$currentTodoListNameStore}`
					);
				}

				// Reset form state when switching to unencrypted database
				if (!isCurrentDbEncrypted) {
					enableEncryption = false;
					encryptionPassword = '';
				}
			} else {
				console.log(
					`⏭️ Skipping reactive encryption update - recently manually set for ${$currentTodoListNameStore}`
				);
			}
		}
	}

	// Setup database debugging utilities
	setupDatabaseDebug();
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
		layout="footer"
		rememberLabel="Don't show this again on this device"
		proceedButtonText="Accept & Continue"
		appName="Simple Todo"
		logoUrl="/favicon.svg"
		versionString={`${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'} [${typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev'}]`}
		onproceed={(detail) => handleModalClose({ detail })}
	/>
{/if}

<main class="container mx-auto max-w-4xl p-6 pb-28 sm:pb-24">
	{#if !isEmbedMode}
		<AppHeader onQRCodeClick={() => (showQRCodeModal = true)} />
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
				<AddTodoForm on:add={handleAddTodo} delegationEnabled={delegationEnabledForCurrentDb} />
			{/if}
			<TodoList
				todos={$todosStore}
				showTitle={false}
				allowEdit={embedAllowAdd}
				delegationEnabled={delegationEnabledForCurrentDb}
				on:delete={handleDelete}
				on:toggleComplete={handleToggleComplete}
				on:createSubList={handleCreateSubList}
				on:revokeDelegation={handleRevokeDelegation}
			/>
		</div>
	{:else}
		<!-- Normal Mode UI -->
		<!-- Settings -->
		<div class="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
			<button
				type="button"
				class="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50"
				aria-expanded={sectionState.settings}
				on:click={() => toggleSection('settings')}
			>
				<div>
					<h2 class="text-base font-semibold text-gray-900">Settings</h2>
					<p class="text-sm text-gray-500">Users, lists, and encryption</p>
				</div>
				<span
					class="text-gray-500 transition-transform duration-200"
					class:rotate-180={sectionState.settings}
				>
					<svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
							clip-rule="evenodd"
						/>
					</svg>
				</span>
			</button>
			{#if sectionState.settings}
				<div class="border-t border-gray-100 p-4" transition:fade>
					<div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<UsersList />
						</div>
						<div>
							<TodoListSelector />
						</div>
					</div>
					<EncryptionSettings
						{isCurrentDbEncrypted}
						bind:enableEncryption
						bind:encryptionPassword
						currentDbAddress={$currentDbAddressStore}
						currentDbName={$currentDbNameStore}
						currentTodoListName={$currentTodoListNameStore}
						unlockState={$inlineUnlockStore}
						{preferences}
						disabled={!$initializationStore.isInitialized}
						on:encryptionEnabled={(e) => {
							isCurrentDbEncrypted = e.detail.isCurrentDbEncrypted;
							// Mark this as a manual update to prevent reactive overwrite
							lastManualEncryptionUpdate = {
								listName: $currentTodoListNameStore,
								encrypted: e.detail.isCurrentDbEncrypted,
								timestamp: Date.now()
							};
						}}
						on:encryptionDisabled={(e) => {
							isCurrentDbEncrypted = e.detail.isCurrentDbEncrypted;
							// Mark this as a manual update to prevent reactive overwrite
							lastManualEncryptionUpdate = {
								listName: $currentTodoListNameStore,
								encrypted: e.detail.isCurrentDbEncrypted,
								timestamp: Date.now()
							};
						}}
						on:unlockSucceeded={(e) => {
							isCurrentDbEncrypted = e.detail.isCurrentDbEncrypted;
							lastManualEncryptionUpdate = {
								listName: $currentTodoListNameStore,
								encrypted: e.detail.isCurrentDbEncrypted,
								timestamp: Date.now()
							};
						}}
					/>
				</div>
			{/if}
		</div>

		<!-- Passkey Wallet -->
		<div class="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
			<button
				type="button"
				class="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50"
				aria-expanded={sectionState.wallet}
				on:click={() => toggleSection('wallet')}
			>
				<div>
					<h2 class="text-base font-semibold text-gray-900">Passkey Wallet</h2>
					<p class="text-sm text-gray-500">Smart account, wallet address, and local funding</p>
				</div>
				<span
					class="text-gray-500 transition-transform duration-200"
					class:rotate-180={sectionState.wallet}
				>
					<svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
							clip-rule="evenodd"
						/>
					</svg>
				</span>
			</button>
			{#if sectionState.wallet}
				<div class="border-t border-gray-100 p-4" transition:fade>
					<WalletProfile />
				</div>
			{/if}
		</div>

		<!-- Add TODO -->
		<div class="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
			<button
				type="button"
				class="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50"
				aria-expanded={sectionState.addTodo}
				on:click={() => toggleSection('addTodo')}
			>
				<div>
					<h2 class="text-base font-semibold text-gray-900">Add Todo</h2>
					<p class="text-sm text-gray-500">Create tasks, costs, and delegation details</p>
				</div>
				<span
					class="text-gray-500 transition-transform duration-200"
					class:rotate-180={sectionState.addTodo}
				>
					<svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
							clip-rule="evenodd"
						/>
					</svg>
				</span>
			</button>
			{#if sectionState.addTodo}
				<div class="border-t border-gray-100 p-4" transition:fade>
					<AddTodoForm
						on:add={handleAddTodo}
						disabled={!$initializationStore.isInitialized}
						delegationEnabled={delegationEnabledForCurrentDb}
					/>
				</div>
			{/if}
		</div>

		<!-- TODO List -->
		<div class="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
			<button
				type="button"
				class="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50"
				aria-expanded={sectionState.todoList}
				on:click={() => toggleSection('todoList')}
			>
				<div>
					<h2 class="text-base font-semibold text-gray-900">Todo List</h2>
					<p class="text-sm text-gray-500">Current tasks, breadcrumbs, and delegated workflow</p>
				</div>
				<span
					class="text-gray-500 transition-transform duration-200"
					class:rotate-180={sectionState.todoList}
				>
					<svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
							clip-rule="evenodd"
						/>
					</svg>
				</span>
			</button>
			{#if sectionState.todoList}
				<div class="border-t border-gray-100 p-4" transition:fade>
					<BreadcrumbNavigation {preferences} {enableEncryption} {encryptionPassword} />
					<TodoList
						todos={$todosStore}
						delegationEnabled={delegationEnabledForCurrentDb}
						on:delete={handleDelete}
						on:toggleComplete={handleToggleComplete}
						on:createSubList={handleCreateSubList}
						on:revokeDelegation={handleRevokeDelegation}
					/>
				</div>
			{/if}
		</div>

		<!-- Storacha Test Suite - Temporarily disabled
		<StorachaTest />
		-->
	{/if}
</main>

{#if !isEmbedMode}
	<P2PassMount
		orbitdb={$orbitdbStore}
		database={$todoDBStore}
		isInitialized={$initializationStore.isInitialized}
		entryCount={$todosCountStore}
		databaseName={$currentDbNameStore || $currentTodoListNameStore || 'projects'}
		onRestore={handleP2PassRestore}
		onBackup={handleP2PassBackup}
		onAuthenticate={handleP2PassAuthenticate}
		libp2p={$libp2pStore}
	/>
{/if}

<!-- QR Code Modal -->
<QRCodeModal bind:show={showQRCodeModal} />

<!-- App Footer with Peer Info -->
{#if $initializationStore.isInitialized && !isEmbedMode}
	<AppFooter />
{/if}
