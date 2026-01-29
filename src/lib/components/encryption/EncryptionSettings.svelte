<script>
	import { createEventDispatcher } from 'svelte';
	import { createEncryptionHandlers } from '$lib/handlers/encryption-handlers.js';
	import { isWebAuthnEncryptionAvailable } from '$lib/encryption/webauthn-encryption.js';

	export let isCurrentDbEncrypted = false;
	export let enableEncryption = false;
	export let encryptionPassword = '';
	export let preferences = {};
	export let disabled = false;

	const dispatch = createEventDispatcher();

	// Create encryption handlers
	$: encryptionHandlers = createEncryptionHandlers({ preferences });
	$: webauthnEncryptionAvailable = isWebAuthnEncryptionAvailable();
	let useWebAuthnPreferred = null;
	$: if (webauthnEncryptionAvailable === false) {
		useWebAuthnPreferred = false;
	} else if (webauthnEncryptionAvailable === true && useWebAuthnPreferred === null) {
		useWebAuthnPreferred = true;
	}

	async function handleDisableClick() {
		const result = await encryptionHandlers.handleDisableEncryption('');

		if (result.success) {
			// Update parent state
			enableEncryption = false;
			encryptionPassword = '';

			// Dispatch event to parent
			dispatch('encryptionDisabled', { isCurrentDbEncrypted: result.isCurrentDbEncrypted });
		}
	}

	async function handleEnableClick() {
		console.log('🔐 EncryptionSettings: handleEnableClick called');
		const result = await encryptionHandlers.handleEnableEncryption(encryptionPassword, {
			preferWebAuthn: useWebAuthnPreferred
		});
		console.log('🔐 EncryptionSettings: handler result =', result);

		if (result.success) {
			console.log('✅ EncryptionSettings: Encryption enabled successfully, dispatching event');
			// Update parent state
			enableEncryption = false; // Reset checkbox
			// Don't clear password yet - keep it for display

			// Dispatch event to parent
			dispatch('encryptionEnabled', {
				isCurrentDbEncrypted: result.isCurrentDbEncrypted,
				password: encryptionPassword
			});
			console.log(
				'✅ EncryptionSettings: Event dispatched, isCurrentDbEncrypted =',
				result.isCurrentDbEncrypted
			);

			// Now clear password field after event is dispatched
			setTimeout(() => {
				encryptionPassword = '';
			}, 100);
		} else {
			console.error('❌ EncryptionSettings: Encryption failed, result =', result);
		}
	}

	function handleKeyDown(e) {
		if (
			e.key === 'Enter' &&
			(encryptionPassword.trim() || webauthnEncryptionAvailable) &&
			!disabled
		) {
			e.preventDefault();
			handleEnableClick();
		}
	}
</script>

<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
	{#if isCurrentDbEncrypted}
		<!-- Encryption is active - show status -->
		<div
			data-testid="encryption-active-indicator"
			class="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2"
		>
			<span class="text-green-600">🔐</span>
			<span class="text-sm font-medium text-green-800">Encryption: Active</span>
		</div>
		<button
			type="button"
			on:click={handleDisableClick}
			{disabled}
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
				Without encryption, the todo list will be visible unencrypted on the internet and might be
				wanted or not wanted.
			</div>
		</div>
		{#if enableEncryption}
			{#if webauthnEncryptionAvailable}
				<div class="flex items-center gap-3 text-sm text-gray-700">
					<span class="font-medium">Use</span>
					<label class="flex items-center gap-2">
						<input
							type="radio"
							name="encryption-method"
							class="h-4 w-4 text-blue-600 focus:ring-blue-500"
							bind:group={useWebAuthnPreferred}
							value={true}
						/>
						<span>WebAuthn</span>
					</label>
					<label class="flex items-center gap-2">
						<input
							type="radio"
							name="encryption-method"
							class="h-4 w-4 text-blue-600 focus:ring-blue-500"
							bind:group={useWebAuthnPreferred}
							value={false}
						/>
						<span>Password</span>
					</label>
				</div>
			{/if}
			<div class="flex-1">
				<label for="encryption-password" class="mb-1 block text-sm font-medium text-gray-700">
					Encryption Password
				</label>
				<input
					id="encryption-password"
					type="password"
					bind:value={encryptionPassword}
					placeholder={
						webauthnEncryptionAvailable && useWebAuthnPreferred
							? 'Enter password (optional if WebAuthn is available)'
							: 'Enter password for encryption'
					}
					on:keydown={handleKeyDown}
					class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
				/>
			</div>
			<button
				id="apply-encryption-button"
				type="button"
				on:click={handleEnableClick}
				disabled={
					disabled ||
					(!encryptionPassword.trim() &&
						(!webauthnEncryptionAvailable || !useWebAuthnPreferred))
				}
				class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if webauthnEncryptionAvailable && useWebAuthnPreferred && !encryptionPassword.trim()}
					Use WebAuthn Encryption
				{:else}
					Apply Encryption
				{/if}
			</button>
		{/if}
	{/if}
</div>
