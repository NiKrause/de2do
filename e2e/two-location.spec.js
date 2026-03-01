import { test, expect } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress,
	waitForPeerCount,
	waitForTodoSyncEvent
} from './helpers.js';
import {
	ensureOrchestrationChannel,
	publishOrchestrationEvent,
	waitForOrchestrationEvent,
	writeTimeline
} from './two-location/orchestrator-gossipsub.js';

function requiredEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function roleConfig() {
	const role = requiredEnv('ROLE');
	if (role !== 'alice' && role !== 'bob') {
		throw new Error(`ROLE must be "alice" or "bob", got: ${role}`);
	}
	return {
		role,
		runId: requiredEnv('RUN_ID'),
		topicPrefix: process.env.ORCH_TOPIC_PREFIX || 'orchestrator',
		publicAppUrl: process.env.PUBLIC_APP_URL || '/'
	};
}

async function publishWithSeq(page, ctx, state, meta = {}) {
	ctx.seq += 1;
	const event = {
		runId: ctx.runId,
		role: ctx.role,
		state,
		seq: ctx.seq,
		ts: new Date().toISOString(),
		meta
	};
	ctx.timeline.push(event);
	await publishOrchestrationEvent(page, { topic: ctx.topic, event });
}

async function waitForEventWithRepublish(
	page,
	ctx,
	{ criteria, timeout, republishState, republishMeta = {}, intervalMs = 5000 }
) {
	let interval;
	if (republishState) {
		interval = setInterval(() => {
			publishWithSeq(page, ctx, republishState, { ...republishMeta, retry: true }).catch(() => {
				// ignore transient publish errors during retries
			});
		}, intervalMs);
	}

	try {
		return await waitForOrchestrationEvent(page, { topic: ctx.topic, criteria, timeout });
	} finally {
		if (interval) clearInterval(interval);
	}
}

test('two-location alice/bob replication via gossipsub orchestration', async ({ browser }) => {
	const cfg = roleConfig();
	const timeline = [];
	const context = await browser.newContext();
	const page = await context.newPage();
	const orch = {
		runId: cfg.runId,
		role: cfg.role,
		topic: '',
		seq: 0,
		timeline
	};

	try {
		await page.goto(cfg.publicAppUrl);
		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page, 90000);

		orch.topic = await ensureOrchestrationChannel(page, {
			runId: cfg.runId,
			topicPrefix: cfg.topicPrefix
		});

		await publishWithSeq(page, orch, 'ready', { topic: orch.topic });

		if (cfg.role === 'alice') {
			await waitForEventWithRepublish(page, orch, {
				criteria: { runId: cfg.runId, role: 'bob', state: 'ready' },
				timeout: 120000,
				republishState: 'ready',
				republishMeta: { topic: orch.topic }
			});

			await publishWithSeq(page, orch, 'start');

			const projectName = `two-location-${cfg.runId.slice(0, 8)}`;
			const todoText = `Todo from alice ${cfg.runId}`;
			const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
			await todoListInput.click();
			await todoListInput.fill(projectName);
			await todoListInput.press('Enter');
			await page.waitForTimeout(3000);

			const todoInput = page.locator('[data-testid="todo-input"]').first();
			await expect(todoInput).toBeEnabled({ timeout: 20000 });
			await todoInput.fill(todoText);
			await page.locator('[data-testid="add-todo-button"]').first().click();
			await expect(page.locator(`[data-todo-text="${todoText}"]`).first()).toBeVisible({
				timeout: 10000
			});

			const dbAddress = await getCurrentDatabaseAddress(page);
			expect(dbAddress).toBeTruthy();
			await publishWithSeq(page, orch, 'db_published', { dbAddress, todoText });

			await waitForEventWithRepublish(page, orch, {
				criteria: { runId: cfg.runId, role: 'bob', state: 'verified' },
				timeout: 180000,
				republishState: 'start'
			});
		} else {
			await waitForEventWithRepublish(page, orch, {
				criteria: { runId: cfg.runId, role: 'alice', state: 'start' },
				timeout: 120000,
				republishState: 'ready',
				republishMeta: { topic: orch.topic }
			});

			const dbPublished = await waitForEventWithRepublish(page, orch, {
				criteria: { runId: cfg.runId, role: 'alice', state: 'db_published' },
				timeout: 180000,
				republishState: 'ready',
				republishMeta: { topic: orch.topic }
			});
			const dbAddress = dbPublished?.meta?.dbAddress;
			const todoText = dbPublished?.meta?.todoText;
			expect(dbAddress).toBeTruthy();
			expect(todoText).toBeTruthy();

			await page.goto(`/#${dbAddress}`);
			await waitForP2PInitialization(page, 90000);
			await waitForPeerCount(page, 1, 60000);
			await page.evaluate(async () => {
				if (typeof window.forceReloadTodos === 'function') {
					await window.forceReloadTodos();
				}
			});
			await waitForTodoSyncEvent(page, { todoText, timeout: 60000 });
			await expect(page.locator(`[data-todo-text="${todoText}"]`).first()).toBeVisible({
				timeout: 10000
			});

			await publishWithSeq(page, orch, 'verified', { dbAddress, todoText });
		}
	} catch (error) {
		try {
			await publishWithSeq(page, orch, 'failed', { error: error.message });
		} catch {
			// ignore publish failure when page/browser already down
		}
		throw error;
	} finally {
		await writeTimeline({ runId: cfg.runId, role: cfg.role, timeline });
		await context.close();
	}
});
