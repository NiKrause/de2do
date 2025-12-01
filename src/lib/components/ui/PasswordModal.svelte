<script>
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	let password = '';
	let isLoading = false;
	let errorMessage = '';
	let showPassword = false;

	export let isOpen = false;
	export let dbName = '';
	export let retryCount = 0;

	// Debug logging
	$: if (isOpen) {
		console.log('🔐 PasswordModal opened - retryCount:', retryCount);
	}

	async function handleSubmit() {
		if (!password.trim()) {
			errorMessage = 'Please enter a password';
			return;
		}

		isLoading = true;
		errorMessage = '';

		try {
			dispatch('submit', { password });
		} finally {
			isLoading = false;
		}
	}

	function handleCancel() {
		password = '';
		errorMessage = '';
		dispatch('cancel');
	}

	function handleKeydown(e) {
		if (e.key === 'Enter' && !isLoading) {
			handleSubmit();
		}
		if (e.key === 'Escape') {
			handleCancel();
		}
	}

	$: if (!isOpen) {
		password = '';
		errorMessage = '';
		showPassword = false;
	}
</script>

{#if isOpen}
	<div class="modal-overlay">
		<div class="modal-content">
			<div class="modal-header">
				<h2>🔐 Database Password Required</h2>
				<button class="close-btn" on:click={handleCancel} disabled={isLoading}>✕</button>
			</div>

			<div class="modal-body">
				<p class="db-name">Database: <strong>{dbName || 'Unknown'}</strong></p>

				{#if retryCount > 0}
					<div class="warning-message" data-testid="password-retry-warning">
						<span>⚠️ Previous password attempt failed. Please try again.</span>
					</div>
				{/if}

				<div class="form-group">
					<label for="password">Enter password to decrypt this database:</label>
					<div class="password-input-wrapper">
						<input
							id="password"
							type={showPassword ? 'text' : 'password'}
							bind:value={password}
							placeholder="Enter password..."
							disabled={isLoading}
							on:keydown={handleKeydown}
							autocomplete="off"
						/>
						<button
							type="button"
							class="toggle-password"
							on:click={() => (showPassword = !showPassword)}
							disabled={isLoading}
							title={showPassword ? 'Hide password' : 'Show password'}
						>
							{showPassword ? '🙈' : '👁️'}
						</button>
					</div>
					{#if errorMessage}
						<div class="error-message">{errorMessage}</div>
					{/if}
				</div>
			</div>

			<div class="modal-footer">
				<button class="cancel-btn" on:click={handleCancel} disabled={isLoading}>Cancel</button>
				<button class="submit-btn" on:click={handleSubmit} disabled={isLoading}>
					{#if isLoading}
						<span class="spinner"></span> Decrypting...
					{:else}
						Unlock
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		animation: fadeIn 0.2s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal-content {
		background: white;
		border-radius: 12px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
		max-width: 400px;
		width: 90%;
		animation: slideUp 0.3s ease-out;
	}

	@keyframes slideUp {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 20px;
		border-bottom: 1px solid #e0e0e0;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 18px;
		color: #333;
	}

	.close-btn {
		background: none;
		border: none;
		font-size: 24px;
		cursor: pointer;
		color: #666;
		padding: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		transition: background-color 0.2s;
	}

	.close-btn:hover:not(:disabled) {
		background-color: #f0f0f0;
	}

	.close-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.modal-body {
		padding: 20px;
	}

	.db-name {
		margin: 0 0 15px 0;
		font-size: 14px;
		color: #666;
		word-break: break-all;
	}

	.warning-message {
		background-color: #fff3cd;
		border: 1px solid #ffc107;
		border-radius: 6px;
		padding: 10px 12px;
		margin-bottom: 15px;
		font-size: 14px;
		color: #856404;
	}

	.form-group {
		margin-bottom: 0;
	}

	.form-group label {
		display: block;
		margin-bottom: 8px;
		font-size: 14px;
		font-weight: 500;
		color: #333;
	}

	.password-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.password-input-wrapper input {
		width: 100%;
		padding: 10px 40px 10px 12px;
		border: 1px solid #ccc;
		border-radius: 6px;
		font-size: 14px;
		transition: border-color 0.2s;
	}

	.password-input-wrapper input:focus {
		outline: none;
		border-color: #2196f3;
		box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.1);
	}

	.password-input-wrapper input:disabled {
		background-color: #f5f5f5;
		cursor: not-allowed;
	}

	.toggle-password {
		position: absolute;
		right: 10px;
		background: none;
		border: none;
		cursor: pointer;
		padding: 4px;
		font-size: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #666;
	}

	.toggle-password:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.error-message {
		color: #d32f2f;
		font-size: 13px;
		margin-top: 6px;
	}

	.modal-footer {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
		padding: 15px 20px;
		border-top: 1px solid #e0e0e0;
		background-color: #fafafa;
		border-radius: 0 0 12px 12px;
	}

	.cancel-btn,
	.submit-btn {
		padding: 8px 16px;
		border: none;
		border-radius: 6px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.cancel-btn {
		background-color: #e0e0e0;
		color: #333;
	}

	.cancel-btn:hover:not(:disabled) {
		background-color: #d0d0d0;
	}

	.cancel-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.submit-btn {
		background-color: #2196f3;
		color: white;
	}

	.submit-btn:hover:not(:disabled) {
		background-color: #1976d2;
	}

	.submit-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.spinner {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		margin-right: 6px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
