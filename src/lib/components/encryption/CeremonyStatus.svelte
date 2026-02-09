<script>
	import { onDestroy } from 'svelte';
	import {
		ceremonyStatusStore,
		startMockCeremony,
		stopMockCeremony,
		resetCeremonyStatus,
		startRealtimeCeremony,
		stopRealtimeCeremony,
		createCeremonyInviteToken,
		joinCeremonyWithInviteToken
	} from '$lib/ceremony/ceremony-status-store.js';
	import { getLocalDeviceId, getLocalRole } from '$lib/ceremony/ceremony-channel.js';

	export let enabled = false;
	export let keyRef = 'db:default';
	export let autoMock = true;
	export let preferRealtime = true;

	let mockStartedForKey = null;
	let inviteToken = '';
	let joinToken = '';
	let inviteMessage = '';
	let inviteError = '';
	$: state = $ceremonyStatusStore;
	let localRole = getLocalRole();
	const localDeviceId = getLocalDeviceId();
	$: localDeviceJoined = state.devices.some((device) => device.deviceId === localDeviceId);
	$: ceremonyParticipantTargetReached = state.joinedCount >= state.policy.n;
	$: hideJoinInput = localDeviceJoined && ceremonyParticipantTargetReached;
	$: canCreateInvite = localRole === 'desktop';

	const copyToClipboard = async (value) => {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(value);
			return;
		}
		throw new Error('Clipboard API unavailable');
	};

	const handleCreateInvite = async () => {
		inviteError = '';
		inviteMessage = '';
		try {
			const { token, expiresAt } = createCeremonyInviteToken({ keyRef });
			inviteToken = token;
			await copyToClipboard(token);
			inviteMessage = `Invite copied. Expires at ${expiresAt}.`;
		} catch (error) {
			inviteError = error?.message || 'Failed to create invite token.';
		}
	};

	const handleJoinWithToken = async () => {
		inviteError = '';
		inviteMessage = '';
		try {
			const parsed = await joinCeremonyWithInviteToken(joinToken, { startRealtime: true });
			inviteMessage = `Joined ceremony ${parsed.ceremonyId}.`;
		} catch (error) {
			inviteError = error?.message || 'Failed to join with invite token.';
		}
	};

	const handleRoleChange = () => {
		if (typeof window === 'undefined') return;
		window.localStorage.setItem('threshold.localDeviceRole', localRole);
		inviteMessage = `Role set to ${localRole}.`;
		inviteError = '';
		resetCeremonyStatus();
		mockStartedForKey = null;
		if (enabled) {
			if (preferRealtime) {
				startRealtimeCeremony({ keyRef, fallbackToMock: autoMock });
			} else if (autoMock) {
				startMockCeremony({ keyRef });
			}
			mockStartedForKey = keyRef;
		}
	};

	$: if (enabled && mockStartedForKey !== keyRef) {
		if (preferRealtime) {
			startRealtimeCeremony({ keyRef, fallbackToMock: autoMock });
		} else if (autoMock) {
			startMockCeremony({ keyRef });
		}
		mockStartedForKey = keyRef;
	}

	$: if (!enabled && mockStartedForKey) {
		stopRealtimeCeremony();
		stopMockCeremony();
		mockStartedForKey = null;
	}

	onDestroy(() => {
		stopRealtimeCeremony();
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
					if (enabled) {
						if (preferRealtime) {
							startRealtimeCeremony({ keyRef, fallbackToMock: autoMock });
						} else if (autoMock) {
							startMockCeremony({ keyRef });
						}
						mockStartedForKey = keyRef;
					}
				}}
				class="rounded border border-blue-300 bg-white px-2 py-1 text-xs text-blue-800 hover:bg-blue-100"
			>
				Restart Mock Ceremony
			</button>
		</div>

		<div class="mt-3 rounded border border-blue-100 bg-white p-2">
			<div class="mb-2 text-xs font-semibold text-blue-800">Invite Token (Experimental)</div>
			<div class="flex flex-col gap-2">
				<label class="text-[11px] font-semibold text-blue-800" for="local-role">
					Local role
				</label>
				<select
					id="local-role"
					bind:value={localRole}
					on:change={handleRoleChange}
					class="w-full rounded border border-blue-200 bg-white px-2 py-1 text-xs text-blue-900"
				>
					<option value="desktop">desktop (initiator)</option>
					<option value="phone-a">phone-a</option>
					<option value="phone-b">phone-b</option>
				</select>
				{#if canCreateInvite}
					<button
						type="button"
						on:click={handleCreateInvite}
						class="self-start rounded border border-blue-300 bg-white px-2 py-1 text-xs text-blue-800 hover:bg-blue-100"
					>
						Create & Copy Invite
					</button>
				{/if}
				{#if inviteToken}
					<textarea
						readonly
						rows="2"
						class="w-full rounded border border-blue-200 bg-blue-50 px-2 py-1 font-mono text-[11px] text-blue-900"
						value={inviteToken}
					/>
				{/if}
				{#if hideJoinInput}
					<div class="text-[11px] text-blue-700">
						This device is already joined and participant target is reached.
					</div>
				{:else}
					<label class="text-[11px] font-semibold text-blue-800" for="join-ceremony-token">
						Join with token
					</label>
					<textarea
						id="join-ceremony-token"
						rows="2"
						bind:value={joinToken}
						placeholder="Paste invite token from another device"
						class="w-full rounded border border-blue-200 bg-white px-2 py-1 font-mono text-[11px] text-blue-900"
					/>
					<button
						type="button"
						on:click={handleJoinWithToken}
						disabled={!joinToken.trim()}
						class="self-start rounded border border-blue-300 bg-white px-2 py-1 text-xs text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Join Ceremony
					</button>
				{/if}
				{#if inviteMessage}
					<div class="text-[11px] text-green-700">{inviteMessage}</div>
				{/if}
				{#if inviteError}
					<div class="text-[11px] text-red-700">{inviteError}</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
