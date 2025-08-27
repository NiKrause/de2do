<script>
	export let error = null;
	export let type = 'error'; // 'error', 'warning', 'info'
	export let dismissible = false;
	export let title = '';

	let visible = true;

	$: alertClasses = getAlertClasses(type);
	$: if (error) visible = true;

	function getAlertClasses(type) {
		const baseClasses = 'px-4 py-3 rounded mb-4 border';

		switch (type) {
			case 'warning':
				return `${baseClasses} bg-yellow-100 border-yellow-400 text-yellow-700`;
			case 'info':
				return `${baseClasses} bg-blue-100 border-blue-400 text-blue-700`;
			default: // error
				return `${baseClasses} bg-red-100 border-red-400 text-red-700`;
		}
	}

	function dismiss() {
		visible = false;
	}
</script>

{#if error && visible}
	<div class={alertClasses}>
		<div class="flex items-start justify-between">
			<div class="flex-1">
				{#if title}
					<div class="mb-1 font-semibold">{title}</div>
				{/if}
				<div>
					{#if typeof error === 'string'}
						{error}
					{:else}
						Error: {error}
					{/if}
				</div>
			</div>
			{#if dismissible}
				<button
					on:click={dismiss}
					class="ml-2 text-lg font-bold opacity-70 hover:opacity-100"
					aria-label="Dismiss"
				>
					×
				</button>
			{/if}
		</div>
	</div>
{/if}
