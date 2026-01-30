import { test, expect, chromium } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization,
	getCurrentDatabaseAddress
} from './helpers.js';

// Mark intentionally unused test helpers so eslint doesn't complain
void chromium;

/**
 * Focused test for opening databases via URL in new browser contexts
 *
 * This test isolates Step 7 and Step 8 from per-database-encryption.spec.js:
 * - Step 7: Open unencrypted database via URL (should NOT show password modal)
 * - Step 8: Open encrypted database via URL (should show password modal)
 */
test.describe('Remote Database URL Access', () => {
	test.setTimeout(120000); // 2 minutes

	test.skip('should handle opening unencrypted and encrypted databases via URL', async ({
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

		await context1.close();

		// ============================================================================
		// STEP 1: Open unencrypted database via URL (should NOT show password modal)
		// ============================================================================
		console.log('\n🌐 STEP 1: Opening unencrypted database via URL...\n');

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

		// Wait for database to open and todos to load
		await page2.waitForTimeout(8000); // Give time for database sync

		// Should NOT show password modal
		const passwordModal1 = page2.locator('text=/password/i').first();
		const hasPasswordModal1 = await passwordModal1.isVisible({ timeout: 3000 }).catch(() => false);

		if (hasPasswordModal1) {
			console.error('❌ Password modal appeared for unencrypted database!');
			console.log('  → Browser logs:');
			browserLogs.slice(-10).forEach((log) => console.log(`    ${log}`));
		}

		expect(hasPasswordModal1).toBe(false);
		console.log('✅ No password modal for unencrypted project (correct)');

		// Verify todos visible
		await verifyTodosVisible(page2, [`Task 1-1 of ${unencryptedProjectName}`]);
		console.log('✅ Unencrypted project todos visible in new browser');

		await context2.close();

		// ============================================================================
		// STEP 2: Open encrypted database via URL (should show password modal)
		// ============================================================================
		console.log('\n🌐 STEP 2: Opening encrypted database via URL...\n');

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

		// Wait for database detection and password modal to appear
		await page3.waitForTimeout(8000); // Give time for encryption detection

		// SHOULD show password modal
		console.log('→ Waiting for password modal...');
		const passwordModalHeading = page3.locator('text=/enter.*password/i').first();

		try {
			await expect(passwordModalHeading).toBeVisible({ timeout: 15000 });
			console.log('✅ Password modal appeared (correct)');
		} catch (error) {
			console.error('❌ Password modal did not appear for encrypted database!');
			console.log('  → Browser logs:');
			browserLogs2.slice(-15).forEach((log) => console.log(`    ${log}`));
			throw error;
		}

		// Enter password
		console.log('→ Entering password...');
		const modalPasswordInput = page3.locator('input[type="password"]').first();
		await modalPasswordInput.fill(password);

		// Submit
		const submitButton = page3
			.locator('button:has-text("Unlock")')
			.or(page3.locator('button:has-text("Submit")'))
			.first();
		await submitButton.click();
		console.log('→ Submitted password');

		// Wait for database to open and todos to load
		await page3.waitForTimeout(5000);

		// Verify todos visible
		await verifyTodosVisible(page3, [`Task 2-1 of ${encryptedProjectName}`]);
		console.log('✅ Encrypted project todos visible after password entry');

		await context3.close();

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

		// Wait for migration to complete
		await page.waitForTimeout(5000);

		// Verify success toast
		const successToast = page.locator('text=/migrated to encrypted/i').first();
		try {
			await expect(successToast).toBeVisible({ timeout: 5000 });
			console.log(`  ✓ Encryption enabled for project ${projectName}`);
		} catch {
			console.warn(`⚠️ Encryption success toast not detected, continuing...`);
		}
	}

	// Wait for todo input to be enabled
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
async function verifyTodosVisible(page, todoTexts) {
	for (const todoText of todoTexts) {
		await expect(page.locator(`text=${todoText}`).first()).toBeVisible({ timeout: 10000 });
	}
}
