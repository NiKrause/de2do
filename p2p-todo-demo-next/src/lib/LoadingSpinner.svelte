<script>
	export let message = 'Loading...';
	export let submessage = '';
	export let version = '';
	export let size = 'medium'; // 'small', 'medium', 'large'

	$: spinnerClasses = getSpinnerClasses(size);

	function getSpinnerClasses(size) {
		switch (size) {
			case 'small':
				return 'h-4 w-4 border-2';
			case 'large':
				return 'h-12 w-12 border-4';
			default: // medium
				return 'h-8 w-8 border-b-2';
		}
	}
</script>

<div class="py-8 text-center">
	<div class="animate-spin rounded-full {spinnerClasses} mx-auto border-blue-600"></div>
	<p class="mt-4 text-gray-600">{message}</p>
	{#if submessage}
		<p class="mt-2 text-xs text-gray-400">{submessage}</p>
	{/if}
	{#if version}
		<p class="mt-2 text-xs text-gray-400">v{version}</p>
	{/if}
</div>
