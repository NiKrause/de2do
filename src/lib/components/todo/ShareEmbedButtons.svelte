<script>
	import { Share2, Code, Copy, Check, X } from 'lucide-svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { currentTodoListNameStore } from '$lib/todo-list-manager.js';
	import { currentDbAddressStore } from '$lib/stores.js';
	import { toastStore } from '$lib/toast-store.js';

	let showEmbedModal = false;
	let copied = false;
	let allowAddTodos = false;
	let embedCode = '';

	$: if (browser && $currentDbAddressStore) {
		const currentUrl = window.location.origin + window.location.pathname;
		const address = encodeURIComponent($currentDbAddressStore);
		const queryParam = allowAddTodos ? '?allowAdd=true' : '';
		embedCode = `<iframe src="${currentUrl}#/embed/${address}${queryParam}" width="100%" height="600" frameborder="0" allowtransparency="true"></iframe>`;
	}

	async function copyShareLink() {
		if (!browser || !$currentDbAddressStore) return;

		const currentUrl = window.location.origin + window.location.pathname;
		const hash = `#/${$currentDbAddressStore}`;
		const fullUrl = currentUrl + hash;

		try {
			await navigator.clipboard.writeText(fullUrl);
			copied = true;
			toastStore.show('✅ Link copied to clipboard!', 'success');
			setTimeout(() => (copied = false), 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
			toastStore.show('❌ Failed to copy link', 'error');
		}
	}

	async function copyEmbedCode() {
		if (!embedCode) return;

		try {
			await navigator.clipboard.writeText(embedCode);
			copied = true;
			toastStore.show('✅ Embed code copied to clipboard!', 'success');
			setTimeout(() => (copied = false), 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
			toastStore.show('❌ Failed to copy embed code', 'error');
		}
	}

	function openShareDialog() {
		if (!browser || !$currentDbAddressStore) return;

		const currentUrl = window.location.origin + window.location.pathname;
		const hash = `#/${$currentDbAddressStore}`;
		const fullUrl = currentUrl + hash;
		const listName = $currentTodoListNameStore || 'Todo List';

		if (navigator.share) {
			navigator
				.share({
					title: `${listName} - Simple TODO`,
					text: `Check out this todo list: ${listName}`,
					url: fullUrl
				})
				.catch((err) => {
					if (err.name !== 'AbortError') {
						console.error('Share failed:', err);
					}
				});
		} else {
			// Fallback to copy
			copyShareLink();
		}
	}

	function closeEmbedModal() {
		showEmbedModal = false;
		copied = false;
		allowAddTodos = false; // Reset to default when closing
	}

	function handleKeydown(event) {
		if (event.key === 'Escape') {
			closeEmbedModal();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="flex items-center gap-2">
	<!-- Share Button -->
	<button
		on:click={openShareDialog}
		disabled={!$currentDbAddressStore}
		class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
		title="Share this todo list"
		aria-label="Share todo list"
	>
		<Share2 class="h-4 w-4" />
		<span class="hidden sm:inline">Share</span>
	</button>

	<!-- Embed Button -->
	<button
		on:click={() => (showEmbedModal = true)}
		disabled={!$currentDbAddressStore}
		class="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
		title="Get embed code"
		aria-label="Get embed code"
	>
		<Code class="h-4 w-4" />
		<span class="hidden sm:inline">Embed</span>
	</button>
</div>

<!-- Embed Modal -->
{#if showEmbedModal}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-[10002] bg-black/50 backdrop-blur-sm"
		on:click={closeEmbedModal}
		transition:fade={{ duration: 200 }}
		role="button"
		tabindex="0"
		aria-label="Close embed modal"
		on:keydown={(e) => e.key === 'Enter' && closeEmbedModal()}
	>
		<!-- Modal Content -->
		<div
			class="fixed top-1/2 left-1/2 z-[10003] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-2xl"
			on:click|stopPropagation
			on:keydown|stopPropagation
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="embed-modal-title"
		>
			<!-- Close Button -->
			<button
				on:click={closeEmbedModal}
				class="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
				aria-label="Close embed modal"
			>
				<X class="h-4 w-4" />
			</button>

			<!-- Modal Header -->
			<h2 id="embed-modal-title" class="mb-4 pr-8 text-xl font-bold text-gray-900">
				Embed Todo List
			</h2>
			<p class="mb-4 text-sm text-gray-600">
				Copy this code to embed this todo list on your website:
			</p>

			<!-- Embed Options -->
			<div class="mb-4">
				<label class="flex cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						bind:checked={allowAddTodos}
						class="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
					/>
					<span class="text-sm font-medium text-gray-700">Allow adding todos</span>
				</label>
				<p class="mt-1 ml-6 text-xs text-gray-500">
					When enabled, users can add new todos directly in the embedded view
				</p>
			</div>

			<!-- Embed Code -->
			<div class="mb-4">
				<div class="mb-2 flex items-center justify-between">
					<label for="embed-code-textarea" class="text-sm font-medium text-gray-700"
						>Embed Code</label
					>
					<button
						on:click={copyEmbedCode}
						class="flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-50"
					>
						{#if copied}
							<Check class="h-3 w-3" />
							<span>Copied!</span>
						{:else}
							<Copy class="h-3 w-3" />
							<span>Copy</span>
						{/if}
					</button>
				</div>
				<textarea
					id="embed-code-textarea"
					readonly
					value={embedCode}
					class="w-full rounded-md border border-gray-300 bg-gray-50 p-3 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
					rows="4"
					on:click={(e) => e.target.select()}
				></textarea>
			</div>

			<!-- Preview Info -->
			<div class="mb-4 rounded-md bg-blue-50 p-3 text-sm text-blue-800">
				<p class="font-medium">Preview:</p>
				<p class="mt-1 text-xs">
					The embedded todo list will automatically sync with the original list.
					{allowAddTodos
						? 'Users can add, edit, and delete todos.'
						: 'By default, the list is read-only (no add form or titles shown).'}
				</p>
			</div>

			<!-- Actions -->
			<div class="flex justify-end gap-2">
				<button
					on:click={closeEmbedModal}
					class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
