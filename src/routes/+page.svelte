<script>
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { initializeP2P, initializationStore } from '$lib/p2p.js';
	import { todosStore, todoDBStore, orbitdbStore } from '$lib/db-actions.js';
	import ConsentModal from '$lib/components/ui/ConsentModal.svelte';
	import WebAuthnSetup from '$lib/components/identity/WebAuthnSetup.svelte';
	import SystemToast from '$lib/components/ui/SystemToast.svelte';
	import LoadingSpinner from '$lib/components/ui/LoadingSpinner.svelte';
	import ErrorAlert from '$lib/components/ui/ErrorAlert.svelte';
	import AddTodoForm from '$lib/components/todo/AddTodoForm.svelte';
	import TodoList from '$lib/components/todo/TodoList.svelte';
	import AppFooter from '$lib/components/layout/AppFooter.svelte';
	import StorachaIntegration from '$lib/components/integration/StorachaIntegration.svelte';
	import QRCodeModal from '$lib/components/ui/QRCodeModal.svelte';
	import TodoListSelector from '$lib/components/todo/TodoListSelector.svelte';
	import UsersList from '$lib/UsersList/index.svelte';
	import BreadcrumbNavigation from '$lib/components/todo/BreadcrumbNavigation.svelte';
	import ManagedPasswordModal from '$lib/components/ui/ManagedPasswordModal.svelte';
	import AppHeader from '$lib/components/layout/AppHeader.svelte';
	import EncryptionSettings from '$lib/components/encryption/EncryptionSettings.svelte';
	import { setupDatabaseDebug } from '$lib/debug/database-debug.js';
	import { createTodoHandlers } from '$lib/handlers/todo-handlers.js';
	import { setupHashRouter } from '$lib/routing/hash-router.js';
	import {
		currentTodoListNameStore,
		currentDbNameStore,
		currentDbAddressStore,
		availableTodoListsStore
	} from '$lib/todo-list-manager.js';
	import { get } from 'svelte/store';
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

	let error = null;

	// Modal state
	let showModal = true;
	let showWebAuthnSetup = false;
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

		// Show WebAuthn setup modal before initializing P2P
		showWebAuthnSetup = true;
	};

	const handleWebAuthnSetupComplete = async (event) => {
		showWebAuthnSetup = false;

		// If WebAuthn credential was created, store flag to use it
		if (event?.detail?.identity) {
			console.log('✅ WebAuthn credential created, will use for P2P initialization');
			// The flag is already stored by the WebAuthn identity module
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
		rememberLabel="Don't show this again on this device"
		proceedButtonText="Accept & Continue"
		on:proceed={handleModalClose}
	/>
{/if}

<!-- WebAuthn Setup Modal - shown after consent -->
{#if showWebAuthnSetup}
	<WebAuthnSetup
		bind:show={showWebAuthnSetup}
		optional={true}
		on:created={handleWebAuthnSetupComplete}
		on:skip={handleWebAuthnSetupComplete}
	/>
{/if}

<!-- Password modal for encrypted databases -->
<ManagedPasswordModal />

<main class="container mx-auto max-w-4xl p-6 pb-20">
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
			<EncryptionSettings
				{isCurrentDbEncrypted}
				bind:enableEncryption
				bind:encryptionPassword
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
			/>
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

<!-- App Footer with Peer Info -->
{#if $initializationStore.isInitialized && !isEmbedMode}
	<AppFooter />
{/if}
