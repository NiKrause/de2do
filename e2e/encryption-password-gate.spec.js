import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress,
	waitForTodoText
} from './helpers.js';
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { dcutr } from '@libp2p/dcutr';
import { autoNAT } from '@libp2p/autonat';
import { bootstrap } from '@libp2p/bootstrap';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify, identifyPush } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import { createHelia } from 'helia';
import { createOrbitDB } from '@orbitdb/core';
import SimpleEncryption from '@le-space/orbitdb-simple-encryption';

const RUN_UNSTABLE_E2E = process.env.E2E_UNSTABLE === 'true';

async function openOrbitDbByAddress(page, dbAddress, timeout = 45000) {
	const normalizedAddress = dbAddress.startsWith('/') ? dbAddress : `/${dbAddress}`;

	await page.evaluate((address) => {
		const nextHash = `#${address}`;
		if (window.location.hash !== nextHash) {
			window.location.hash = nextHash;
		}
	}, normalizedAddress);

	await page.waitForFunction(
		(address) => {
			const current = window.__currentDbAddress__ || window.__todoDB__?.address || null;
			return current === address;
		},
		normalizedAddress,
		{ timeout }
	);

	await page.waitForFunction(
		() =>
			Boolean(window.__todoDB__) ||
			Boolean(document.querySelector('[data-testid="todo-input"]')),
		null,
		{ timeout }
	);
}

async function probeBrowserDbState(page, expectedTexts = []) {
	return page.evaluate(async (texts) => {
		const db = window.__todoDB__;
		let entryCount = null;
		let plaintextCount = 0;
		let matchedTexts = [];
		let readError = null;

		if (db?.all) {
			try {
				const entries = await db.all();
				entryCount = entries.length;
				const plaintextTexts = entries
					.map((entry) => entry?.value?.text)
					.filter((text) => typeof text === 'string');
				plaintextCount = plaintextTexts.length;
				matchedTexts = texts.filter((text) => plaintextTexts.includes(text));
			} catch (error) {
				readError = error?.message || String(error);
			}
		}

		return {
			url: window.location.href,
			hash: window.location.hash,
			currentDbAddress: window.__currentDbAddress__ || null,
			todoDbAddress: db?.address || null,
			hasTodoInput: Boolean(document.querySelector('[data-testid="todo-input"]')),
			hasModalPassword: Boolean(document.querySelector('#password')),
			hasSettingsPassword: Boolean(document.querySelector('#encryption-password')),
			entryCount,
			plaintextCount,
			matchedTexts,
			readError
		};
	}, expectedTexts);
}

function getRelayMultiaddr() {
	const raw = readFileSync('e2e/relay-info.json', 'utf8');
	const parsed = JSON.parse(raw);
	if (!parsed?.multiaddr) {
		throw new Error('Missing relay multiaddr in e2e/relay-info.json');
	}
	return parsed.multiaddr;
}

function getPeerIdFromMultiaddr(addr) {
	const marker = '/p2p/';
	const index = addr.lastIndexOf(marker);
	if (index === -1) {
		throw new Error(`Relay multiaddr does not include /p2p/: ${addr}`);
	}
	return addr.slice(index + marker.length);
}

async function assertBrowserConnectedToRelay(page, label = 'Browser', timeout = 30000) {
	const relayPeerId = getPeerIdFromMultiaddr(getRelayMultiaddr());
	await page.waitForFunction(
		(targetPeerId) =>
			Boolean(window.__libp2p__?.getPeers?.().some((peerId) => peerId?.toString?.() === targetPeerId)),
		relayPeerId,
		{ timeout }
	);
	const peers = await page.evaluate(
		() => window.__libp2p__?.getPeers?.().map((peerId) => peerId?.toString?.()).filter(Boolean) || []
	);
	console.log(`✅ ${label} connected to relay ${relayPeerId}. Peers: ${JSON.stringify(peers)}`);
}

