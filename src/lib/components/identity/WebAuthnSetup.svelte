<script>
	import { onMount } from 'svelte';
	import { createEventDispatcher } from 'svelte';
	import {
		createWebAuthnIdentity,
		getWebAuthnCapabilities,
		clearWebAuthnCredentials,
		getStoredCredentialInfos,
		setPreferredWebAuthnMode,
		useExistingWebAuthnCredential
	} from '$lib/identity/webauthn-identity.js';

	const dispatch = createEventDispatcher();

	export let show = true;
	export let optional = true;

	let capabilities = {
		available: false,
		platformAuthenticator: false,
		browserName: 'Unknown',
		hasExistingCredentials: false,
		storedCredentials: [],
		canUseExistingCredential: false
	};

	let storedCredentials = [];
	let isLoading = false;
	let error = '';
	let success = '';
	let selectedMode = 'worker';
	let passkeyName = 'Simple Todo';

	async function refreshCapabilities() {
		capabilities = await getWebAuthnCapabilities();
		selectedMode = capabilities.preferredMode || selectedMode || 'worker';
		storedCredentials = getStoredCredentialInfos();
	}

	function getCredentialSummary(record) {
		const shortId =
			record.credentialId && record.credentialId.length > 16
				? `${record.credentialId.substring(0, 16)}…`
				: record.credentialId;
		return {
			...record,
			shortId,
			modeLabel: record.authMode === 'hardware' ? 'Hardware varsig' : 'Worker keystore'
		};
	}

	onMount(async () => {
		await refreshCapabilities();
	});

	async function handleSetupWebAuthn() {
		isLoading = true;
		error = '';
		success = '';

			try {
				const result = await createWebAuthnIdentity(passkeyName.trim() || 'Simple Todo', {
					mode: selectedMode
				});
			setPreferredWebAuthnMode(selectedMode);
			success =
				selectedMode === 'hardware'
					? 'Hardware passkey created successfully.'
					: 'Worker passkey created successfully.';
			dispatch('created', result);
			await refreshCapabilities();
			setTimeout(() => {
				show = false;
			}, 1200);
		} catch (err) {
			error = err.message || 'Failed to create WebAuthn credential';
			console.error('WebAuthn setup error:', err);
		} finally {
			isLoading = false;
		}
	}

	async function handleUseExisting() {
		isLoading = true;
		error = '';
		success = '';

		try {
			const result = await useExistingWebAuthnCredential({ mode: selectedMode });
			setPreferredWebAuthnMode(result.authMode);
			success =
				result.recoveredFrom === 'local'
					? 'Stored WebAuthn credential found on this device.'
					: 'Recovered existing passkey from this authenticator.';
			dispatch('created', result);
			await refreshCapabilities();
			setTimeout(() => {
				show = false;
			}, 1200);
		} catch (err) {
			error = err.message || 'Failed to use existing WebAuthn credential';
			console.error('WebAuthn recovery error:', err);
		} finally {
			isLoading = false;
		}
	}

	function handleSkip() {
		dispatch('skip');
		show = false;
	}

	function handleClearCredentials(mode = null) {
		if (
			confirm(
				mode === 'hardware'
					? 'Clear locally stored hardware passkey metadata? The passkey itself stays on the authenticator.'
					: mode === 'worker'
						? 'Clear locally stored worker WebAuthn metadata?'
						: 'Clear all locally stored WebAuthn metadata?'
			)
		) {
			clearWebAuthnCredentials(mode);
			success = 'Local WebAuthn metadata cleared.';
			refreshCapabilities();
		}
	}
</script>

