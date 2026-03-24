import { showToast } from './toast-store.js';

let lastNoticeAt = 0;
let lastNoticeKey = '';

function normalizeNotice(short, details) {
	return {
		message: `🔐 ${short}`,
		details
	};
}

export function showPasskeyNotice(short, details, { duration = 4200, dedupeMs = 1800 } = {}) {
	const now = Date.now();
	const noticeKey = `${short}::${details}`;
	if (noticeKey === lastNoticeKey && now - lastNoticeAt < dedupeMs) return;
	lastNoticeAt = now;
	lastNoticeKey = noticeKey;

	const notice = normalizeNotice(short, details);
	showToast(notice.message, 'default', duration, notice.details);
}

export async function beforePasskeyPrompt(short, details, options = {}) {
	showPasskeyNotice(short, details, options);
	const delayMs = options.delayMs ?? 220;
	if (delayMs > 0) {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
}

export function showExternalPasskeyPrompt(reason) {
	const normalized = String(reason || '')
		.trim()
		.toLowerCase();

	if (normalized.includes('create varsig identity')) {
		showPasskeyNotice(
			'Create hardware identity',
			'Needed to create your hardware-backed OrbitDB identity. Your authenticator may ask twice.'
		);
		return;
	}

	if (normalized.includes('sign database entry')) {
		showPasskeyNotice(
			'Confirm passkey',
			'Needed to sign this database change with your hardware-backed identity.'
		);
		return;
	}

	showPasskeyNotice('Confirm passkey', String(reason || 'Needed for this secure action.'));
}
