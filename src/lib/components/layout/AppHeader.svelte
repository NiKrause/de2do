<script>
	import SocialIcons from '$lib/components/ui/SocialIcons.svelte';
	import ShareEmbedButtons from '$lib/components/todo/ShareEmbedButtons.svelte';

	export let onQRCodeClick = () => {};
</script>

<header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
	<div class="flex-1">
		<h1 class="text-2xl font-bold text-gray-800 sm:text-3xl">De2do</h1>
		<p class="mt-1 text-sm text-gray-500">
			Permissionless Decentralised Collaboration <br>Founding the DeCol Economy v{typeof __APP_VERSION__ !==
			'undefined'
				? __APP_VERSION__
				: '0.0.0'} [{typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev'}]
		</p>
	</div>
	<div class="flex flex-shrink-0 items-center gap-4 self-start sm:self-auto">
		<ShareEmbedButtons />
		<SocialIcons size="w-5 h-5" className="" {onQRCodeClick} />
	</div>
</header>
