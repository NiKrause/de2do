import { test, expect, chromium } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress,
	waitForTodoText,
	ensureAddTodoExpanded,
	waitForPeerCount,
	waitForTodoSyncEvent
} from './helpers.js';

// Mark intentionally unused test helpers so eslint doesn't complain
void chromium;

/**
 * Focused test for opening databases via URL in new browser contexts
 *
 * This test isolates Step 7 and Step 8 from per-database-encryption.spec.js:
 * - Step 7: Open unencrypted database via URL (should NOT show password modal)
 * - Step 8: Open encrypted database via URL and unlock inline so todos become visible
 */
test.describe('Remote Database URL Access', () => {
	test.setTimeout(120000); // 2 minutes

	test('should handle opening unencrypted and encrypted databases via URL', async ({
		browser
	}) => {
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
		await page1.goto(`/#${unencryptedAddress}`);
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

		await page2.goto(`/#${unencryptedAddress}`);
		console.log(`→ Navigated to: /#${unencryptedAddress}`);

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

		// Wait for the remote database to actually sync before asserting replicated content.
		await waitForPeerCount(page2, 1, 30000);
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

		// Switch the source browser back to the encrypted database using the in-app list
		// selector so we stay on the same cached-password flow used during normal usage.
		await switchToProject(page1, encryptedProjectName);
		await waitForTodoText(page1, `Task 2-1 of ${encryptedProjectName}`, 30000);

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

		await page3.goto(`/#${encryptedAddress}`);
		console.log(`→ Navigated to: /#${encryptedAddress}`);

		// Wait for initialization
		await waitForP2PInitialization(page3);
		console.log('→ P2P initialized in new browser context');

		// Unlock inline instead of waiting for a modal prompt.
		console.log('→ Waiting for inline unlock controls...');
		const inlineUnlockPanel = page3.getByTestId('inline-unlock-panel');
		await expect(inlineUnlockPanel).toBeVisible({ timeout: 60000 });
		console.log('✅ Inline unlock controls are visible');

		console.log('→ Entering password...');
		await page3.getByTestId('inline-unlock-password').fill(password);
		await page3.getByTestId('inline-unlock-button').click();
		console.log('→ Submitted password');

		await waitForPeerCount(page3, 1, 30000);
		await page3.evaluate(async () => {
			if (typeof window.forceReloadTodos === 'function') {
				await window.forceReloadTodos();
			}
		});
		await waitForTodoSyncEvent(page3, {
			todoText: `Task 2-1 of ${encryptedProjectName}`,
			timeout: 60000
		});

		// Verify todos visible
		await verifyTodosVisible(page3, [`Task 2-1 of ${encryptedProjectName}`], { timeout: 60000 });
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

async function switchToProject(page, projectName) {
	const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
	await expect(todoListInput).toBeVisible({ timeout: 10000 });
	await todoListInput.click();
	await page.waitForTimeout(500);

	const listbox = page.getByRole('listbox');
	const projectOption = listbox.locator(`text=${projectName}`).first();
	if (await projectOption.isVisible({ timeout: 3000 }).catch(() => false)) {
		await projectOption.click();
	} else {
		await todoListInput.press('Control+A').catch(() => {});
		await todoListInput.press('Meta+A').catch(() => {});
		await todoListInput.fill(projectName);
		await page.waitForTimeout(300);
		await todoListInput.press('Enter');
	}

	await page.waitForTimeout(1500);
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