async function waitForRelayConnection(libp2p, relayPeerId, timeout = 30000) {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		const activeConnections = libp2p.getConnections(relayPeerId);
		if (activeConnections.length > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for relay connection: ${relayPeerId.toString()}`);
}

async function getBrowserPeerInfo(page, timeout = 30000) {
	await page.waitForFunction(() => Boolean(window.__libp2p__?.peerId), null, { timeout });
	return page.evaluate(() => {
		const peerId = window.__libp2p__?.peerId?.toString?.() || null;
		const multiaddrs =
			window.__libp2p__?.getMultiaddrs?.().map((addr) => addr?.toString?.()).filter(Boolean) || [];
		return { peerId, multiaddrs };
	});
}

async function waitForMutualPeerConnection(pageA, pageB, timeout = 45000) {
	const [peerInfoA, peerInfoB] = await Promise.all([
		getBrowserPeerInfo(pageA, timeout),
		getBrowserPeerInfo(pageB, timeout)
	]);

	try {
		await Promise.all([
			pageA.waitForFunction(
				(targetPeerId) =>
					Boolean(window.__libp2p__?.getPeers?.().some((peerId) => peerId?.toString?.() === targetPeerId)),
				peerInfoB.peerId,
				{ timeout }
			),
			pageB.waitForFunction(
				(targetPeerId) =>
					Boolean(window.__libp2p__?.getPeers?.().some((peerId) => peerId?.toString?.() === targetPeerId)),
				peerInfoA.peerId,
				{ timeout }
			)
		]);
	} catch {
		const [peersA, peersB] = await Promise.all([
			pageA.evaluate(
				() => window.__libp2p__?.getPeers?.().map((peerId) => peerId?.toString?.()).filter(Boolean) || []
			),
			pageB.evaluate(
				() => window.__libp2p__?.getPeers?.().map((peerId) => peerId?.toString?.()).filter(Boolean) || []
			)
		]);
		throw new Error(
			`Mutual peer connection not established. A(${peerInfoA.peerId}) peers=${JSON.stringify(peersA)}; B(${peerInfoB.peerId}) peers=${JSON.stringify(peersB)}`
		);
	}

	console.log(`✅ Mutual peer connection established: A(${peerInfoA.peerId}) <-> B(${peerInfoB.peerId})`);
}

async function waitForPeerConnection(libp2p, targetPeerIdString, targetMultiaddrs = [], timeout = 45000) {
	const targetPeerId = peerIdFromString(targetPeerIdString);
	const started = Date.now();
	let lastDialError = null;
	const parsedTargetAddrs = targetMultiaddrs
		.map((addr) => {
			try {
				return multiaddr(addr);
			} catch {
				return null;
			}
		})
		.filter(Boolean);

	if (parsedTargetAddrs.length > 0) {
		if (typeof libp2p.peerStore?.merge === 'function') {
			await libp2p.peerStore.merge(targetPeerId, { multiaddrs: parsedTargetAddrs });
		} else {
			await libp2p.peerStore.patch(targetPeerId, { multiaddrs: parsedTargetAddrs });
		}
	}

	async function tryDialTarget() {
		try {
			await libp2p.dial(targetPeerId);
			lastDialError = null;
		} catch (error) {
			lastDialError = error?.message || String(error);
			for (const addr of parsedTargetAddrs) {
				try {
					await libp2p.dial(addr);
					lastDialError = null;
					break;
				} catch (addrError) {
					lastDialError = addrError?.message || String(addrError);
				}
			}
		}
	}

	function isConnected() {
		return libp2p.getConnections(targetPeerId).length > 0;
	}

	if (isConnected()) return;

	const onDiscovery = async (event) => {
		try {
			const discoveredPeerId = event?.detail?.id?.toString?.();
			if (discoveredPeerId === targetPeerIdString) {
				await tryDialTarget();
			}
		} catch {
			// ignore discovery handler errors in test helper
		}
	};

	libp2p.addEventListener('peer:discovery', onDiscovery);

	try {
		while (Date.now() - started < timeout) {
			if (isConnected()) return;
			await tryDialTarget();
			if (isConnected()) return;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	} finally {
		libp2p.removeEventListener('peer:discovery', onDiscovery);
	}

		const peers = libp2p.getPeers().map((peerId) => peerId.toString());
	throw new Error(
		`Timed out waiting for connection to Browser A peer ${targetPeerIdString}. Seen peers: ${peers.join(', ') || 'none'}. Seed addresses: ${targetMultiaddrs.join(', ') || 'none'}. Last dial error: ${lastDialError || 'none'}`
	);
}

function formatDialError(error) {
	if (!error) return 'unknown error';
	const message = error?.message || String(error);
	if (error instanceof AggregateError && Array.isArray(error.errors)) {
		const inner = error.errors
			.map((innerError) => innerError?.message || String(innerError))
			.filter(Boolean);
		if (inner.length > 0) return `${message} [${inner.join(' | ')}]`;
	}
	return message;
}

async function createNodeReplicaClient() {
	const relayMultiaddr = getRelayMultiaddr();
	const relayPeerId = peerIdFromString(getPeerIdFromMultiaddr(relayMultiaddr));
	const relayAddr = multiaddr(relayMultiaddr);
	const discoveryTopic = 'todo._peer-discovery._p2p._pubsub';

	const libp2p = await createLibp2p({
		addresses: { listen: ['/p2p-circuit', '/webrtc'] },
		transports: [
			webSockets(),
			webRTCDirect({
				rtcConfiguration: {
					iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }]
				}
			}),
			webRTC({
				rtcConfiguration: {
					iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }]
				}
			}),
			circuitRelayTransport({ reservationCompletionTimeout: 20000 })
		],
		connectionEncrypters: [noise()],
		streamMuxers: [yamux()],
		peerDiscovery: [
			pubsubPeerDiscovery({
				interval: 3000,
				topics: [discoveryTopic],
				listenOnly: false,
				emitSelf: true
			})
		],
		connectionGater: { denyDialMultiaddr: () => false },
		services: {
			identify: identify(),
			identifyPush: identifyPush(),
			ping: ping(),
			bootstrap: bootstrap({ list: [relayMultiaddr] }),
			autonat: autoNAT(),
			dcutr: dcutr(),
			pubsub: gossipsub({
				allowPublishToZeroTopicPeers: true,
				emitSelf: false
			})
		}
	});

	if (typeof libp2p.peerStore?.merge === 'function') {
		await libp2p.peerStore.merge(relayPeerId, { multiaddrs: [relayAddr] });
	} else {
		await libp2p.peerStore.patch(relayPeerId, { multiaddrs: [relayAddr] });
	}

	const dialAttempts = [
		{ label: 'peerId', run: () => libp2p.dial(relayPeerId) },
		{ label: 'multiaddr', run: () => libp2p.dial(relayAddr) },
		{ label: 'multiaddr-string', run: () => libp2p.dial(relayMultiaddr) }
	];
	const dialErrors = [];
	let connected = false;

	for (let round = 1; round <= 3 && !connected; round += 1) {
		for (const attempt of dialAttempts) {
			try {
				await attempt.run();
				await waitForRelayConnection(libp2p, relayPeerId, 10000);
				connected = true;
				break;
			} catch (error) {
				dialErrors.push(`round ${round} ${attempt.label}: ${formatDialError(error)}`);
			}
		}
		if (!connected) {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	if (!connected) {
		throw new Error(
			`Failed to connect node replica client to relay ${relayPeerId.toString()}: ${dialErrors.join('; ')}`
		);
	}

	const helia = await createHelia({ libp2p });
	const orbitdb = await createOrbitDB({
		ipfs: helia,
		id: `e2e-node-replica-${Date.now()}`,
		directory: `./.tmp-orbitdb-e2e-${Date.now()}`
	});

	return { libp2p, helia, orbitdb };
}

async function waitForReplicatedTodos(db, expectedTexts, timeout = 60000) {
	const started = Date.now();
	let lastError = null;
	while (Date.now() - started < timeout) {
		try {
			const entries = await db.all();
			const texts = entries
				.map((entry) => entry?.value?.text)
				.filter(Boolean);

			const allFound = expectedTexts.every((text) => texts.includes(text));
			if (allFound) return entries;
		} catch (error) {
			lastError = formatDialError(error);
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	if (lastError) {
		throw new Error(
			`Timed out waiting for replicated todos (${expectedTexts.join(', ')}); last read error: ${lastError}`
		);
	}
	throw new Error(`Timed out waiting for replicated todos: ${expectedTexts.join(', ')}`);
}

async function probeNoPasswordReadability(db, forbiddenTexts, timeout = 20000) {
	const started = Date.now();
	let lastError = null;
	let lastEntriesCount = 0;
	let lastTexts = [];

	while (Date.now() - started < timeout) {
		try {
			const entries = await db.all();
			const texts = entries
				.map((entry) => entry?.value?.text)
				.filter(Boolean);
			lastEntriesCount = entries.length;
			lastTexts = texts;

			if (forbiddenTexts.some((text) => texts.includes(text))) {
				return { state: 'plaintext-visible', entriesCount: entries.length, texts };
			}

			if (entries.length > 0) {
				return { state: 'entries-nonplaintext', entriesCount: entries.length, texts };
			}
		} catch (error) {
			lastError = error?.message || String(error);
		}

		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	if (lastError) {
		return { state: 'decrypt-error', error: lastError, entriesCount: lastEntriesCount, texts: lastTexts };
	}

	return { state: 'timeout-empty', entriesCount: lastEntriesCount, texts: lastTexts };
}

test.describe('Encryption Password Gate [unstable]', () => {
	test.skip(
		!RUN_UNSTABLE_E2E,
		'Unstable suite: set E2E_UNSTABLE=true to run this experimental cross-node password-gate flow.'
	);

	let unhandledRejectionHandler;

	test.beforeAll(() => {
		unhandledRejectionHandler = (reason) => {
			const message = reason?.message || String(reason);
			if (message.includes('All promises were rejected')) {
				console.warn('⚠️ Ignoring transient libp2p unhandled rejection:', message);
			}
		};
		process.on('unhandledRejection', unhandledRejectionHandler);
	});

	test.afterAll(() => {
		if (unhandledRejectionHandler) {
			process.off('unhandledRejection', unhandledRejectionHandler);
		}
	});

	test.skip('should replicate unencrypted todos to node orbitdb client via local relay', async ({
		page
	}) => {
		test.setTimeout(120000);
		const todoTexts = [
			`Node replica todo A - ${Date.now()}`,
			`Node replica todo B - ${Date.now() + 1}`,
			`Node replica todo C - ${Date.now() + 2}`
		];
		const triggerTodoText = `Node replica todo trigger - ${Date.now() + 3}`;

		await page.goto('/');
		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);
		await assertBrowserConnectedToRelay(page, 'Browser A', 60000);
		const browserPeerInfoA = await getBrowserPeerInfo(page);
		expect(browserPeerInfoA.peerId).toBeTruthy();

		const dbAddressA = await getCurrentDatabaseAddress(page);
		expect(dbAddressA).toContain('/orbitdb/');

		for (const text of todoTexts) {
			await page.locator('[data-testid="todo-input"]').fill(text);
			await page.locator('[data-testid="add-todo-button"]').click();
			await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout: 10000 });
		}

		const { libp2p, helia, orbitdb } = await createNodeReplicaClient();
		let replicaDb;
		try {
			await waitForPeerConnection(libp2p, browserPeerInfoA.peerId, browserPeerInfoA.multiaddrs);
			replicaDb = await orbitdb.open(dbAddressA, { sync: true });
			await page.locator('[data-testid="todo-input"]').fill(triggerTodoText);
			await page.locator('[data-testid="add-todo-button"]').click();
			await expect(page.locator(`text=${triggerTodoText}`).first()).toBeVisible({ timeout: 10000 });

			const expectedTexts = [...todoTexts, triggerTodoText];
			const replicated = await waitForReplicatedTodos(replicaDb, expectedTexts, 60000);
			expect(replicated.length).toBeGreaterThanOrEqual(3);
		} finally {
			if (replicaDb) await replicaDb.close().catch(() => {});
			await orbitdb?.stop?.().catch(() => {});
			await helia?.stop?.().catch(() => {});
			await libp2p?.stop?.().catch(() => {});
		}
	});

	test.skip('should require password for node replica to read encrypted todos', async ({ page }) => {
		test.setTimeout(180000);
		const encryptionPassword = 'node-replica-password-123';
		const baseTodos = [
			`Encrypted base todo A - ${Date.now()}`,
			`Encrypted base todo B - ${Date.now() + 1}`,
			`Encrypted base todo C - ${Date.now() + 2}`
		];
		const postMigrationTodo = `Encrypted post-migration todo - ${Date.now() + 3}`;
		const postJoinTriggerTodo = `Encrypted post-join trigger todo - ${Date.now() + 4}`;

		await page.goto('/');
		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);
		const browserPeerInfoA = await getBrowserPeerInfo(page);
		expect(browserPeerInfoA.peerId).toBeTruthy();

		const beforeEncryptionAddress = await getCurrentDatabaseAddress(page);
		expect(beforeEncryptionAddress).toContain('/orbitdb/');

		for (const text of baseTodos) {
			await page.locator('[data-testid="todo-input"]').fill(text);
			await page.locator('[data-testid="add-todo-button"]').click();
			await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout: 10000 });
		}

		await page.getByLabel(/Enable Encryption/i).check();
		await page.locator('#encryption-password').fill(encryptionPassword);
		await page.getByRole('button', { name: /Apply Encryption/i }).click();
		await expect(page.getByTestId('encryption-active-indicator')).toBeVisible({ timeout: 30000 });

		const afterEncryptionAddress = await getCurrentDatabaseAddress(page);
		expect(afterEncryptionAddress).toContain('/orbitdb/');
		const migrationMode =
			afterEncryptionAddress === beforeEncryptionAddress
				? 'same-address-encryption-activation'
				: 'address-changed-migration';
		console.log(`🔎 Encryption mode in this run: ${migrationMode}`);

		await page.locator('[data-testid="todo-input"]').fill(postMigrationTodo);
		await page.locator('[data-testid="add-todo-button"]').click();
		await expect(page.locator(`text=${postMigrationTodo}`).first()).toBeVisible({ timeout: 10000 });

		const { libp2p, helia, orbitdb } = await createNodeReplicaClient();
		let noPasswordDb;
		let passwordDb;
		try {
			await waitForPeerConnection(libp2p, browserPeerInfoA.peerId, browserPeerInfoA.multiaddrs);
			const expectedBeforeJoin = [...baseTodos, postMigrationTodo];

			noPasswordDb = await orbitdb.open(afterEncryptionAddress, { sync: true });
			const noPasswordProbe = await probeNoPasswordReadability(
				noPasswordDb,
				expectedBeforeJoin,
				20000
			);
			expect(noPasswordProbe.state).not.toBe('plaintext-visible');
			await noPasswordDb.close();
			noPasswordDb = null;

			const encryption = { data: await SimpleEncryption({ password: encryptionPassword }) };
			passwordDb = await orbitdb.open(afterEncryptionAddress, { sync: true, encryption });

			await page.locator('[data-testid="todo-input"]').fill(postJoinTriggerTodo);
			await page.locator('[data-testid="add-todo-button"]').click();
			await expect(page.locator(`text=${postJoinTriggerTodo}`).first()).toBeVisible({ timeout: 10000 });

			const expectedAll = [...baseTodos, postMigrationTodo, postJoinTriggerTodo];
			const replicated = await waitForReplicatedTodos(passwordDb, expectedAll, 60000);
			expect(replicated.length).toBeGreaterThanOrEqual(expectedAll.length);
		} finally {
			if (noPasswordDb) await noPasswordDb.close().catch(() => {});
			if (passwordDb) await passwordDb.close().catch(() => {});
			await orbitdb?.stop?.().catch(() => {});
			await helia?.stop?.().catch(() => {});
			await libp2p?.stop?.().catch(() => {});
		}
	});

	test('should require password for Browser B to read encrypted todos', async ({ page }) => {
		test.setTimeout(180000);
		const encryptionPassword = 'browser-b-password-123';
		const baseTodos = [
			`Browser B encrypted base todo A - ${Date.now()}`,
			`Browser B encrypted base todo B - ${Date.now() + 1}`,
			`Browser B encrypted base todo C - ${Date.now() + 2}`
		];
		const postMigrationTodo = `Browser B encrypted post-migration todo - ${Date.now() + 3}`;
		const postUnlockTriggerTodo = `Browser B encrypted post-unlock trigger todo - ${Date.now() + 4}`;

		await page.goto('/');
		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);

		const beforeEncryptionAddress = await getCurrentDatabaseAddress(page);
		expect(beforeEncryptionAddress).toContain('/orbitdb/');

		for (const text of baseTodos) {
			await page.locator('[data-testid="todo-input"]').fill(text);
			await page.locator('[data-testid="add-todo-button"]').click();
			await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout: 10000 });
		}

		await page.getByLabel(/Enable Encryption/i).check();
		await page.locator('#encryption-password').fill(encryptionPassword);
		await page.getByRole('button', { name: /Apply Encryption/i }).click();
		await expect(page.getByTestId('encryption-active-indicator')).toBeVisible({ timeout: 30000 });

		const afterEncryptionAddress = await getCurrentDatabaseAddress(page);
		expect(afterEncryptionAddress).toContain('/orbitdb/');
		const encryptionMode =
			afterEncryptionAddress === beforeEncryptionAddress
				? 'same-address-encryption-activation'
				: 'address-changed-migration';
		console.log(`🔎 Browser B test encryption mode: ${encryptionMode}`);

		await page.locator('[data-testid="todo-input"]').fill(postMigrationTodo);
		await page.locator('[data-testid="add-todo-button"]').click();
		await expect(page.locator(`text=${postMigrationTodo}`).first()).toBeVisible({ timeout: 10000 });

		const contextB = await page.context().browser().newContext();
		const pageB = await contextB.newPage();
		try {
			const normalizedAddress = afterEncryptionAddress.startsWith('/')
				? afterEncryptionAddress
				: `/${afterEncryptionAddress}`;
			const targetHash = `#${normalizedAddress}`;

			// Use direct hash URL navigation to avoid races where hash assignment is dropped.
			console.log(`🔎 Browser B navigating to ${targetHash}`);
			await pageB.goto(`/${targetHash}`, { waitUntil: 'domcontentloaded' });
			console.log('🔎 Browser B waiting for target hash...');
			try {
				await pageB.waitForFunction((hash) => window.location.hash === hash, targetHash, {
					timeout: 15000
				});
			} catch {
				const hashProbe = await pageB.evaluate(() => ({
					url: window.location.href,
					hash: window.location.hash
				}));
				throw new Error(`Browser B failed to set target hash ${targetHash}: ${JSON.stringify(hashProbe)}`);
			}
			console.log('✅ Browser B target hash set');
			await acceptConsentAndInitialize(pageB, { skipIfNotFound: true });
			await waitForP2PInitialization(pageB, 60000);
			await assertBrowserConnectedToRelay(pageB, 'Browser B', 60000);
			console.log('🔎 Browser B waiting for mutual peer connection with Browser A...');
			await waitForMutualPeerConnection(page, pageB, 60000);

			console.log('🔎 Browser B: waiting for unlock-or-db-ready signal...');
			// In encrypted flows Browser B may surface unlock UI before todo input / currentDbAddress is set.
			const readyByAddress = pageB.waitForFunction(
				(address) => {
					const current = window.__currentDbAddress__ || window.__todoDB__?.address || null;
					return current === address;
				},
				normalizedAddress,
				{ timeout: 60000 }
			);
			const readyByModal = pageB.locator('#password').waitFor({ state: 'visible', timeout: 60000 });
			const readyBySettings = pageB
				.locator('#encryption-password')
				.waitFor({ state: 'visible', timeout: 60000 });
			try {
				await Promise.any([readyByAddress, readyByModal, readyBySettings]);
			} catch {
				const probe = await pageB.evaluate(() => ({
					url: window.location.href,
					hash: window.location.hash,
					currentDbAddress: window.__currentDbAddress__ || null,
					todoDbAddress: window.__todoDB__?.address || null,
					hasModalPassword: Boolean(document.querySelector('#password')),
					hasSettingsPassword: Boolean(document.querySelector('#encryption-password')),
					hasTodoInput: Boolean(document.querySelector('[data-testid="todo-input"]'))
				}));
				throw new Error(`Browser B never reached unlock/db-ready state: ${JSON.stringify(probe)}`);
			}
			console.log('✅ Browser B: unlock-or-db-ready signal received');

			const expectedBeforeUnlock = [...baseTodos, postMigrationTodo];
			const preUnlockProbe = await probeBrowserDbState(pageB, expectedBeforeUnlock);
			console.log('🔎 Browser B pre-unlock probe:', JSON.stringify(preUnlockProbe));
			const visibleBeforeUnlock = [];
			for (const text of expectedBeforeUnlock) {
				const visible = await pageB.locator(`text=${text}`).first().isVisible();
				if (visible) visibleBeforeUnlock.push(text);
			}
			expect(
				visibleBeforeUnlock,
				`Encrypted todos visible before password: ${visibleBeforeUnlock.join(', ')}`
			).toEqual([]);

			// Re-check after short wait to catch delayed pre-unlock leakage.
			await pageB.waitForTimeout(2000);
			const delayedVisibleBeforeUnlock = [];
			for (const text of expectedBeforeUnlock) {
				const visible = await pageB.locator(`text=${text}`).first().isVisible();
				if (visible) delayedVisibleBeforeUnlock.push(text);
			}
			expect(
				delayedVisibleBeforeUnlock,
				`Encrypted todos became visible before password: ${delayedVisibleBeforeUnlock.join(', ')}`
			).toEqual([]);

			// Unlock path A: dedicated password modal (preferred). Give it a short grace period.
			const modalPasswordInput = pageB.locator('#password');
			const modalAppeared = await modalPasswordInput
				.waitFor({ state: 'visible', timeout: 8000 })
				.then(() => true)
				.catch(() => false);
			if (modalAppeared) {
				console.log('🔓 Browser B unlock path: modal');
				await modalPasswordInput.fill(encryptionPassword);
				await pageB.getByRole('button', { name: /Unlock/i }).click();
			} else {
				// Unlock path B: manual password via Encryption settings form
				console.log('🔓 Browser B unlock path: settings-form');
				const enableEncryptionCheckbox = pageB.getByLabel(/Enable Encryption/i);
				await expect(enableEncryptionCheckbox).toBeVisible({ timeout: 10000 });
				const isChecked = await enableEncryptionCheckbox.isChecked();
				if (!isChecked) {
					await enableEncryptionCheckbox.check();
				}
				await pageB.locator('#encryption-password').fill(encryptionPassword);
				const applyButton = pageB.locator('button:has-text("Apply Encryption")').first();
				await expect(applyButton).toBeVisible({ timeout: 10000 });
				await applyButton.click();

				// Ensure Browser B is still targeting the intended shared DB address.
				await pageB.evaluate((address) => {
					const nextHash = `#${address}`;
					if (window.location.hash !== nextHash) {
						window.location.hash = nextHash;
					}
				}, normalizedAddress);

				await Promise.any([
					pageB.waitForFunction(
						(address) => {
							const current = window.__currentDbAddress__ || window.__todoDB__?.address || null;
							return current === address;
						},
						normalizedAddress,
						{ timeout: 20000 }
					),
					pageB.locator('#password').waitFor({ state: 'visible', timeout: 20000 })
				]).catch(async () => {
					const probe = await pageB.evaluate(() => ({
						url: window.location.href,
						hash: window.location.hash,
						currentDbAddress: window.__currentDbAddress__ || null,
						todoDbAddress: window.__todoDB__?.address || null,
						hasModalPassword: Boolean(document.querySelector('#password')),
						hasSettingsPassword: Boolean(document.querySelector('#encryption-password'))
					}));
					throw new Error(
						`Browser B settings-form unlock did not rebind/open expected DB: ${JSON.stringify(probe)}`
					);
				});
			}

			// After any unlock path, Browser B must actually bind/open the target DB.
			try {
				await openOrbitDbByAddress(pageB, normalizedAddress, 30000);
			} catch (error) {
				const bindProbe = await probeBrowserDbState(pageB, expectedBeforeUnlock);
				throw new Error(
					`Browser B did not bind target DB after unlock (${normalizedAddress}). Probe: ${JSON.stringify(bindProbe)}. Cause: ${error?.message || String(error)}`
				);
			}

			const postUnlockProbe = await probeBrowserDbState(pageB, expectedBeforeUnlock);
			console.log('🔎 Browser B post-unlock probe:', JSON.stringify(postUnlockProbe));

			await page.locator('[data-testid="todo-input"]').fill(postUnlockTriggerTodo);
			await page.locator('[data-testid="add-todo-button"]').click();
			await expect(page.locator(`text=${postUnlockTriggerTodo}`).first()).toBeVisible({ timeout: 10000 });

			const expectedAfterUnlock = [...expectedBeforeUnlock, postUnlockTriggerTodo];
			for (const text of expectedAfterUnlock) {
				try {
					await waitForTodoText(pageB, text, 60000);
				} catch (error) {
					const timeoutProbe = await probeBrowserDbState(pageB, expectedAfterUnlock);
					throw new Error(
						`Timed out waiting for Browser B todo "${text}". Probe: ${JSON.stringify(timeoutProbe)}. Cause: ${error?.message || String(error)}`
					);
				}
			}
		} finally {
			await contextB.close().catch(() => {});
		}
	});

	test('should replicate unencrypted todos to a second orbitdb instance', async ({ page }) => {
		test.setTimeout(120000);
		const todoTexts = [
			`Unencrypted todo A - ${Date.now()}`,
			`Unencrypted todo B - ${Date.now() + 1}`,
			`Unencrypted todo C - ${Date.now() + 2}`
		];

		// Browser A: create unencrypted todos
		await page.goto('/');
		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);

		const dbAddressA = await getCurrentDatabaseAddress(page);
		expect(dbAddressA).toContain('/orbitdb/');

		for (const text of todoTexts) {
			await page.locator('[data-testid="todo-input"]').fill(text);
			await page.locator('[data-testid="add-todo-button"]').click();
			await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout: 10000 });
		}

		// Browser B: separate OrbitDB instance opened by database address
		const contextB = await page.context().browser().newContext();
		const pageB = await contextB.newPage();
		await pageB.goto(`/?#/${dbAddressA}`);
		await waitForP2PInitialization(pageB, 60000);
		await openOrbitDbByAddress(pageB, dbAddressA, 60000);

		for (const text of todoTexts) {
			await waitForTodoText(pageB, text, 60000);
		}

		const browserBEntryCount = await pageB.evaluate(async () => {
			if (!window.__todoDB__?.all) return -1;
			const entries = await window.__todoDB__.all();
			return entries.length;
		});
		expect(browserBEntryCount).toBeGreaterThanOrEqual(3);

		await contextB.close();
	});

	test('should not show encrypted todos in Browser B before manual password unlock', async ({ page }) => {
		const encryptionPassword = 'manual-password-123';
		const testTodoText = `Encrypted todo - ${Date.now()}`;

		// Browser A: create encrypted database with one todo
		await page.goto('/');
		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);
		const beforeEncryptionAddress = await getCurrentDatabaseAddress(page);
		expect(beforeEncryptionAddress).toContain('/orbitdb/');

		const encryptionCheckbox = page.getByLabel(/Enable Encryption/i);
		await encryptionCheckbox.check();

		const passwordInputA = page.locator('#encryption-password');
		await expect(passwordInputA).toBeVisible({ timeout: 5000 });
		await passwordInputA.fill(encryptionPassword);

		await page.getByRole('button', { name: /Apply Encryption/i }).click();
		await expect(page.getByTestId('encryption-active-indicator')).toBeVisible({ timeout: 30000 });

		const dbAddressA = await getCurrentDatabaseAddress(page);
		expect(dbAddressA).toContain('/orbitdb/');
		const manualUnlockMode =
			dbAddressA === beforeEncryptionAddress
				? 'same-address-encryption-activation'
				: 'address-changed-migration';
		console.log(`🔎 Manual unlock test encryption mode: ${manualUnlockMode}`);

		await page.locator('[data-testid="todo-input"]').fill(testTodoText);
		await page.locator('[data-testid="add-todo-button"]').click();
		await expect(page.locator(`text=${testTodoText}`).first()).toBeVisible({ timeout: 10000 });
		const browserAState = await page.evaluate(() => ({
			identityId: window.__currentIdentityId__ || null,
			currentDbAddress: window.__currentDbAddress__ || window.__todoDB__?.address || null,
			currentDbName: window.__currentDbName__ || window.__todoDB__?.name || null
		}));
		console.log('🔎 Browser A state:', JSON.stringify(browserAState, null, 2));
		expect(browserAState.currentDbAddress).toBe(dbAddressA);

		// Browser B: open encrypted DB by URL hash in a fresh context
		const contextB = await page.context().browser().newContext();
		const pageB = await contextB.newPage();

		await pageB.goto(`/?#/${dbAddressA}`);
		await waitForP2PInitialization(pageB, 60000);
		await openOrbitDbByAddress(pageB, dbAddressA);
		const browserBState = await pageB.evaluate(() => ({
			identityId: window.__currentIdentityId__ || null,
			currentDbAddress: window.__currentDbAddress__ || window.__todoDB__?.address || null,
			currentDbName: window.__currentDbName__ || window.__todoDB__?.name || null,
			localStorageKeys: Object.keys(localStorage),
			hasVarsigCredential: Boolean(localStorage.getItem('webauthn-varsig-credential')),
			hasWebAuthnCredential: Boolean(localStorage.getItem('webauthn-credential'))
		}));
		console.log('🔎 Browser B state:', JSON.stringify(browserBState, null, 2));
			const todoVisibleBeforeUnlock = await pageB.locator(`text=${testTodoText}`).first().isVisible();
			expect(todoVisibleBeforeUnlock).toBe(false);

			// Unlock path A: dedicated modal, path B: settings form.
			const modalPasswordInput = pageB.locator('#password');
			if (await modalPasswordInput.isVisible().catch(() => false)) {
				await modalPasswordInput.fill(encryptionPassword);
				await pageB.getByRole('button', { name: /Unlock/i }).click();
			} else {
				const enableEncryptionCheckbox = pageB.getByLabel(/Enable Encryption/i);
				await expect(enableEncryptionCheckbox).toBeVisible({ timeout: 10000 });
				const isChecked = await enableEncryptionCheckbox.isChecked();
				if (!isChecked) {
					await enableEncryptionCheckbox.check();
				}
				await pageB.locator('#encryption-password').fill(encryptionPassword);
				const applyButton = pageB.locator('button:has-text("Apply Encryption")').first();
				await expect(applyButton).toBeVisible({ timeout: 10000 });
				await applyButton.click();
			}
			await waitForTodoText(pageB, testTodoText, 30000);

		await contextB.close();
	});
});
