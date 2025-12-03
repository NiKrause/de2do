<script>
	import { onMount } from 'svelte';
	import { createEventDispatcher } from 'svelte';
	import {
		isWebAuthnAvailable,
		isPlatformAuthenticatorAvailable,
		hasExistingCredentials,
		createWebAuthnIdentity,
		getWebAuthnCapabilities,
		clearWebAuthnCredentials
	} from '$lib/identity/webauthn-identity.js';

	const dispatch = createEventDispatcher();

	/** @type {boolean} */
	export let show = true;

	/** @type {boolean} */
	export let optional = true; // Whether WebAuthn setup is optional

	let capabilities = {
		available: false,
		platformAuthenticator: false,
		browserName: 'Unknown',
		hasExistingCredentials: false
	};

	let isLoading = false;
	let error = '';
	let success = '';

	onMount(async () => {
		capabilities = await getWebAuthnCapabilities();
	});

	async function handleSetupWebAuthn() {
		isLoading = true;
		error = '';
		success = '';

		try {
			const { identity, credentialInfo } = await createWebAuthnIdentity();
			success = 'WebAuthn credential created successfully!';
			
			// Notify parent component
			dispatch('created', { identity, credentialInfo });
			
			// Update capabilities
			capabilities = await getWebAuthnCapabilities();
			
			setTimeout(() => {
				show = false;
			}, 1500);
		} catch (err) {
			error = err.message || 'Failed to create WebAuthn credential';
			console.error('WebAuthn setup error:', err);
		} finally {
			isLoading = false;
		}
	}

	function handleSkip() {
		dispatch('skip');
		show = false;
	}

	function handleClearCredentials() {
		if (confirm('Are you sure you want to clear your WebAuthn credentials? You will need to create new ones to use hardware authentication.')) {
			clearWebAuthnCredentials();
			capabilities.hasExistingCredentials = false;
			success = 'Credentials cleared. You can now create new ones.';
		}
	}
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
		data-testid="webauthn-setup-modal"
	>
		<div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
			<!-- Header -->
			<div class="mb-4 flex items-center gap-3">
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
					<svg
						class="h-6 w-6 text-blue-600"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
						/>
					</svg>
				</div>
				<div>
					<h2 class="text-xl font-semibold text-gray-900">Hardware-Secured Identity</h2>
					<p class="text-sm text-gray-600">Enhanced security with WebAuthn</p>
				</div>
			</div>

			<!-- Content -->
			<div class="mb-6 space-y-4">
				{#if !capabilities.available}
					<div class="rounded-lg bg-yellow-50 p-4">
						<div class="flex">
							<svg
								class="h-5 w-5 text-yellow-400"
								fill="currentColor"
								viewBox="0 0 20 20"
							>
								<path
									fill-rule="evenodd"
									d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
									clip-rule="evenodd"
								/>
							</svg>
							<div class="ml-3">
								<h3 class="text-sm font-medium text-yellow-800">WebAuthn Not Available</h3>
								<p class="mt-1 text-sm text-yellow-700">
									Your browser doesn't support WebAuthn. You'll use a software-based identity
									instead.
								</p>
							</div>
						</div>
					</div>
				{:else if capabilities.hasExistingCredentials}
					<div class="rounded-lg bg-green-50 p-4">
						<div class="flex">
							<svg
								class="h-5 w-5 text-green-400"
								fill="currentColor"
								viewBox="0 0 20 20"
							>
								<path
									fill-rule="evenodd"
									d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
									clip-rule="evenodd"
								/>
							</svg>
							<div class="ml-3">
								<h3 class="text-sm font-medium text-green-800">Credentials Already Set Up</h3>
								<p class="mt-1 text-sm text-green-700">
									You already have WebAuthn credentials configured. They will be used
									automatically.
								</p>
								<button
									on:click={handleClearCredentials}
									class="mt-2 text-xs text-green-800 underline hover:text-green-900"
								>
									Clear credentials
								</button>
							</div>
						</div>
					</div>
				{:else}
					<div class="space-y-3">
						<div class="rounded-lg bg-blue-50 p-4">
							<h3 class="mb-2 text-sm font-semibold text-blue-900">Benefits:</h3>
							<ul class="space-y-1 text-sm text-blue-800">
								<li class="flex items-start gap-2">
									<svg class="mt-0.5 h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
										<path
											fill-rule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
									<span>Hardware security (TPM, Secure Enclave)</span>
								</li>
								<li class="flex items-start gap-2">
									<svg class="mt-0.5 h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
										<path
											fill-rule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
									<span>Biometric authentication (Touch ID, Face ID)</span>
								</li>
								<li class="flex items-start gap-2">
									<svg class="mt-0.5 h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
										<path
											fill-rule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
									<span>Hardware wallet support (Ledger, YubiKey)</span>
								</li>
								<li class="flex items-start gap-2">
									<svg class="mt-0.5 h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
										<path
											fill-rule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
									<span>No manual key management</span>
								</li>
							</ul>
						</div>

						{#if capabilities.platformAuthenticator}
							<div class="rounded-lg bg-green-50 p-3">
								<p class="text-sm text-green-800">
									✅ Platform authenticator detected ({capabilities.browserName})
								</p>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Error Message -->
				{#if error}
					<div class="rounded-lg bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				<!-- Success Message -->
				{#if success}
					<div class="rounded-lg bg-green-50 p-3">
						<p class="text-sm text-green-800">{success}</p>
					</div>
				{/if}
			</div>

			<!-- Actions -->
			<div class="flex gap-3">
				{#if optional}
					<button
						on:click={handleSkip}
						disabled={isLoading}
						class="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Skip for Now
					</button>
				{/if}

				{#if capabilities.available && !capabilities.hasExistingCredentials}
					<button
						on:click={handleSetupWebAuthn}
						disabled={isLoading}
						class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if isLoading}
							<span class="flex items-center justify-center gap-2">
								<svg
									class="h-4 w-4 animate-spin"
									fill="none"
									viewBox="0 0 24 24"
								>
									<circle
										class="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										stroke-width="4"
									></circle>
									<path
										class="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									></path>
								</svg>
								Setting up...
							</span>
						{:else}
							Set Up WebAuthn
						{/if}
					</button>
				{:else if capabilities.hasExistingCredentials}
					<button
						on:click={handleSkip}
						class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
					>
						Continue
					</button>
				{:else}
					<button
						on:click={handleSkip}
						class="flex-1 rounded-md bg-gray-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
					>
						Continue with Software Identity
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
