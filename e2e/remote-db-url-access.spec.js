import { test, expect, chromium } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress,
	waitForTodoText,
	ensureAddTodoExpanded,
	ensureSettingsExpanded,
	ensureTodoListSectionExpanded,
	waitForPeerCount,
	E2E_TWO_BROWSER_PEER_TIMEOUT_MS,
	waitForTodoSyncEvent
} from './helpers.js';

// Mark intentionally unused test helpers so eslint doesn't complain
void chromium;

/** Same as e2e/encryption.spec.js but avoids `/?#//orbitdb/...` when address has a leading slash. */
function urlForDbAddress(address) {
	const path = address.startsWith('/') ? address.slice(1) : address;
	return `/?#/${path}`;
}

/**
 * Raw `#/orbitdb/...` routes open without encryption (see hash-router handleAddressRoute).
 * Encrypted databases must be unlocked after load — same for returning users and new contexts.
 */
async function unlockEncryptedDbOpenedByAddressUrl(page, password) {
	await ensureSettingsExpanded(page);
	await page.waitForFunction(() => typeof window.__e2eRequestInlineUnlock === 'function', {
		timeout: 30000
	});
	await page.evaluate(() => window.__e2eRequestInlineUnlock());
	await expect(page.getByTestId('inline-unlock-panel')).toBeVisible({ timeout: 20000 });
	await page.getByTestId('inline-unlock-password').fill(password);
	await page.getByTestId('inline-unlock-button').click();
}

/**
 * Focused test for opening databases via URL in new browser contexts
 *
 * This test isolates Step 7 and Step 8 from per-database-encryption.spec.js:
 * - Step 7: Open unencrypted database via URL (should NOT show password modal)
 * - Step 8: Open encrypted database via URL and unlock inline so todos become visible
 */
