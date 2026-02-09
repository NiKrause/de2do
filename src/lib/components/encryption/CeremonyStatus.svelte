<script>
	import { onDestroy } from 'svelte';
	import {
		ceremonyStatusStore,
		startMockCeremony,
		stopMockCeremony,
		resetCeremonyStatus
	} from '$lib/ceremony/ceremony-status-store.js';

	export let enabled = false;
	export let keyRef = 'db:default';
	export let autoMock = true;

	let mockStartedForKey = null;
	$: state = $ceremonyStatusStore;

	$: if (enabled && autoMock && mockStartedForKey !== keyRef) {
		startMockCeremony({ keyRef });
		mockStartedForKey = keyRef;
	}

	$: if (!enabled && mockStartedForKey) {
		stopMockCeremony();
		mockStartedForKey = null;
	}

	onDestroy(() => {
		stopMockCeremony();
	});
</script>

{#if enabled}
	<div class="rounded-md border border-blue-200 bg-blue-50 p-3">
		<div class="mb-2 flex items-center justify-between">
			<div class="text-sm font-semibold text-blue-900">Threshold Ceremony Status</div>
			<span
				class="rounded px-2 py-0.5 text-xs font-medium {state.status === 'ready'
					? 'bg-green-100 text-green-800'
					: state.status === 'error'
						? 'bg-red-100 text-red-800'
						: 'bg-yellow-100 text-yellow-800'}"
			>
				{state.status === 'ready' ? 'READY' : state.status === 'error' ? 'ERROR' : 'WAITING'}
			</span>
		</div>

		<div class="grid grid-cols-2 gap-2 text-xs text-blue-900 sm:grid-cols-4">
			<div>
				<div class="font-semibold">Policy</div>
				<div>{state.policy.t}-of-{state.policy.n}</div>
			</div>
			<div>
				<div class="font-semibold">Phase</div>
				<div>{state.phase}</div>
			</div>
			<div>
				<div class="font-semibold">Joined</div>
				<div>{state.joinedCount}/{state.policy.n}</div>
			</div>
			<div>
				<div class="font-semibold">Verified</div>
				<div>{state.verifiedCount}/{state.policy.n}</div>
			</div>
		</div>

		<div class="mt-3 rounded border border-blue-100 bg-white p-2">
			<div class="mb-2 text-xs font-semibold text-blue-800">Devices</div>
			{#if state.devices.length === 0}
				<div class="text-xs text-blue-700">No devices joined yet.</div>
			{:else}
				<div class="space-y-1">
					{#each state.devices as device}
						<div class="flex items-center justify-between rounded bg-blue-50 px-2 py-1 text-xs">
							<span class="font-medium text-blue-900">{device.deviceId}</span>
							<div class="flex items-center gap-2">
								<span class="text-blue-700">{device.role}</span>
								<span
									class="rounded px-1.5 py-0.5 font-medium {device.state === 'ready'
										? 'bg-green-100 text-green-800'
										: device.state === 'offline' || device.state === 'error'
											? 'bg-red-100 text-red-800'
											: 'bg-yellow-100 text-yellow-800'}"
								>
									{device.state}
								</span>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="mt-2 flex justify-end">
			<button
				type="button"
				on:click={() => {
					resetCeremonyStatus();
					mockStartedForKey = null;
					if (enabled && autoMock) {
						startMockCeremony({ keyRef });
						mockStartedForKey = keyRef;
					}
				}}
				class="rounded border border-blue-300 bg-white px-2 py-1 text-xs text-blue-800 hover:bg-blue-100"
			>
				Restart Mock Ceremony
			</button>
		</div>
	</div>
{/if}
