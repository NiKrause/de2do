import { test, expect } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	ensureAddTodoExpanded,
	waitForP2PInitialization,
	waitForPeerCount,
	waitForTodoText,
	getCurrentDatabaseAddress
} from './helpers.js';
import { createWebAuthnDelegationHelpers } from './webauthn-delegation-helpers.js';
import { restartRelayBetweenTests } from './relay-e2e-server.mjs';

test.describe('Simple Todo WebAuthn delegation (mode matrix, security, replication, embed)', () => {
	test.describe.configure({ mode: 'serial' });

	// Fresh relay + datastore avoids cross-test libp2p / heads state (flaky peer counts).
	// Use `--workers=1` for this file so only one worker touches the relay.
	test.beforeEach(async () => {
		await restartRelayBetweenTests();
	});

	const {
		initializeWithWebAuthn,
		addAndSelectUserByDid,
		waitForTodoAfterDidSwitch,
		ensureTodoListSectionExpanded,
		safeCloseContext,
		runDelegatedFlowForModeCombination
	} = createWebAuthnDelegationHelpers(test, expect);

	test('should verify delegated signatures for alice worker(ed25519) and bob hardware(ed25519)', async ({
		browser
	}) => {
		test.setTimeout(300000);
		await runDelegatedFlowForModeCombination(
			browser,
			'alice-worker-bob-hardware-ed25519',
			{ mode: 'worker' },
			{ mode: 'hardware', hardwareAlgorithm: 'ed25519' }
		);
	});

	test('should verify delegated signatures for alice worker(ed25519) and bob hardware(p-256)', async ({
		browser
	}) => {
		test.setTimeout(300000);
		await runDelegatedFlowForModeCombination(
			browser,
			'alice-worker-bob-hardware-p256',
			{ mode: 'worker' },
			{ mode: 'hardware', hardwareAlgorithm: 'p-256' }
		);
	});

	test('should verify delegated signatures for alice hardware(ed25519) and bob hardware(p-256)', async ({
		browser
	}) => {
		test.setTimeout(300000);
		await runDelegatedFlowForModeCombination(
			browser,
			'alice-hardware-ed25519-bob-hardware-p256',
			{ mode: 'hardware', hardwareAlgorithm: 'ed25519' },
			{ mode: 'hardware', hardwareAlgorithm: 'p-256' }
		);
	});

	test('should verify delegated signatures for alice worker(ed25519) and bob worker(ed25519)', async ({
		browser
	}) => {
		test.setTimeout(300000);
		await runDelegatedFlowForModeCombination(
			browser,
			'alice-worker-ed25519-bob-worker-ed25519',
			{ mode: 'worker' },
			{ mode: 'worker' }
		);
	});

	test('should verify delegated signatures for alice hardware(ed25519) and bob hardware(ed25519)', async ({
		browser
	}) => {
		test.setTimeout(300000);
		await runDelegatedFlowForModeCombination(
			browser,
			'alice-hardware-ed25519-bob-hardware-ed25519',
			{ mode: 'hardware', hardwareAlgorithm: 'ed25519' },
			{ mode: 'hardware', hardwareAlgorithm: 'ed25519' }
		);
	});

	test('should verify delegated signatures for alice hardware(p-256) and bob hardware(p-256)', async ({
		browser
	}) => {
		test.setTimeout(300000);
		await runDelegatedFlowForModeCombination(
			browser,
			'alice-hardware-p256-bob-hardware-p256',
			{ mode: 'hardware', hardwareAlgorithm: 'p-256' },
			{ mode: 'hardware', hardwareAlgorithm: 'p-256' }
		);
	});

	test('should prevent malicious user from editing or completing non-delegated todo', async ({
		browser
	}) => {
		test.setTimeout(300000);
		const contextAlice = await browser.newContext();
		const contextMallory = await browser.newContext();

		const alice = await contextAlice.newPage();
		const mallory = await contextMallory.newPage();

		await initializeWithWebAuthn(alice, 'Alice');
		await initializeWithWebAuthn(mallory, 'Mallory');

		const aliceDid = await alice.evaluate(() => window.__currentIdentityId__ || null);
		expect(aliceDid).toBeTruthy();

		const originalTitle = `Owner only todo ${Date.now()}`;
		const maliciousTitle = `${originalTitle} - hacked`;

		await ensureAddTodoExpanded(alice);
		await alice.getByTestId('todo-input').fill(originalTitle);
		await alice.getByTestId('add-todo-button').click();
		await waitForTodoText(alice, originalTitle, 15000, { browserName: test.info().project.name });

		const aliceDbAddress = await getCurrentDatabaseAddress(alice, 15000);
		expect(aliceDbAddress).toBeTruthy();

		await addAndSelectUserByDid(mallory, aliceDid);

		await expect
			.poll(async () => await getCurrentDatabaseAddress(mallory, 10000), { timeout: 60000 })
			.toBe(aliceDbAddress);

		await waitForPeerCount(mallory, 2, 120000);
		await waitForTodoAfterDidSwitch(mallory, aliceDid, originalTitle);

		// Do not use `:has([data-todo-text=…])` for the row locator: that attribute lives on view-mode markup
		// and disappears when edit mode mounts `AddTodoForm`, which breaks the locator mid-test.
		await expect(mallory.getByTestId('todo-item')).toHaveCount(1);
		const malloryTodoRow = mallory.getByTestId('todo-item').first();
		await expect(malloryTodoRow.locator(`[data-todo-text="${originalTitle}"]`)).toBeVisible({
			timeout: 15000
		});
		await expect(malloryTodoRow.getByTestId('todo-complete-checkbox')).toBeDisabled({
			timeout: 60000
		});

		await malloryTodoRow.getByTitle('Edit todo').click();
		await expect(malloryTodoRow.getByTestId('todo-input')).toBeVisible({ timeout: 15000 });
		await malloryTodoRow.getByTestId('todo-input').fill(maliciousTitle);
		await malloryTodoRow.getByTestId('add-todo-button').click();

		await ensureTodoListSectionExpanded(alice);
		await alice.evaluate(async () => {
			if (typeof window.forceReloadTodos === 'function') {
				await window.forceReloadTodos();
			}
		});
		await expect(alice.locator(`[data-todo-text="${originalTitle}"]`).first()).toBeVisible({
			timeout: 60000
		});
		await expect(alice.locator(`[data-todo-text="${maliciousTitle}"]`)).toHaveCount(0);

		await safeCloseContext(contextAlice);
		await safeCloseContext(contextMallory);
	});

	test('should replicate database when Browser B opens Browser A database by name', async ({
		browser
	}) => {
		test.setTimeout(300000);

		// Create two separate browser contexts (simulating two different browsers)
		const context1 = await browser.newContext();
		const context2 = await browser.newContext();

		const page1 = await context1.newPage();
		const page2 = await context2.newPage();

		// Enable console logging for debugging
		page1.on('console', (msg) => console.log('Page1:', msg.text()));
		page2.on('console', (msg) => console.log('Page2:', msg.text()));

		console.log('🚀 Starting database replication by name test (A -> B)...');

		// ===== BROWSER A (Page 1) =====
		console.log('📱 Browser A: Initializing...');
		await page1.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page1.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		await page1.waitForTimeout(1000);

		// Accept consent and initialize P2P
		await acceptConsentAndInitialize(page1);
		await waitForP2PInitialization(page1);

		// Wait for todo input to be ready
		await ensureAddTodoExpanded(page1);
		const todoInput1 = page1.locator('[data-testid="todo-input"]');
		await expect(todoInput1).toBeVisible({ timeout: 15000 });

		// Get Browser A's identity ID from the database name
		const browserAIdentityId = await page1.evaluate(() => {
			// Try to extract from database name pattern identityId_projects
			if (window.__todoDB__ && window.__todoDB__.name) {
				const name = window.__todoDB__.name;
				if (name.includes('_')) {
					return name.split('_')[0];
				}
			}
			return null;
		});

		// If not found, wait a bit and try again
		let identityIdA = browserAIdentityId;
		if (!identityIdA) {
			await page1.waitForTimeout(2000);
			identityIdA = await page1.evaluate(() => {
				if (window.__todoDB__ && window.__todoDB__.name) {
					const name = window.__todoDB__.name;
					if (name.includes('_')) {
						return name.split('_')[0];
					}
				}
				return null;
			});
		}

		expect(identityIdA).toBeTruthy();
		console.log(`📱 Browser A Identity ID: ${identityIdA?.slice(0, 16)}...`);

		// Add a todo in Browser A
		const testTodoA = 'Todo from Browser A for replication test';
		await todoInput1.fill(testTodoA);
		await page1.locator('[data-testid="add-todo-button"]').click();

		// Wait for todo to appear using robust helper
		await waitForTodoText(page1, testTodoA, 10000, { browserName: test.info().project.name });
		console.log(`✅ Browser A: Added todo "${testTodoA}"`);

		// Wait a bit for the todo to be saved
		await page1.waitForTimeout(2000);

		// ===== BROWSER B (Page 2) =====
		console.log('📱 Browser B: Initializing...');
		await page2.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page2.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		await page2.waitForTimeout(1000);

		// Accept consent and initialize P2P
		await acceptConsentAndInitialize(page2);
		await waitForP2PInitialization(page2);

		// Wait for todo input to be ready
		await ensureAddTodoExpanded(page2);
		const todoInput2 = page2.locator('[data-testid="todo-input"]');
		await expect(todoInput2).toBeVisible({ timeout: 15000 });

		// Wait for peer connections
		console.log('🔗 Browser B: Waiting for peer connections...');
		await waitForPeerCount(page2, 2, 120000);

		// Wait a bit for peer discovery
		await page2.waitForTimeout(5000);

		// Find the Users List input field and paste Browser A's identity ID
		console.log('📋 Browser B: Adding Browser A as tracked user...');
		const usersListInput = page2.locator('#users-list');
		await expect(usersListInput).toBeVisible({ timeout: 10000 });

		// Click on the input to focus it
		await usersListInput.click();
		await page2.waitForTimeout(500);

		// Paste the identity ID and press Enter (simulating user behavior)
		await usersListInput.fill(identityIdA);
		await usersListInput.press('Enter');

		// Wait for the database to be discovered and opened
		// The database should automatically load and replicate
		console.log('⏳ Browser B: Waiting for database discovery and replication...');

		// Wait for the todo to appear (with longer timeout for replication)
		// The database should automatically switch and show Browser A's todos
		// Use robust helper with browser-specific timeout adjustments
		await waitForTodoText(page2, testTodoA, 45000, { browserName: test.info().project.name });

		console.log(`✅ Browser B: Found replicated todo "${testTodoA}"`);

		// ===== SWITCH BACK TO BROWSER B's OWN IDENTITY =====
		console.log('🔄 Browser B: Switching back to own identity...');

		// Click on the users list input to open dropdown first
		await usersListInput.click();
		await page2.waitForTimeout(500);

		// Wait for dropdown to appear
		await page2.waitForSelector('[role="listbox"]', { timeout: 5000 });

		// Get Browser B's identity ID from the dropdown options (the one that's NOT Browser A's)
		const identityIdB = await page2.evaluate(
			(browserAIdentityPrefix) => {
				const usersListDiv = document.querySelector('[role="listbox"]');
				if (usersListDiv) {
					const options = usersListDiv.querySelectorAll('[role="option"]');
					for (const option of options) {
						const text = option.textContent?.trim() || '';
						// Identity IDs are long (66 chars), and we want the one that's NOT Browser A's
						if (text && text.length > 50 && !text.startsWith(browserAIdentityPrefix)) {
							return text;
						}
					}
				}
				return null;
			},
			identityIdA.slice(0, 16)
		);

		expect(identityIdB).toBeTruthy();
		console.log(`📱 Browser B Identity ID: ${identityIdB?.slice(0, 16)}...`);

		// Dropdown is already open from above, no need to click again

		// Find and click on Browser B's own identity in the dropdown
		// The identity should be in the filtered users list
		// Use filter to find the option containing the identity ID (may be truncated in display)
		const browserBIdentityOption = page2
			.locator('[role="option"]')
			.filter({ hasText: identityIdB.slice(0, 16) });
		await expect(browserBIdentityOption).toBeVisible({ timeout: 5000 });
		await browserBIdentityOption.click();
		await page2.waitForTimeout(1000);

		// Wait for the database to switch back to Browser B's own database
		console.log('⏳ Browser B: Waiting for database to switch to own identity...');
		await page2.waitForTimeout(2000);

		// Verify todo input is still available
		await expect(todoInput2).toBeVisible({ timeout: 10000 });

		// Verify Browser B's todo list is empty (testTodoA should not be visible)
		// Use a more robust check - wait a bit and verify the todo is not present
		await page2.waitForTimeout(1000);
		const todoAExists = await page2.locator(`[data-todo-text="${testTodoA}"]`).count();
		expect(todoAExists).toBe(0);
		console.log('✅ Browser B: Switched to own identity, todo list is empty');

		// ===== ADD TWO NEW TODOS IN BROWSER B =====
		console.log('📝 Browser B: Adding two new todos...');
		const testTodoB1 = 'Todo 1 from Browser B';
		const testTodoB2 = 'Todo 2 from Browser B';

		// Add first todo
		await todoInput2.fill(testTodoB1);
		await page2.locator('[data-testid="add-todo-button"]').click();
		await waitForTodoText(page2, testTodoB1, 10000, { browserName: test.info().project.name });
		console.log(`✅ Browser B: Added todo "${testTodoB1}"`);

		// Add second todo
		await todoInput2.fill(testTodoB2);
		await page2.locator('[data-testid="add-todo-button"]').click();
		await waitForTodoText(page2, testTodoB2, 10000, { browserName: test.info().project.name });
		console.log(`✅ Browser B: Added todo "${testTodoB2}"`);

		// Wait a bit for todos to be saved
		await page2.waitForTimeout(2000);

		// ===== CLICK ON BROWSER B's IDENTITY IN USERLIST TO COPY IT =====
		console.log('📋 Browser B: Clicking on own identity to copy it...');
		await usersListInput.click();
		await page2.waitForTimeout(500);

		// Wait for dropdown
		await page2.waitForSelector('[role="listbox"]', { timeout: 5000 });

		// Click on Browser B's identity again (this will copy it to clipboard)
		await browserBIdentityOption.click();
		await page2.waitForTimeout(1000);

		// Get the identity ID from clipboard (or use the one we already have)
		// Note: Playwright clipboard access might be limited, so we'll use the identityIdB we already have
		console.log(`📋 Browser B: Identity ID copied (${identityIdB?.slice(0, 16)}...)`);

		// ===== GO BACK TO BROWSER A AND ADD BROWSER B's IDENTITY =====
		console.log('🔄 Browser A: Adding Browser B as tracked user...');

		// Find the Users List input field in Browser A
		const usersListInputA = page1.locator('#users-list');
		await expect(usersListInputA).toBeVisible({ timeout: 10000 });

		// Click on the input to focus it
		await usersListInputA.click();
		await page1.waitForTimeout(500);

		// Paste Browser B's identity ID and press Enter
		await usersListInputA.fill(identityIdB);
		await usersListInputA.press('Enter');

		// Wait for the database to be discovered and opened
		console.log('⏳ Browser A: Waiting for Browser B database discovery and replication...');
		await page1.waitForTimeout(2000); // Give time for database discovery

		// Wait for Browser B's todos to appear in Browser A using robust helper
		await waitForTodoText(page1, testTodoB1, 45000, { browserName: test.info().project.name });
		await waitForTodoText(page1, testTodoB2, 45000, { browserName: test.info().project.name });

		console.log(`✅ Browser A: Found replicated todos from Browser B`);
		console.log(`   - "${testTodoB1}"`);
		console.log(`   - "${testTodoB2}"`);

		// Clean up
		await context1.close();
		await context2.close();

		console.log('✅ Database replication by name test completed successfully!');
	});

	test('should load todo list in embed mode via hash URL', async ({ page }) => {
		console.log('🧪 Testing embed URL functionality...');

		// Step 1: Initialize P2P and create a todo
		await page.goto('/');
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);
		await page.waitForTimeout(1000);

		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);

		// Add a test todo
		const testTodoEmbed = 'Todo for embed test';
		await ensureAddTodoExpanded(page);
		const todoInput = page.locator('[data-testid="todo-input"]');
		await expect(todoInput).toBeVisible({ timeout: 10000 });
		await todoInput.fill(testTodoEmbed);
		await page.locator('[data-testid="add-todo-button"]').click();

		// Wait for todo to appear
		await waitForTodoText(page, testTodoEmbed, 10000, { browserName: test.info().project.name });
		console.log(`✅ Added todo "${testTodoEmbed}"`);

		// Step 2: Get the database address
		const dbAddress = await getCurrentDatabaseAddress(page);
		expect(dbAddress).toBeTruthy();
		console.log(`📋 Database address: ${dbAddress?.slice(0, 20)}...`);

		// Step 3: Navigate to embed URL using hash
		const embedUrl = `/#/embed/${encodeURIComponent(dbAddress)}`;
		console.log(`🔗 Navigating to embed URL: ${embedUrl}`);
		await page.goto(embedUrl);

		// Step 4: Wait for embed page to load and initialize
		// Wait for the page to be ready (main element should be visible)
		await page.waitForSelector('main', { timeout: 30000 });

		// Wait for P2P initialization in embed mode
		await page.waitForFunction(
			() => {
				// Check if we're past the loading state
				const main = document.querySelector('main');
				if (!main) return false;
				// Check if there's content (either todos or error)
				const hasContent = main.textContent && main.textContent.trim().length > 0;
				const isLoading = main.textContent?.includes('Loading todo list');
				return hasContent && !isLoading;
			},
			{ timeout: 30000 }
		);

		// Wait a bit more for the embed to fully load
		await page.waitForTimeout(2000);

		// Step 5: Verify the todo appears in embed view
		await waitForTodoText(page, testTodoEmbed, 30000, { browserName: test.info().project.name });
		console.log(`✅ Todo "${testTodoEmbed}" found in embed view`);

		// Step 6: Verify embed-specific UI elements
		// The embed view should not show the add todo form by default (unless allowAdd=true)
		// Check for the todo input field which should not be visible in read-only embed mode
		const todoInputInEmbed = page.locator('[data-testid="todo-input"]');
		await expect(todoInputInEmbed).not.toBeVisible({ timeout: 5000 });
		console.log('✅ Embed view is read-only by default (no add form)');

		console.log('✅ Embed URL test completed successfully!');
	});
});
