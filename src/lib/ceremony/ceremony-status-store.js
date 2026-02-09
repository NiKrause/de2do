import { writable } from 'svelte/store';

const initialState = {
	ceremonyId: null,
	keyRef: null,
	epoch: null,
	policy: { t: 2, n: 3 },
	phase: 'init',
	status: 'idle',
	joinedCount: 0,
	ackCount: 0,
	verifiedCount: 0,
	devices: [],
	events: [],
	lastUpdatedAt: null
};

const state = writable({ ...initialState });

let mockTimers = [];
let startedMock = false;

const nowIso = () => new Date().toISOString();

const clearMockTimers = () => {
	for (const timer of mockTimers) {
		clearTimeout(timer);
	}
	mockTimers = [];
};

const appendEvent = (current, event) => {
	const nextEvents = [...current.events, { ...event, seenAt: nowIso() }];
	if (nextEvents.length > 200) {
		return nextEvents.slice(nextEvents.length - 200);
	}
	return nextEvents;
};

const updateDevice = (devices, deviceId, patch) => {
	const index = devices.findIndex((device) => device.deviceId === deviceId);
	if (index === -1) {
		return [
			...devices,
			{
				deviceId,
				role: patch.role || 'unknown',
				state: patch.state || 'discovered',
				lastSeen: patch.lastSeen || nowIso()
			}
		];
	}
	const next = [...devices];
	next[index] = {
		...next[index],
		...patch,
		lastSeen: patch.lastSeen || nowIso()
	};
	return next;
};

const recalcCounts = (current) => {
	const joinedCount = current.devices.filter((device) =>
		['joined', 'share_received', 'verified', 'ready'].includes(device.state)
	).length;
	const ackCount = current.devices.filter((device) =>
		['share_received', 'verified', 'ready'].includes(device.state)
	).length;
	const verifiedCount = current.devices.filter((device) =>
		['verified', 'ready'].includes(device.state)
	).length;
	return { joinedCount, ackCount, verifiedCount };
};

const applyCeremonyEvent = (event) => {
	state.update((current) => {
		let next = {
			...current,
			events: appendEvent(current, event),
			lastUpdatedAt: nowIso()
		};

		switch (event.type) {
			case 'threshold.ceremony.init':
				next = {
					...next,
					ceremonyId: event.ceremonyId,
					keyRef: event.keyRef,
					epoch: event.epoch ?? 1,
					policy: event.policy || next.policy,
					phase: 'collecting_joins',
					status: 'waiting'
				};
				break;
			case 'threshold.ceremony.join':
				next.devices = updateDevice(next.devices, event.deviceId, {
					role: event.role,
					state: 'joined'
				});
				break;
			case 'threshold.share.envelope':
				next.phase = 'distributing_shares';
				next.devices = updateDevice(next.devices, event.to, {
					role: event.role,
					state: 'share_received'
				});
				break;
			case 'threshold.ceremony.ack':
				next.devices = updateDevice(next.devices, event.deviceId, {
					role: event.role,
					state: 'verified'
				});
				next.phase = 'verifying_shares';
				break;
			case 'threshold.ceremony.finalize':
				next.phase = 'ready';
				next.status = 'ready';
				next.devices = next.devices.map((device) => ({
					...device,
					state: device.state === 'offline' ? 'offline' : 'ready',
					lastSeen: nowIso()
				}));
				break;
			case 'threshold.peer.offline':
				next.devices = updateDevice(next.devices, event.deviceId, {
					role: event.role,
					state: 'offline'
				});
				break;
			case 'threshold.ceremony.error':
				next.phase = 'error';
				next.status = 'error';
				next.devices = updateDevice(next.devices, event.deviceId || 'unknown', {
					role: event.role || 'unknown',
					state: 'error'
				});
				break;
			default:
				break;
		}

		const counts = recalcCounts(next);
		return { ...next, ...counts };
	});
};

const resetCeremonyStatus = () => {
	clearMockTimers();
	startedMock = false;
	state.set({ ...initialState });
};

const makeId = () => {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	return `ceremony-${Date.now()}`;
};

const getLocalDeviceRole = () => {
	if (typeof window === 'undefined') return 'desktop';
	const stored = window.localStorage.getItem('threshold.localDeviceRole');
	if (stored) return stored;
	const role = /mobile|android|iphone|ipad/i.test(window.navigator.userAgent) ? 'phone-a' : 'desktop';
	window.localStorage.setItem('threshold.localDeviceRole', role);
	return role;
};

const startMockCeremony = ({ keyRef = 'db:default' } = {}) => {
	if (startedMock) return;
	startedMock = true;
	clearMockTimers();

	const ceremonyId = makeId();
	const localRole = getLocalDeviceRole();
	const localDeviceId = `${localRole}-local`;
	const epoch = 1;

	applyCeremonyEvent({
		type: 'threshold.ceremony.init',
		ceremonyId,
		keyRef,
		epoch,
		policy: { t: 2, n: 3 }
	});

	applyCeremonyEvent({
		type: 'threshold.ceremony.join',
		ceremonyId,
		deviceId: localDeviceId,
		role: localRole
	});

	mockTimers.push(
		setTimeout(() => {
			applyCeremonyEvent({
				type: 'threshold.ceremony.join',
				ceremonyId,
				deviceId: 'phone-a',
				role: 'phone-a'
			});
		}, 900)
	);

	mockTimers.push(
		setTimeout(() => {
			applyCeremonyEvent({
				type: 'threshold.ceremony.join',
				ceremonyId,
				deviceId: 'phone-b',
				role: 'phone-b'
			});
		}, 1600)
	);

	mockTimers.push(
		setTimeout(() => {
			applyCeremonyEvent({
				type: 'threshold.share.envelope',
				ceremonyId,
				to: 'phone-a',
				role: 'phone-a'
			});
			applyCeremonyEvent({
				type: 'threshold.share.envelope',
				ceremonyId,
				to: 'phone-b',
				role: 'phone-b'
			});
		}, 2500)
	);

	mockTimers.push(
		setTimeout(() => {
			applyCeremonyEvent({
				type: 'threshold.ceremony.ack',
				ceremonyId,
				deviceId: localDeviceId,
				role: localRole
			});
			applyCeremonyEvent({
				type: 'threshold.ceremony.ack',
				ceremonyId,
				deviceId: 'phone-a',
				role: 'phone-a'
			});
			applyCeremonyEvent({
				type: 'threshold.ceremony.ack',
				ceremonyId,
				deviceId: 'phone-b',
				role: 'phone-b'
			});
		}, 3300)
	);

	mockTimers.push(
		setTimeout(() => {
			applyCeremonyEvent({
				type: 'threshold.ceremony.finalize',
				ceremonyId
			});
		}, 4200)
	);
};

const stopMockCeremony = () => {
	clearMockTimers();
	startedMock = false;
};

export const ceremonyStatusStore = {
	subscribe: state.subscribe
};

export {
	applyCeremonyEvent,
	resetCeremonyStatus,
	startMockCeremony,
	stopMockCeremony
};