test.describe('Remote Database URL Access', () => {
	test.setTimeout(420000); // setup + two URL contexts + encrypted sync (aligned with encryption.spec.js browser B flow)

	test('should handle opening unencrypted and encrypted databases via URL', async ({ browser }) => {
		const timestamp = Date.now();

		// Project names
		const unencryptedProjectName = `project-plain-${timestamp}`;
		const encryptedProjectName = `project-encrypted-${timestamp}`;

		// Password for encrypted project
		const password = `pass-${timestamp}`;

		console.log('\n🚀 Starting remote database URL access test...\n');
		console.log(`📋 Unencrypted project: ${unencryptedProjectName}`);
		console.log(`📋 Encrypted project: ${encryptedProjectName}`);
		console.log(`🔑 Password: ${password}`);

		// ============================================================================
		// SETUP: Create projects in first browser context
		// ============================================================================
		console.log('\n📝 SETUP: Creating projects...\n');

		const context1 = await browser.newContext();
		const page1 = await context1.newPage();

		await page1.goto('/');
		await acceptConsentAndInitialize(page1);
		await waitForP2PInitialization(page1);

		// Create unencrypted project with a todo
		await createProjectWithTodos(page1, unencryptedProjectName, false, '', [
			`Task 1-1 of ${unencryptedProjectName}`
		]);

		// Get address of unencrypted project
		const unencryptedAddress = await getCurrentDatabaseAddress(page1);
		console.log(`✅ Unencrypted project address: ${unencryptedAddress}`);

		// Create encrypted project with a todo
		await createProjectWithTodos(page1, encryptedProjectName, true, password, [
			`Task 2-1 of ${encryptedProjectName}`
		]);

		// Get address of encrypted project
		const encryptedAddress = await getCurrentDatabaseAddress(page1);
		console.log(`✅ Encrypted project address: ${encryptedAddress}`);

		// ============================================================================
		// STEP 1: Open unencrypted database via URL (should NOT show password modal)
		// ============================================================================
		console.log('\n🌐 STEP 1: Opening unencrypted database via URL...\n');

		// Make sure the source browser is serving the unencrypted database before the
		// second context tries to open it by address.
		await page1.goto(urlForDbAddress(unencryptedAddress));
		await waitForTodoText(page1, `Task 1-1 of ${unencryptedProjectName}`, 30000);

		const context2 = await browser.newContext();
		const page2 = await context2.newPage();

		// Capture browser console logs
		const browserLogs = [];
		page2.on('console', (msg) => {
			const text = msg.text();
			if (
				text.includes('password') ||
				text.includes('encryption') ||
				text.includes('Encryption') ||
				text.includes('Password') ||
				text.includes('Error') ||
				text.includes('decrypt')
			) {
				browserLogs.push(`[Browser] ${text}`);
				console.log(`[Browser] ${text}`);
			}
		});

		await page2.goto(urlForDbAddress(unencryptedAddress));
		console.log(`→ Navigated to: ${urlForDbAddress(unencryptedAddress)}`);

		// Wait for initialization and database to load
		await waitForP2PInitialization(page2);
		console.log('→ P2P initialized in new browser context');

		// Should NOT show password modal
		const passwordModal1 = page2.locator('text=/enter.*password/i').first();
		const hasPasswordModal1 = await passwordModal1.isVisible({ timeout: 3000 }).catch(() => false);

		if (hasPasswordModal1) {
			console.error('❌ Password modal appeared for unencrypted database!');
			console.log('  → Browser logs:');
			browserLogs.slice(-10).forEach((log) => console.log(`    ${log}`));
		}

		expect(hasPasswordModal1).toBe(false);
		console.log('✅ No password modal for unencrypted project (correct)');

		// Alice (page1) stays open. Only page2 must show relay + creator for replicated sync;
		// page1’s footer can stay at 1 until the second tab fully meshes, so do not Promise.all on page1.
		await waitForPeerCount(page2, 2, E2E_TWO_BROWSER_PEER_TIMEOUT_MS);
		await page2.evaluate(async () => {
			if (typeof window.forceReloadTodos === 'function') {
				await window.forceReloadTodos();
			}
		});
		await waitForTodoSyncEvent(page2, {
			todoText: `Task 1-1 of ${unencryptedProjectName}`,
			timeout: 60000
		});
		await verifyTodosVisible(page2, [`Task 1-1 of ${unencryptedProjectName}`], { timeout: 60000 });
		console.log('✅ Unencrypted project todos visible in new browser');

		await safeClose(context2, 'context2');

		// ============================================================================
		// STEP 2: Open encrypted database via URL and unlock it inline
		// ============================================================================
		console.log('\n🌐 STEP 2: Opening encrypted database via URL...\n');

		const encryptedTodoText = `Task 2-1 of ${encryptedProjectName}`;
		// Same URL hash on Alice and new browser; address routes never pass a password — unlock inline.
		await page1.goto(urlForDbAddress(encryptedAddress));
		await waitForP2PInitialization(page1, 60000);
		await page1.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

		const context3 = await browser.newContext();
		const page3 = await context3.newPage();

		// Capture browser console logs
		const browserLogs2 = [];
		page3.on('console', (msg) => {
			const text = msg.text();
			if (
				text.includes('password') ||
				text.includes('encryption') ||
				text.includes('Encryption') ||
				text.includes('Password') ||
				text.includes('Error') ||
				text.includes('decrypt') ||
				text.includes('switchToTodoList') ||
				text.includes('openDatabase')
			) {
				browserLogs2.push(`[Browser] ${text}`);
				console.log(`[Browser] ${text}`);
			}
		});

		await page3.goto(urlForDbAddress(encryptedAddress));
		console.log(`→ Navigated to: ${urlForDbAddress(encryptedAddress)}`);

		await waitForP2PInitialization(page3, 60000);
		console.log('→ P2P initialized in new browser context');

		await page3.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
		// Both tabs must be up before footer can show relay + other browser (simple-todo pattern).
		await Promise.all([
			waitForPeerCount(page1, 2, E2E_TWO_BROWSER_PEER_TIMEOUT_MS),
			waitForPeerCount(page3, 2, E2E_TWO_BROWSER_PEER_TIMEOUT_MS)
		]);

		await unlockEncryptedDbOpenedByAddressUrl(page1, password);
		await page1.evaluate(async () => {
			if (typeof window.forceReloadTodos === 'function') {
				await window.forceReloadTodos();
			}
		});
		await ensureTodoListSectionExpanded(page1);
		await waitForTodoText(page1, encryptedTodoText, 120000);

		console.log('→ Unlocking encrypted DB opened by address URL (new browser)...');
		await unlockEncryptedDbOpenedByAddressUrl(page3, password);
		await page3.evaluate(async () => {
			if (typeof window.forceReloadTodos === 'function') {
				await window.forceReloadTodos();
			}
		});
		await ensureTodoListSectionExpanded(page3);
		await waitForTodoText(page3, encryptedTodoText, 120000);
		console.log('✅ Encrypted project todos visible after password entry');

		await safeClose(context3, 'context3');
		await safeClose(context1, 'context1');

		console.log('\n✅ All remote database URL access tests passed!\n');
	});
});

