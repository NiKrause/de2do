import { get } from 'svelte/store';
import { libp2pStore } from '$lib/p2p.js';

const TOPIC = import.meta.env.VITE_THRESHOLD_CEREMONY_TOPIC || 'threshold.ceremony.v1';

let unsubscribeStore = null;
let activePubsub = null;
let onEventHandler = null;
let onStatus = null;
let heartbeatTimer = null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const getLocalDeviceId = () => {
	if (typeof window === 'undefined') return 'desktop-local';
	const key = 'threshold.localDeviceId';
	const existing = window.localStorage.getItem(key);
	if (existing) return existing;
	const deviceId = globalThis.crypto?.randomUUID
		? globalThis.crypto.randomUUID()
		: `device-${Date.now()}`;
	window.localStorage.setItem(key, deviceId);
	return deviceId;
};

const getLocalRole = () => {
	if (typeof window === 'undefined') return 'desktop';
	const key = 'threshold.localDeviceRole';
	const existing = window.localStorage.getItem(key);
	if (existing) return existing;
	const role = /mobile|android|iphone|ipad/i.test(window.navigator.userAgent) ? 'phone-a' : 'desktop';
	window.localStorage.setItem(key, role);
	return role;
};

const emitStatus = (status) => {
	if (typeof onStatus === 'function') onStatus(status);
};

const attachPubsub = async (pubsub) => {
	if (!pubsub || activePubsub === pubsub) return;
	activePubsub = pubsub;

	try {
		await pubsub.subscribe(TOPIC);
	} catch (error) {
		console.warn('⚠️ Ceremony topic subscribe failed:', error?.message || error);
	}

	pubsub.addEventListener('message', onMessage);
	emitStatus({ connected: true, topic: TOPIC });
};

const detachPubsub = () => {
	if (!activePubsub) return;
	activePubsub.removeEventListener('message', onMessage);
	activePubsub = null;
	emitStatus({ connected: false, topic: TOPIC });
};

const onMessage = (event) => {
	const message = event?.detail;
	if (!message || message.topic !== TOPIC) return;
	if (!message.data) return;

	try {
		const payload = JSON.parse(decoder.decode(message.data));
		if (typeof onEventHandler === 'function') {
			onEventHandler(payload);
		}
	} catch (error) {
		console.warn('⚠️ Ceremony message parse failed:', error?.message || error);
	}
};

const publishCeremonyEvent = async (event) => {
	const libp2p = get(libp2pStore);
	const pubsub = libp2p?.services?.pubsub;
	if (!pubsub) return false;
	try {
		await pubsub.publish(TOPIC, encoder.encode(JSON.stringify(event)));
		return true;
	} catch (error) {
		console.warn('⚠️ Ceremony publish failed:', error?.message || error);
		return false;
	}
};

const startHeartbeat = ({ keyRef }) => {
	clearInterval(heartbeatTimer);
	const deviceId = getLocalDeviceId();
	const role = getLocalRole();
	heartbeatTimer = setInterval(() => {
		void publishCeremonyEvent({
			type: 'threshold.heartbeat',
			deviceId,
			role,
			keyRef,
			ts: Date.now()
		});
	}, 6000);
};

const stopHeartbeat = () => {
	if (heartbeatTimer) clearInterval(heartbeatTimer);
	heartbeatTimer = null;
};

const startCeremonyChannel = ({ onEvent, statusHandler, keyRef = 'db:default' }) => {
	onEventHandler = onEvent;
	onStatus = statusHandler;

	const libp2p = get(libp2pStore);
	const currentPubsub = libp2p?.services?.pubsub;
	if (currentPubsub) {
		void attachPubsub(currentPubsub);
	}

	unsubscribeStore = libp2pStore.subscribe((instance) => {
		const pubsub = instance?.services?.pubsub;
		if (pubsub) {
			void attachPubsub(pubsub);
		} else {
			detachPubsub();
		}
	});

	startHeartbeat({ keyRef });

	return {
		async publish (event) {
			return publishCeremonyEvent(event);
		},
		stop () {
			stopCeremonyChannel();
		}
	};
};

const stopCeremonyChannel = () => {
	stopHeartbeat();
	if (unsubscribeStore) unsubscribeStore();
	unsubscribeStore = null;
	detachPubsub();
	onEventHandler = null;
	onStatus = null;
};

export {
	TOPIC as THRESHOLD_CEREMONY_TOPIC,
	startCeremonyChannel,
	stopCeremonyChannel,
	publishCeremonyEvent,
	getLocalDeviceId,
	getLocalRole
};
