import {
	ensureAddTodoExpanded,
	ensureSettingsExpanded,
	waitForP2PInitialization,
	waitForPeerCount,
	getCurrentDatabaseAddress,
	waitForTodoText,
	addVirtualAuthenticator,
	setupPasskeyViaP2PassPanel,
	waitForFooterIdentityModeAfterPasskeyBridge,
	waitForDidKeyIdentityId
} from './helpers.js';

/**
 * Shared WebAuthn + delegated-flow helpers for simple-todo E2E specs.
 * @param {import('@playwright/test').TestType} test - Playwright test (for test.info())
 * @param {import('@playwright/test').Expect} expect
 */
export function createWebAuthnDelegationHelpers(test, expect) {
	const relayApiPassword = process.env.RELAY_API_PASSWORD || process.env.API_PASSWORD || '';

	async function forceHardwareCredentialAlgorithm(page, algorithm) {
		if (!algorithm) return;
		await page.addInitScript((forcedAlgorithm) => {
			const credentials = navigator?.credentials;
			if (!credentials || typeof credentials.create !== 'function') return;
			const originalCreate = credentials.create.bind(credentials);
			const allowedAlgs =
				forcedAlgorithm === 'p-256' ? [-7] : forcedAlgorithm === 'ed25519' ? [-8, -50] : null;
			if (!allowedAlgs) return;

			credentials.create = async (options) => {
				try {
					const publicKey = options?.publicKey;
					const params = publicKey?.pubKeyCredParams;
					if (Array.isArray(params)) {
						const filteredParams = params.filter((entry) =>
							allowedAlgs.includes(Number(entry?.alg))
						);
						if (filteredParams.length > 0) {
							options = {
								...options,
								publicKey: {
									...publicKey,
									pubKeyCredParams: filteredParams
								}
							};
						}
					}
				} catch {
					// ignore option rewrite errors and continue with original call
				}

				return await originalCreate(options);
			};
		}, algorithm);
	}

	async function fetchRelayJson(pathname) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);
		try {
			const response = await fetch(`http://127.0.0.1:3000${pathname}`, {
				signal: controller.signal,
				headers: relayApiPassword
					? {
							Authorization: `Bearer ${relayApiPassword}`
						}
					: undefined
			});
			let body = null;
			try {
				body = await response.json();
			} catch {
				// ignore JSON parse errors, caller handles non-JSON/404
			}
			return { ok: response.ok, status: response.status, body };
		} catch (error) {
			return { ok: false, status: 0, body: null, error: error?.message || String(error) };
		} finally {
			clearTimeout(timeout);
		}
	}

	async function postRelayJson(pathname, payload, timeoutMs = 5000) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const headers = {
				'Content-Type': 'application/json'
			};
			if (relayApiPassword) {
				headers.Authorization = `Bearer ${relayApiPassword}`;
			}
			const response = await fetch(`http://127.0.0.1:3000${pathname}`, {
				method: 'POST',
				signal: controller.signal,
				headers,
				body: JSON.stringify(payload ?? {})
			});
			let body = null;
			try {
				body = await response.json();
			} catch {
				// ignore JSON parse errors
			}
			return { ok: response.ok, status: response.status, body };
		} catch (error) {
			return { ok: false, status: 0, body: null, error: error?.message || String(error) };
		} finally {
			clearTimeout(timeout);
		}
	}

	async function getRelayPinningStatsOrThrow() {
		const result = await fetchRelayJson('/pinning/stats');
		if (!result.ok || !result.body) {
			throw new Error(
				`Relay pinning stats endpoint unavailable (status=${result.status}). ` +
					`Run tests with local relay (RELAY_IMPL=local) to assert pinning.`
			);
		}
		return result.body;
	}

	async function isRelayPinningHttpAvailable() {
		const result = await fetchRelayJson('/pinning/stats');
		return Boolean(result.ok && result.body);
	}

	async function waitForRelayPinnedDatabaseOrThrow(dbAddress, failedSyncsBefore = 0, timeout = 45000) {
		const startedAt = Date.now();
		let lastPayload = null;
		let lastStats = null;
		while (Date.now() - startedAt < timeout) {
			const statsResult = await fetchRelayJson('/pinning/stats');
			if (!statsResult.ok || !statsResult.body) {
				throw new Error(
					`Relay pinning stats endpoint unavailable during pin wait (status=${statsResult.status}).`
				);
			}
			lastStats = statsResult.body;
			const failedSyncsCurrent = Number(lastStats?.failedSyncs || 0);
			if (failedSyncsCurrent > failedSyncsBefore) {
				throw new Error(
					`Relay pinning failed while waiting for DB ${dbAddress}. ` +
						`failedSyncs increased ${failedSyncsBefore} -> ${failedSyncsCurrent}. ` +
						`Latest /pinning/stats: ${JSON.stringify(lastStats)}`
				);
			}

			const result = await fetchRelayJson('/pinning/databases');
			if (!result.ok || !result.body) {
				throw new Error(
					`Relay pinning databases endpoint unavailable (status=${result.status}). ` +
						`Run tests with local relay (RELAY_IMPL=local) to assert pinning.`
				);
			}
			lastPayload = result.body;
			const databases = Array.isArray(result.body.databases) ? result.body.databases : [];
			if (databases.some((entry) => entry?.address === dbAddress)) {
				return result.body;
			}
			await new Promise((resolve) => setTimeout(resolve, 1500));
		}
		throw new Error(
			`Relay did not report pinned database within ${timeout}ms: ${dbAddress}. ` +
				`Last /pinning/databases payload: ${JSON.stringify(lastPayload)}. ` +
				`Last /pinning/stats payload: ${JSON.stringify(lastStats)}`
		);
	}

	async function safeCloseContext(context) {
		if (!context) return;
		try {
			await context.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes('ENOENT')) {
				console.warn('⚠️ Ignoring context close ENOENT during artifact flush:', message);
				return;
			}
			if (message.includes('Target page, context or browser has been closed')) {
				console.warn('⚠️ Ignoring context close (already closed):', message);
				return;
			}
			throw error;
		}
	}

	async function initializeWithWebAuthn(page, label = 'User', options = {}) {
		const { mode = 'worker', hardwareAlgorithm = null } = options;
		await addVirtualAuthenticator(page);
		if (mode === 'hardware') {
			await forceHardwareCredentialAlgorithm(page, hardwareAlgorithm);
		}
		await page.goto('http://localhost:4174/');
		await page.waitForFunction(
			() =>
				document.querySelector('main') !== null ||
				document.querySelector('[data-testid="consent-modal"]') !== null,
			{ timeout: 30000 }
		);
		await page.waitForTimeout(1000);

		console.log(`📱 ${label}: Accepting consent...`);
		const consentModal = page.locator('[data-testid="consent-modal"]');
		await expect(consentModal).toBeVisible({ timeout: 10000 });
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.getByTestId('consent-accept-button').click();
		await expect(consentModal).not.toBeVisible();

		console.log(`🔐 ${label}: Waiting for P2P, then passkey via P2Pass…`);
		await waitForP2PInitialization(page);

		const signingMode =
			mode === 'hardware'
				? hardwareAlgorithm === 'p-256'
					? 'hardware-p256'
					: 'hardware-ed25519'
				: 'worker';
		await setupPasskeyViaP2PassPanel(page, { mode: signingMode });

		await waitForFooterIdentityModeAfterPasskeyBridge(page, 60000);

		const identityMode = page.getByTestId('identity-mode');
		if (mode === 'worker') {
			await expect(identityMode).toContainText(/software|worker \(ed25519\)/i, { timeout: 15000 });
		} else if (hardwareAlgorithm === 'p-256') {
			await expect(identityMode).toContainText(/software|hardware \(p-256\)/i, { timeout: 15000 });
		} else if (hardwareAlgorithm === 'ed25519') {
			await expect(identityMode).toContainText(/software|hardware \(ed25519\)/i, { timeout: 15000 });
		} else {
			await expect(identityMode).toContainText(/software|hardware \((ed25519|p-256)\)/i, {
				timeout: 15000
			});
		}
	}

	async function runDelegatedFlowForModeCombination(browser, scenarioName, aliceOptions, bobOptions) {
		const contextAlice = await browser.newContext();
		const contextBob = await browser.newContext();
		const alice = await contextAlice.newPage();
		const bob = await contextBob.newPage();

		try {
			await initializeWithWebAuthn(alice, 'Alice', aliceOptions);

			const aliceDid = await waitForDidKeyIdentityId(alice);
			const relayPinningHttpAvailable = await isRelayPinningHttpAvailable();
			let failedSyncsBefore = 0;
			if (relayPinningHttpAvailable) {
				const pinningStatsBefore = await getRelayPinningStatsOrThrow();
				failedSyncsBefore = Number(pinningStatsBefore?.failedSyncs || 0);
			} else {
				console.warn(
					`⚠️ ${scenarioName}: relay has no /pinning/* HTTP API; mixed-mode test will rely on live P2P replication only`
				);
			}

			const originalTitle = `Delegated mixed-mode todo ${scenarioName} ${Date.now()}`;
			const originalDescription = `Original description ${scenarioName}`;
			const updatedTitle = `${originalTitle} - updated by Bob`;
			const updatedDescription = `Updated by Bob via delegation ${scenarioName}`;

			await initializeWithWebAuthn(bob, 'Bob', bobOptions);
			const bobDid = await waitForDidKeyIdentityId(bob);

			await ensureAddTodoExpanded(alice);
			await alice.getByRole('button', { name: /Show Advanced Fields/i }).click();
			await alice.getByTestId('todo-input').fill(originalTitle);
			await alice.locator('#add-todo-description').fill(originalDescription);
			await alice.locator('#add-todo-delegate-did').fill(bobDid);
			await alice.getByTestId('add-todo-button').click();
			await waitForTodoText(alice, originalTitle, 15000, { browserName: test.info().project.name });

			const aliceOriginalTodoRow = alice
				.locator('div.rounded-md.border', {
					has: alice.locator(`[data-todo-text="${originalTitle}"]`)
				})
				.first();
			await expect(aliceOriginalTodoRow.locator(`text=${bobDid}`)).toBeVisible({ timeout: 15000 });

			const aliceDbAddress = await getCurrentDatabaseAddress(alice, 15000);
			expect(aliceDbAddress).toBeTruthy();
			await assertAccessControllerType(alice, 'todo-delegation', 30000);
			if (relayPinningHttpAvailable) {
				const syncResponse = await postRelayJson(
					'/pinning/sync',
					{ dbAddress: aliceDbAddress },
					30000
				);
				if (!syncResponse.ok && syncResponse.status !== 0) {
					throw new Error(
						`Relay /pinning/sync failed (status=${syncResponse.status}) for ${aliceDbAddress}. ` +
							`Response: ${JSON.stringify(syncResponse.body)}`
					);
				}
				await waitForRelayPinnedDatabaseOrThrow(aliceDbAddress, failedSyncsBefore, 45000);
			}

			await addAndSelectUserByDid(bob, aliceDid);

			await expect
				.poll(async () => await getCurrentDatabaseAddress(bob, 10000), { timeout: 60000 })
				.toBe(aliceDbAddress);
			await assertAccessControllerType(bob, 'todo-delegation', 30000);

			await waitForPeerCount(bob, 2, 120000);
			await waitForTodoAfterDidSwitch(bob, aliceDid, originalTitle);

			const bobTodoTextForEdit = bob
				.locator('[data-testid="todo-text"]')
				.filter({ hasText: originalTitle })
				.first();
			if ((await bobTodoTextForEdit.count()) === 0) {
				await expect(bob.locator('[data-testid="todo-text"]').first()).toBeVisible({
					timeout: 60000
				});
			}
			const effectiveTodoText =
				(await bobTodoTextForEdit.count()) > 0
					? bobTodoTextForEdit
					: bob.locator('[data-testid="todo-text"]').first();
			const bobTodoRowForEdit = effectiveTodoText
				.locator('xpath=ancestor::div[contains(@class,"rounded-md") and contains(@class,"border")]')
				.first();
			await expect(bobTodoRowForEdit).toBeVisible({ timeout: 60000 });
			await bobTodoRowForEdit.scrollIntoViewIfNeeded();
			const editButton = bobTodoRowForEdit.locator('button[title="Edit todo"]').first();
			await expect(editButton).toBeVisible({ timeout: 60000 });
			await editButton.click();
			const editFormInput = bob.locator('input[placeholder="Edit todo..."]').first();
			await expect(editFormInput).toBeVisible({ timeout: 30000 });
			const editFormContainer = editFormInput
				.locator('xpath=ancestor::div[contains(@class,"mb-6") and contains(@class,"shadow-md")]')
				.first();
			await editFormInput.fill(updatedTitle);
			await editFormContainer.locator('#add-todo-description').first().fill(updatedDescription);
			const saveButton = editFormContainer.locator('[data-testid="add-todo-button"]').first();
			await saveButton.click();
			const delegatedAuthState = bob.getByTestId('delegated-auth-state');
			await assertDelegatedStateAfterAction(bob, delegatedAuthState);

			await waitForTodoText(bob, updatedTitle, 30000, { browserName: test.info().project.name });

			const bobTodoRow = bob
				.locator('div.rounded-md.border', {
					has: bob.locator(`[data-todo-text="${updatedTitle}"]`)
				})
				.first();
			await bobTodoRow.locator('input[type="checkbox"]').click();
			await assertDelegatedStateAfterAction(bob, delegatedAuthState);

			const aliceTodoRow = alice
				.locator('div.rounded-md.border', {
					has: alice.locator(`[data-todo-text="${updatedTitle}"]`)
				})
				.first();
			await expect(aliceTodoRow.locator('input[type="checkbox"]')).toBeChecked({ timeout: 60000 });
			await expect(alice.locator('text=' + updatedDescription).first()).toBeVisible({
				timeout: 60000
			});

			if (relayPinningHttpAvailable) {
				const pinningStatsAfter = await getRelayPinningStatsOrThrow();
				const failedSyncsAfter = Number(pinningStatsAfter?.failedSyncs || 0);
				expect(failedSyncsAfter).toBeLessThanOrEqual(failedSyncsBefore);
			}
		} finally {
			await safeCloseContext(contextAlice);
			await safeCloseContext(contextBob);
		}
	}

	async function addAndSelectUserByDid(page, did) {
		await ensureSettingsExpanded(page);
		const usersInput = page.locator('#users-list');
		await expect(usersInput).toBeVisible({ timeout: 15000 });
		await usersInput.click();
		await usersInput.fill(did);
		await usersInput.press('Enter');
		await page.waitForTimeout(500);

		const addButton = page.locator('button[title="Add identity"]');
		if (await addButton.isEnabled().catch(() => false)) {
			await addButton.click();
			await page.waitForTimeout(500);
		}

		await usersInput.click();
		await usersInput.fill(did);
		await usersInput.press('Enter');
	}

	async function ensureTodoListSectionExpanded(page) {
		const toggle = page.getByRole('button', { name: /Todo List/i }).first();
		await expect(toggle).toBeVisible({ timeout: 15000 });
		if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
			await toggle.click();
		}
	}

	async function waitForTodoAfterDidSwitch(page, did, todoText) {
		void did;
		const project = test.info().project.name;
		await ensureTodoListSectionExpanded(page);
		const deadline = Date.now() + 120000;
		while (Date.now() < deadline) {
			await page.evaluate(async () => {
				if (typeof window.forceReloadTodos === 'function') {
					await window.forceReloadTodos();
				}
			});
			await ensureTodoListSectionExpanded(page);
			try {
				await expect(page.locator(`[data-todo-text="${todoText}"]`).first()).toBeVisible({
					timeout: 8000
				});
				console.log(`✅ Todo visible after DID switch: ${todoText.slice(0, 64)}…`);
				return;
			} catch {
				// Replication or UI still catching up — retry after a short pause.
			}
			await page.waitForTimeout(3000);
		}
		await waitForTodoText(page, todoText, 10000, { browserName: project });
	}

	async function getCurrentAccessControllerType(page) {
		return await page.evaluate(() => window.__todoDB__?.access?.type || null);
	}

	async function getCurrentDbName(page) {
		return await page.evaluate(() => window.__todoDB__?.name || null);
	}

	async function assertAccessControllerType(page, expectedType, timeout = 30000) {
		await expect
			.poll(async () => await getCurrentAccessControllerType(page), { timeout })
			.toBe(expectedType);
	}

	async function getTodoDiagnostics(page, targetText = null) {
		return await page.evaluate(
			async ({ wantedText }) => {
				const todoTexts = Array.from(document.querySelectorAll('[data-testid="todo-text"]'));
				const todoValues = todoTexts.map((node) =>
					(node.textContent || '').replace(/\s+/g, ' ').trim()
				);
				const targetTodoTextNode = wantedText
					? todoTexts.find((node) => (node.textContent || '').includes(wantedText))
					: todoTexts[0] || null;
				const targetCard = targetTodoTextNode?.closest('div.rounded-md.border') || null;
				const targetCardText = targetCard
					? (targetCard.textContent || '').replace(/\s+/g, ' ').trim()
					: null;
				const targetHasEdit = !!targetCard?.querySelector('button[title="Edit todo"]');
				const delegatedAuth = document.querySelector('[data-testid="delegated-auth-state"]');
				const delegatedAuthState = delegatedAuth?.getAttribute('data-state') || null;
				const identityMode =
					document.querySelector('[data-testid="identity-mode"]')?.textContent?.trim() || null;

				let dbAddress = null;
				let dbName = null;
				let dbAccessType = null;
				let dbEntries = null;
				let actionEntries = 0;
				let logMeta = null;

				try {
					const db = window.__todoDB__;
					dbAddress = db?.address || null;
					dbName = db?.name || null;
					dbAccessType = db?.access?.type || null;

					if (db?.all) {
						const all = await db.all();
						if (Array.isArray(all)) {
							dbEntries = all.length;
							actionEntries = all.filter((entry) => {
								const value = entry?.value || entry;
								return value?.type === 'delegation-action';
							}).length;
						}
					}

					const log = db?.log;
					logMeta = {
						hasLog: !!log,
						logKeys: log ? Object.keys(log).slice(0, 12) : [],
						hasHeads: !!log?.heads,
						headsType: log?.heads ? typeof log.heads : null,
						hasValues: !!log?.values,
						valuesType: log?.values ? typeof log.values : null
					};
				} catch (error) {
					logMeta = { error: error?.message || String(error) };
				}

				return {
					cardCount: todoTexts.length,
					cardTexts: todoValues.slice(0, 3),
					targetFound: !!targetCard,
					targetHasEdit,
					targetCardText,
					delegatedAuthState,
					identityMode,
					dbAddress,
					dbName,
					dbAccessType,
					dbEntries,
					actionEntries,
					logMeta
				};
			},
			{ wantedText: targetText }
		);
	}

	async function assertDelegatedStateAfterAction(page, delegatedAuthState) {
		// `requireDelegatedWriteAuthentication` sets `awaiting` on a later tick; the first read is
		// often still `idle`, so we must not treat that as "done" and skip waiting for WebAuthn.
		try {
			await expect
				.poll(async () => await delegatedAuthState.getAttribute('data-state'), {
					timeout: 10000,
					intervals: [50, 100, 200, 400]
				})
				.toMatch(/^(awaiting|success|error)$/);
		} catch {
			await expect(delegatedAuthState).toHaveAttribute('data-state', 'idle');
			return;
		}

		const state = await delegatedAuthState.getAttribute('data-state');
		if (state === 'error') {
			const msg = (await delegatedAuthState.textContent())?.trim() || '';
			throw new Error(`Delegated auth failed: ${msg}`);
		}
		if (state === 'success') return;
		await expect(delegatedAuthState).toHaveAttribute('data-state', 'success', { timeout: 25000 });
	}

	return {
		forceHardwareCredentialAlgorithm,
		fetchRelayJson,
		postRelayJson,
		getRelayPinningStatsOrThrow,
		isRelayPinningHttpAvailable,
		waitForRelayPinnedDatabaseOrThrow,
		safeCloseContext,
		initializeWithWebAuthn,
		runDelegatedFlowForModeCombination,
		addAndSelectUserByDid,
		ensureTodoListSectionExpanded,
		waitForTodoAfterDidSwitch,
		getCurrentAccessControllerType,
		getCurrentDbName,
		assertAccessControllerType,
		getTodoDiagnostics,
		assertDelegatedStateAfterAction
	};
}
