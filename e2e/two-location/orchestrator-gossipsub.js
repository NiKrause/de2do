import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

function getTopic(runId, prefix = 'orchestrator') {
	return `${prefix}/${runId}/v1`;
}

function createMatcherScript() {
	return `({ message, criteria }) => {
		if (!message || typeof message !== 'object') return false;
		if (criteria.runId && message.runId !== criteria.runId) return false;
		if (criteria.state && message.state !== criteria.state) return false;
		if (criteria.role && message.role !== criteria.role) return false;
		return true;
	}`;
}

export async function ensureOrchestrationChannel(page, { runId, topicPrefix }) {
	const topic = getTopic(runId, topicPrefix);

	await page.evaluate(async (t) => {
		if (!window.__orch__) {
			window.__orch__ = { channels: {}, listenerAttached: false };
		}

		const pubsub = window.__libp2p__?.services?.pubsub;
		if (!pubsub) {
			throw new Error('libp2p pubsub service is not available');
		}

		if (!window.__orch__.channels[t]) {
			window.__orch__.channels[t] = {
				messages: [],
				waiters: [],
				seqSeen: {}
			};
			await pubsub.subscribe(t);
		}

		if (!window.__orch__.listenerAttached) {
			window.__orch__.listenerAttached = true;
			pubsub.addEventListener('message', (event) => {
				const msg = event?.detail;
				const topic = msg?.topic;
				if (!topic || !window.__orch__.channels[topic]) return;

				let parsed;
				try {
					parsed = JSON.parse(new TextDecoder().decode(msg.data));
				} catch {
					return;
				}

				const channel = window.__orch__.channels[topic];
				const role = parsed?.role || 'unknown';
				const seq = Number(parsed?.seq || 0);
				if (!channel.seqSeen[role]) channel.seqSeen[role] = new Set();
				if (seq > 0) {
					if (channel.seqSeen[role].has(seq)) return;
					channel.seqSeen[role].add(seq);
				}

				channel.messages.push(parsed);
				if (channel.messages.length > 500) channel.messages.shift();

				const waiters = channel.waiters.splice(0, channel.waiters.length);
				for (const waiter of waiters) {
					try {
						waiter(parsed);
					} catch {
						// ignore waiter errors
					}
				}
			});
		}
	}, topic);

	return topic;
}

export async function publishOrchestrationEvent(page, { topic, event }) {
	await page.evaluate(
		async ({ topic, event }) => {
			const pubsub = window.__libp2p__?.services?.pubsub;
			if (!pubsub) throw new Error('libp2p pubsub service is not available');
			const payload = new TextEncoder().encode(JSON.stringify(event));
			await pubsub.publish(topic, payload);
		},
		{ topic, event }
	);
}

export async function waitForOrchestrationEvent(page, { topic, criteria, timeout = 60000 }) {
	const matcherScript = createMatcherScript();
	return await page.evaluate(
		async ({ topic, criteria, timeout, matcherScript }) => {
			if (!window.__orch__?.channels?.[topic]) {
				throw new Error(`Orchestration channel not initialized for topic: ${topic}`);
			}
			const channel = window.__orch__.channels[topic];
			const matcher = new Function(`return ${matcherScript}`)();

			for (const message of channel.messages) {
				if (matcher({ message, criteria })) return message;
			}

			return await new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					reject(
						new Error(
							`Timed out waiting for orchestration event: ${JSON.stringify(criteria)} after ${timeout}ms`
						)
					);
				}, timeout);

				const waiter = (message) => {
					if (!matcher({ message, criteria })) {
						channel.waiters.push(waiter);
						return;
					}
					clearTimeout(timer);
					resolve(message);
				};

				channel.waiters.push(waiter);
			});
		},
		{ topic, criteria, timeout, matcherScript }
	);
}

export async function writeTimeline({ runId, role, timeline }) {
	const dir = path.join(process.cwd(), 'test-results', 'two-location');
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, `${runId}-${role}-timeline.json`);
	await writeFile(file, JSON.stringify(timeline, null, 2), 'utf8');
	return file;
}
