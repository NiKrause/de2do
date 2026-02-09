import { get, writable } from 'svelte/store';
import {
	startCeremonyChannel,
	stopCeremonyChannel,
	publishCeremonyEvent,
	getLocalDeviceId,
	getLocalRole
} from './ceremony-channel.js';

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
let realtimeActive = false;
let realtimeFallbackTimer = null;
let channelHandle = null;
let currentRealtimeKeyRef = null;

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
	if (realtimeFallbackTimer) clearTimeout(realtimeFallbackTimer);
	realtimeFallbackTimer = null;
	state.set({ ...initialState });
};

const makeId = () => {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	return `ceremony-${Date.now()}`;
};

const encodeBase64Url = (value) => {
	const binary = typeof window !== 'undefined'
		? window.btoa(value)
		: Buffer.from(value, 'utf8').toString('base64');
	return binary.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const decodeBase64Url = (value) => {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
	const base64 = normalized + padding;
	if (typeof window !== 'undefined') return window.atob(base64);
	return Buffer.from(base64, 'base64').toString('utf8');
};

const makeInviteToken = ({
	keyRef = 'db:default',
	epoch = 1,
	policy = { t: 2, n: 3 },
	ttlMs = 10 * 60 * 1000
} = {}) => {
	const payload = {
		v: 1,
		ceremonyId: makeId(),
		keyRef,
		epoch,
		policy,
		exp: Date.now() + ttlMs
	};
	return encodeBase64Url(JSON.stringify(payload));
};

const parseInviteToken = (token) => {
	if (!token || typeof token !== 'string') {
		throw new Error('Invite token is required');
	}
	let payload;
	try {
		payload = JSON.parse(decodeBase64Url(token.trim()));
	} catch {
		throw new Error('Invalid invite token format');
	}

	if (!payload?.ceremonyId || !payload?.keyRef || !payload?.exp) {
		throw new Error('Invite token missing required fields');
	}
	if (Date.now() > payload.exp) {
		throw new Error('Invite token expired');
	}
	return payload;
};

const emitInitAndJoin = async ({ ceremonyId, keyRef, epoch = 1, policy = { t: 2, n: 3 } }) => {
	const localDeviceId = getLocalDeviceId();
	const localRole = getLocalRole();
	const initEvent = {
		type: 'threshold.ceremony.init',
		ceremonyId,
		keyRef,
		epoch,
		policy,
		ts: Date.now()
	};
	const joinEvent = {
		type: 'threshold.ceremony.join',
		ceremonyId,
		deviceId: localDeviceId,
		role: localRole,
		keyRef,
		ts: Date.now()
	};

	// Apply locally first so local UI state is deterministic.
	applyCeremonyEvent(initEvent);
	applyCeremonyEvent(joinEvent);

	await publishCeremonyEvent(initEvent);
	await publishCeremonyEvent(joinEvent);
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

const startRealtimeCeremony = ({ keyRef = 'db:default', fallbackToMock = true } = {}) => {
	if (realtimeActive) return;
	realtimeActive = true;
	currentRealtimeKeyRef = keyRef;
	stopMockCeremony();

	channelHandle = startCeremonyChannel({
		keyRef,
		onEvent: (event) => {
			if (!event || typeof event !== 'object') return;
			const current = get(state);
			const eventKeyRef = event.keyRef || current.keyRef;
			if (eventKeyRef && eventKeyRef !== keyRef) return;
			applyCeremonyEvent(event);
		},
		statusHandler: (status) => {
			if (status?.connected && realtimeFallbackTimer) {
				clearTimeout(realtimeFallbackTimer);
				realtimeFallbackTimer = null;
			}
		}
	});

	const current = get(state);
	const currentCeremonyId = current.keyRef === keyRef && current.ceremonyId ? current.ceremonyId : null;
	void emitInitAndJoin({
		ceremonyId: currentCeremonyId || `live-${keyRef}`,
		keyRef,
		epoch: current.epoch || 1,
		policy: current.policy || { t: 2, n: 3 }
	});

	if (fallbackToMock) {
		realtimeFallbackTimer = setTimeout(() => {
			if (!startedMock && realtimeActive) {
				startMockCeremony({ keyRef });
			}
		}, 2500);
	}
};

const stopRealtimeCeremony = () => {
	realtimeActive = false;
	currentRealtimeKeyRef = null;
	if (realtimeFallbackTimer) clearTimeout(realtimeFallbackTimer);
	realtimeFallbackTimer = null;
	if (channelHandle) channelHandle.stop();
	channelHandle = null;
	stopCeremonyChannel();
};

const createCeremonyInviteToken = ({ keyRef = null, ttlMs = 10 * 60 * 1000 } = {}) => {
	const current = get(state);
	const resolvedKeyRef = keyRef || currentRealtimeKeyRef || current.keyRef || 'db:default';
	const token = makeInviteToken({
		keyRef: resolvedKeyRef,
		epoch: current.epoch || 1,
		policy: current.policy || { t: 2, n: 3 },
		ttlMs
	});
	return {
		token,
		keyRef: resolvedKeyRef,
		expiresAt: new Date(Date.now() + ttlMs).toISOString()
	};
};

const joinCeremonyWithInviteToken = async (token, { startRealtime = true } = {}) => {
	const parsed = parseInviteToken(token);
	if (startRealtime && (!realtimeActive || currentRealtimeKeyRef !== parsed.keyRef)) {
		startRealtimeCeremony({ keyRef: parsed.keyRef, fallbackToMock: false });
	}
	await emitInitAndJoin({
		ceremonyId: parsed.ceremonyId,
		keyRef: parsed.keyRef,
		epoch: parsed.epoch || 1,
		policy: parsed.policy || { t: 2, n: 3 }
	});
	return parsed;
};

export const ceremonyStatusStore = {
	subscribe: state.subscribe
};

export {
	applyCeremonyEvent,
	resetCeremonyStatus,
	startMockCeremony,
	stopMockCeremony,
	startRealtimeCeremony,
	stopRealtimeCeremony,
	createCeremonyInviteToken,
	joinCeremonyWithInviteToken
};
