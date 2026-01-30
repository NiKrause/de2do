<script>
	import { createEventDispatcher } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import QrCode from 'svelte-qrcode';
	import { X } from 'lucide-svelte';

	const dispatch = createEventDispatcher();

	export let show = false;

	let currentUrl = '';

	// Get current URL when component mounts and browser is available
	$: if (browser && show) {
		currentUrl = window.location.href;
	}

	const closeModal = () => {
		show = false;
		dispatch('close');
	};

	// Close on escape key
	const handleKeydown = (event) => {
		if (event.key === 'Escape') {
			closeModal();
		}
	};
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-[10001] bg-black/80 backdrop-blur-sm"
		on:click={closeModal}
		transition:fade={{ duration: 200 }}
		role="button"
		tabindex="0"
		aria-label="Close QR code modal"
		on:keydown={(e) => e.key === 'Enter' && closeModal()}
	>
		<!-- Modal Content -->
		<div
			class="flex min-h-full items-center justify-center p-4"
			on:click|stopPropagation
			on:keydown={(e) => e.key === 'Enter' && e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-labelledby="qr-modal-title"
			tabindex="0"
		>
			<div
				class="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl md:max-w-lg"
				transition:fade={{ duration: 300, delay: 100 }}
			>
				<!-- Close Button -->
				<button
					on:click={closeModal}
					class="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
					aria-label="Close QR code modal"
				>
					<X class="h-4 w-4" />
				</button>

				<!-- Modal Header -->
				<div class="mb-6 text-center">
					<h2 id="qr-modal-title" class="text-2xl font-bold text-gray-900">Simple-Todo Example</h2>
					<p class="mt-2 text-sm text-gray-600">
						Scan with your mobile device to open this page on another device
					</p>
				</div>

				<!-- QR Code -->
				{#if currentUrl}
					<div class="flex justify-center">
						<div class="rounded-xl bg-white p-4 shadow-inner">
							<QrCode
								value={currentUrl}
								size="280"
								background="#FFFFFF"
								color="#000000"
								padding={0}
								errorCorrection="M"
							/>
						</div>
					</div>

					<!-- URL Display -->
					<div class="mt-6">
						<p class="mb-2 text-xs font-medium tracking-wide text-gray-500 uppercase">
							Current URL
						</p>
						<div class="rounded-lg bg-gray-50 p-3 font-mono text-sm break-all text-gray-700">
							{currentUrl}
						</div>
					</div>
				{:else}
					<div class="flex justify-center">
						<div class="h-72 w-72 animate-pulse rounded-xl bg-gray-200"></div>
					</div>
				{/if}

				<!-- Instructions -->
				<div class="mt-6 text-center">
					<p class="text-xs text-gray-500">
						Point your camera at the QR code to open this page on another device
					</p>
				</div>
			</div>
		</div>
	</div>
{/if}