{#if show}
	<div
		class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black"
		data-testid="webauthn-setup-modal"
	>
		<div class="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl">
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
					<h2 class="text-xl font-semibold text-gray-900">WebAuthn Identity</h2>
					<p class="text-sm text-gray-600">Create or recover a passkey-backed OrbitDB identity</p>
				</div>
			</div>

			<div class="mb-6 space-y-4">
				{#if !capabilities.available}
					<div class="rounded-lg bg-yellow-50 p-4">
						<h3 class="text-sm font-medium text-yellow-800">WebAuthn Not Available</h3>
						<p class="mt-1 text-sm text-yellow-700">
							Your browser does not support WebAuthn. The app will continue with a software identity.
						</p>
					</div>
				{:else}
						<div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
							<h3 class="mb-3 text-sm font-semibold text-gray-900">Identity mode</h3>
							<div class="space-y-2">
							<label class="flex cursor-pointer items-start gap-2 rounded border border-gray-200 bg-white p-2">
								<input
									type="radio"
									name="auth-mode"
									value="worker"
									bind:group={selectedMode}
									data-testid="auth-mode-worker"
								/>
								<span class="text-sm text-gray-800">
									<strong>Worker mode:</strong> Ed25519 worker/keystore identity unlocked by a WebAuthn passkey.
								</span>
							</label>
							<label class="flex cursor-pointer items-start gap-2 rounded border border-gray-200 bg-white p-2">
								<input
									type="radio"
									name="auth-mode"
									value="hardware"
									bind:group={selectedMode}
									data-testid="auth-mode-hardware"
								/>
								<span class="text-sm text-gray-800">
									<strong>Hardware mode:</strong> varsig identity signed directly by the authenticator.
								</span>
							</label>
							</div>
						</div>

						<div class="rounded-lg border border-gray-200 bg-white p-4">
							<label for="passkey-name" class="mb-2 block text-sm font-semibold text-gray-900">
								Passkey name
							</label>
							<input
								id="passkey-name"
								bind:value={passkeyName}
								type="text"
								maxlength="64"
								placeholder="Simple Todo"
								data-testid="passkey-name-input"
								class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
							/>
							<p class="mt-2 text-xs text-gray-600">
								New passkeys may show this name in Chrome or macOS passkey lists, depending on the platform UI.
							</p>
						</div>

						{#if storedCredentials.length > 0}
						<div class="rounded-lg bg-green-50 p-4">
							<h3 class="text-sm font-medium text-green-800">Existing local WebAuthn metadata</h3>
							<div class="mt-2 space-y-2">
								{#each storedCredentials.map(getCredentialSummary) as credential}
									<div class="rounded bg-green-100/60 p-2 text-xs text-green-900">
										<p><span class="font-semibold">Mode:</span> {credential.modeLabel}</p>
										{#if credential.did}
											<p class="truncate" title={credential.did}>
												<span class="font-semibold">DID:</span> {credential.did}
											</p>
										{/if}
										{#if credential.shortId}
											<p><span class="font-semibold">Credential:</span> {credential.shortId}</p>
										{/if}
										<button
											on:click={() => handleClearCredentials(credential.authMode)}
											class="mt-1 text-xs underline"
											type="button"
										>
											Clear local {credential.authMode} metadata
										</button>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<div class="rounded-lg bg-blue-50 p-4">
						<h3 class="text-sm font-medium text-blue-900">Use an existing passkey</h3>
						<p class="mt-1 text-sm text-blue-800">
							If this browser already has local metadata, it will be reused. Otherwise the app will try a
							discoverable passkey recovery flow on this authenticator.
						</p>
						{#if capabilities.platformAuthenticator}
							<p class="mt-2 text-xs text-blue-700">
								Platform authenticator detected in {capabilities.browserName}.
							</p>
						{/if}
					</div>
				{/if}

				{#if error}
					<div class="rounded-lg bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				{#if success}
					<div class="rounded-lg bg-green-50 p-3">
						<p class="text-sm text-green-800">{success}</p>
					</div>
				{/if}
			</div>

			<div class="flex gap-3">
				{#if optional}
					<button
						on:click={handleSkip}
						disabled={isLoading}
						class="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					>
						Skip for Now
					</button>
				{/if}

				{#if capabilities.available}
					<button
						on:click={handleUseExisting}
						disabled={isLoading || !capabilities.canUseExistingCredential}
						class="flex-1 rounded-md border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
						type="button"
					>
						Use Existing Passkey
					</button>
					<button
						on:click={handleSetupWebAuthn}
						disabled={isLoading}
						class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if isLoading}
							<span class="flex items-center justify-center gap-2">
								<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
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
								Working...
							</span>
						{:else}
							Set Up WebAuthn
						{/if}
					</button>
				{:else}
					<button
						on:click={handleSkip}
						class="flex-1 rounded-md bg-gray-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:outline-none"
					>
						Continue with Software Identity
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
