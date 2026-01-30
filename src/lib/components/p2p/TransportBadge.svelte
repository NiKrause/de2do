<script>
	export let transport = '';

	$: badgeConfig = getBadgeConfig(transport);

	function getBadgeConfig(transport) {
		switch (transport) {
			case 'webrtc':
				return {
					label: 'WebRTC',
					classes: 'bg-green-200 text-green-800'
				};
			case 'circuit-relay':
				return {
					label: 'Relay',
					classes: 'bg-blue-200 text-blue-800'
				};
			case 'websocket':
				return {
					label: 'WS',
					classes: 'bg-purple-200 text-purple-800'
				};
			case 'webtransport':
				return {
					label: 'WebTransport',
					classes: 'bg-indigo-200 text-indigo-800'
				};
			case 'tcp':
				return {
					label: 'TCP',
					classes: 'bg-orange-200 text-orange-800'
				};
			default:
				return {
					label: transport,
					classes: 'bg-gray-200 text-gray-800'
				};
		}
	}
</script>

<span class="badge {badgeConfig.classes} rounded-full px-2 py-1 text-xs font-medium">
	{badgeConfig.label}
</span>

<style>
	.badge {
		display: inline-block;
		white-space: nowrap;
	}
</style>
