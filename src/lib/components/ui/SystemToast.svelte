<script>
	import { toastStore } from '../../toast-store.js';
	import { onMount } from 'svelte';

	let toastElement;
	let isVisible = false;
	let currentToast = null;
	let progressWidth = 100;
	let progressInterval;

	// Subscribe to toast store
	$: if ($toastStore) {
		showToast($toastStore);
	}

	function showToast(toast) {
		if (!toast) return;

		currentToast = toast;
		isVisible = true;
		progressWidth = 100;

		// Clear any existing progress interval
		if (progressInterval) {
			clearInterval(progressInterval);
		}

		// Start progress bar animation
		const duration = toast.duration || 3000;
		const intervalTime = 50; // Update every 50ms
		const decrementAmount = (100 / duration) * intervalTime;

		progressInterval = setInterval(() => {
			progressWidth -= decrementAmount;
			if (progressWidth <= 0) {
				hideToast();
			}
		}, intervalTime);

		// Auto-hide after duration
		setTimeout(() => {
			hideToast();
		}, duration);
	}

	function hideToast() {
		isVisible = false;
		currentToast = null;
		progressWidth = 100;

		if (progressInterval) {
			clearInterval(progressInterval);
			progressInterval = null;
		}

		// Clear the toast from the store
		toastStore.clear();
	}

	function handleClick() {
		hideToast();
	}

	onMount(() => {
		return () => {
			if (progressInterval) {
				clearInterval(progressInterval);
			}
		};
	});
</script>

{#if isVisible && currentToast}
	<div
		bind:this={toastElement}
		class="toast-notification fixed top-4 right-4 z-50 max-w-sm min-w-[320px] transform cursor-pointer transition-all duration-300 ease-in-out"
		class:translate-x-0={isVisible}
		class:translate-x-full={!isVisible}
		on:click={handleClick}
		on:keydown={(e) => e.key === 'Escape' && handleClick()}
		role="button"
		tabindex="0"
		aria-label="Close notification"
	>
		<div
			class="relative overflow-hidden rounded-lg border-l-4 bg-white shadow-lg"
			class:border-green-500={currentToast.type === 'success'}
			class:border-blue-500={currentToast.type === 'info'}
			class:border-yellow-500={currentToast.type === 'warning'}
			class:border-red-500={currentToast.type === 'error'}
			class:border-gray-500={!currentToast.type || currentToast.type === 'default'}
		>
			<!-- Toast content -->
			<div class="px-4 py-3">
				<div class="flex items-start gap-3">
					<!-- Message content (emojis are already included in messages) -->
					<div class="min-w-0 flex-1">
						<p class="text-sm leading-relaxed font-medium text-gray-900">
							{currentToast.message}
						</p>
						{#if currentToast.details}
							<p class="mt-1 text-sm leading-relaxed text-gray-500">
								{currentToast.details}
							</p>
						{/if}
					</div>

					<!-- Close button -->
					<div class="flex-shrink-0">
						<button
							class="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
							on:click|stopPropagation={handleClick}
						>
							<span class="sr-only">Close</span>
							<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
								<path
									d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
								/>
							</svg>
						</button>
					</div>
				</div>
			</div>

			<!-- Progress bar -->
			<div class="absolute bottom-0 left-0 h-1 w-full bg-gray-100">
				<div
					class="h-full rounded-r transition-all duration-75 ease-linear"
					class:bg-green-500={currentToast.type === 'success'}
					class:bg-blue-500={currentToast.type === 'info'}
					class:bg-yellow-500={currentToast.type === 'warning'}
					class:bg-red-500={currentToast.type === 'error'}
					class:bg-gray-500={!currentToast.type || currentToast.type === 'default'}
					style="width: {progressWidth}%"
				></div>
			</div>
		</div>
	</div>
{/if}

<style>
	.toast-notification {
		animation: slideIn 0.3s ease-out;
	}

	@keyframes slideIn {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
</style>
