<script>
	import { passwordManager } from '$lib/password/password-manager.js';
	import PasswordModal from './PasswordModal.svelte';

	// Subscribe to password manager state
	$: state = $passwordManager;

	function handleSubmit(event) {
		const { password } = event.detail;
		passwordManager.submitPassword(password);
	}

	function handleCancel() {
		passwordManager.cancel();
	}
</script>

<PasswordModal
	isOpen={state.showModal}
	dbName={state.dbName}
	retryCount={state.retryCount}
	on:submit={handleSubmit}
	on:cancel={handleCancel}
/>
