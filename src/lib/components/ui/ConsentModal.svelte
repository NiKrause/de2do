<script>
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	export let show = true;

	// Storage preference toggle
	export let enablePersistentStorage = true;

	// Network connection toggle
	export let enableNetworkConnection = true;

	// Peer connection toggle (only relevant when network is enabled)
	export let enablePeerConnections = true;

	export let proceedButtonText = 'Accept & Continue';
	export let rememberLabel = "Don't show this again";
	export let rememberDecision = false;

	// Toast notification state
	let toastMessage = '';
	let showToast = false;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let toastTimeout;

	/**
	 * @param {string} message
	 */
	const showToastNotification = (message) => {
		toastMessage = message;
		showToast = true;

		// Clear existing timeout
		if (toastTimeout) {
			clearTimeout(toastTimeout);
		}

		// Auto-hide toast after 3 seconds
		toastTimeout = setTimeout(() => {
			showToast = false;
			toastMessage = '';
		}, 3000);
	};

	const handleStorageToggle = () => {
		enablePersistentStorage = !enablePersistentStorage;
		const message = enablePersistentStorage
			? 'Browser storage enabled - your data will be saved locally'
			: 'Browser storage disabled - data will only be kept in memory';
		showToastNotification(message);
	};

	const handleNetworkToggle = () => {
		enableNetworkConnection = !enableNetworkConnection;

		// If disabling network, also disable peer connections
		if (!enableNetworkConnection) {
			enablePeerConnections = false;
		}

		const message = enableNetworkConnection
			? 'Network connection enabled - you can sync with relay servers'
			: 'Network connection disabled - working offline only';
		showToastNotification(message);
	};

	/**
	 * @param {Event & { currentTarget: HTMLInputElement }} event
	 */
	const handlePeerToggle = (event) => {
		enablePeerConnections = event.currentTarget.checked;
		const message = enablePeerConnections
			? 'P2P devices enabled - you can sync directly with other devices'
			: 'P2P devices disabled - only relay server sync available';
		showToastNotification(message);
	};

	const handleProceed = () => {
		show = false;
		dispatch('proceed', {
			enablePersistentStorage,
			enableNetworkConnection,
			enablePeerConnections
		});
	};
</script>

{#if show}
	<!-- Compact Cookie-Style Consent Banner -->
	<div
		class="fixed right-0 bottom-0 left-0 z-50 rounded-t-lg border-t border-gray-300 bg-gradient-to-r from-blue-50 to-indigo-50 shadow-lg sm:bottom-4"
		data-testid="consent-modal"
	>
		<div class="mx-auto max-w-7xl px-4 py-3">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<!-- Left Side: Logo & Settings -->
				<div class="flex items-center gap-4">
					<!-- Logo -->
					<img src="/favicon.svg" alt="Simple TODO" class="h-8 w-8 flex-shrink-0" />

					<!-- Toggles in horizontal row -->
					<div class="flex items-center gap-4">
						<!-- Storage Toggle -->
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium text-gray-700">Storage:</span>
							<button
								on:click={handleStorageToggle}
								aria-label="Toggle browser storage"
								class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none {enablePersistentStorage
									? 'bg-blue-600'
									: 'bg-gray-400'}"
							>
								<span
									class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {enablePersistentStorage
										? 'translate-x-6'
										: 'translate-x-1'}"
								></span>
							</button>
							<span class="text-xs text-gray-600">
								{enablePersistentStorage ? 'On' : 'Off'}
							</span>
						</div>

						<!-- Network Toggle -->
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium text-gray-700">Network:</span>
							<button
								on:click={handleNetworkToggle}
								aria-label="Toggle network connection"
								class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none {enableNetworkConnection
									? 'bg-blue-600'
									: 'bg-gray-400'}"
							>
								<span
									class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {enableNetworkConnection
										? 'translate-x-6'
										: 'translate-x-1'}"
								></span>
							</button>
							<span class="text-xs text-gray-600">
								{enableNetworkConnection ? 'On' : 'Off'}
							</span>
						</div>

						<!-- Peer Connection Checkbox (shown when relay node is enabled) -->
						{#if enableNetworkConnection}
							<div class="flex items-center gap-2">
								<input
									type="checkbox"
									id="peer-connections"
									checked={enablePeerConnections}
									on:change={handlePeerToggle}
									class="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
								/>
								<label for="peer-connections" class="cursor-pointer text-xs text-gray-700">
									P2P Devices
								</label>
							</div>
						{/if}
					</div>
				</div>

				<!-- Right Side: Actions -->
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
					<!-- Version Info -->
					<div class="text-xs text-gray-500">
						v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}
						[{typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev'}]
					</div>

					<div class="flex items-center gap-2">
						<label class="flex cursor-pointer items-center gap-1.5">
							<input
								type="checkbox"
								bind:checked={rememberDecision}
								class="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
							/>
							<span class="text-xs text-gray-700">{rememberLabel}</span>
						</label>
						<button
							on:click={handleProceed}
							class="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
						>
							{proceedButtonText}
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Toast Notification -->
{#if showToast}
	<div
		class="fixed bottom-28 left-1/2 z-[60] -translate-x-1/2 translate-y-0 transform opacity-100 transition-all duration-300 ease-in-out sm:bottom-32"
		role="alert"
		aria-live="polite"
	>
		<div
			class="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg ring-1 ring-gray-200"
		>
			<!-- Icon -->
			<svg
				class="h-5 w-5 text-blue-600"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<!-- Message -->
			<p class="text-sm font-medium text-gray-900">{toastMessage}</p>
		</div>
	</div>
{/if}