// =============================================================================
// Helper Functions (copied from per-database-encryption.spec.js)
// =============================================================================

/**
 * Create a project and add todos to it
 */
async function createProjectWithTodos(page, projectName, encrypted, password, todoTexts) {
	// Open TodoListSelector
	const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
	await todoListInput.click();
	await page.waitForTimeout(800);

	// Clear input
	const currentValue = await todoListInput.inputValue();

	if (currentValue && currentValue.trim() !== '') {
		await todoListInput.press('Control+A').catch(() => {});
		await todoListInput.press('Meta+A').catch(() => {});
		await todoListInput.press('Backspace');
		await page.waitForTimeout(200);

		const stillHasValue = await todoListInput.inputValue();
		if (stillHasValue && stillHasValue.trim() !== '') {
			for (let i = 0; i <= stillHasValue.length; i++) {
				await todoListInput.press('Backspace');
			}
			await page.waitForTimeout(200);
		}
	}

	// Type the new project name
	await todoListInput.type(projectName, { delay: 50 });
	await page.waitForTimeout(500);

	// Verify what we're about to submit
	const valueBeforeSubmit = await todoListInput.inputValue();
	if (valueBeforeSubmit !== projectName) {
		console.warn(
			`⚠️ Input value before submit is "${valueBeforeSubmit}", expected "${projectName}"`
		);
		await todoListInput.press('Control+A').catch(() => {});
		await todoListInput.press('Meta+A').catch(() => {});
		await todoListInput.fill(projectName);
		await page.waitForTimeout(300);
	}

	// Click create button or press Enter
	await todoListInput.press('Enter');

	// Wait for project to be created
	await page.waitForTimeout(6000);

	console.log(`  ✓ Created project: ${projectName}${encrypted ? ' 🔐' : ''}`);

	// If this project should be encrypted, enable encryption immediately
	if (encrypted) {
		console.log(`  → Enabling encryption for project ${projectName}...`);

		// Enable encryption checkbox
		const encryptionCheckbox = page
			.locator('input[type="checkbox"]:near(:text("Enable Encryption"))')
			.first();
		await encryptionCheckbox.check();
		await page.waitForTimeout(300);

		// Enter password
		const passwordInput = page.locator('input[type="password"][placeholder*="password" i]').first();
		await passwordInput.fill(password);
		await page.waitForTimeout(300);

		// Click "Apply Encryption" button
		const applyButton = page.locator('button:has-text("Apply Encryption")').first();
		await applyButton.click();

		// Wait for the app's persistent encrypted-state indicator instead of relying on the
		// transient success toast, which can race in CI/local runs.
		const encryptionActiveIndicator = page.getByTestId('encryption-active-indicator');
		await expect(encryptionActiveIndicator).toBeVisible({ timeout: 30000 });
		console.log(`  ✓ Encryption enabled for project ${projectName}`);
	}

	// Wait for todo input to be enabled
	await ensureAddTodoExpanded(page);
	const todoInput = page.locator('[data-testid="todo-input"]').first();
	await expect(todoInput).toBeEnabled({ timeout: 10000 });

	// Add todos
	for (const todoText of todoTexts) {
		await todoInput.fill(todoText);
		const addButton = page.locator('[data-testid="add-todo-button"]').first();
		await addButton.click();
		await expect(page.locator(`text=${todoText}`).first()).toBeVisible({ timeout: 5000 });
		console.log(`  ✓ Added todo: ${todoText}`);
		await page.waitForTimeout(300);
	}
}

/**
 * Verify that todos are visible
 */
async function verifyTodosVisible(page, todoTexts, { timeout = 30000 } = {}) {
	for (const todoText of todoTexts) {
		await waitForTodoText(page, todoText, timeout);
	}
}

async function safeClose(context, label) {
	try {
		await context.close();
	} catch (error) {
		// Playwright tracing/artifact plumbing can occasionally fail with ENOENT; avoid turning a
		// functional e2e signal into a hard test failure.
		console.warn(`⚠️ Failed to close ${label}: ${error?.message || String(error)}`);
	}
}
