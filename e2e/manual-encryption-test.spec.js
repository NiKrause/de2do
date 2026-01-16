import { test, expect } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	waitForP2PInitialization
} from './helpers.js';

/**
 * Simple test for manual encryption behavior:
 * 1. Create unencrypted project with todos - verify todos visible
 * 2. Create encrypted project with todos - verify todos visible
 * 3. Switch between projects
 * 4. Encrypted project should show no todos when opened as unencrypted
 * 5. After enabling encryption manually, todos should appear
 */
test.describe('Manual Encryption Test', () => {
	test.setTimeout(120000); // 2 minutes

	test('should show todos after manually enabling encryption', async ({ page }) => {
		const timestamp = Date.now();
		const unencryptedProjectName = `project-unencrypted-${timestamp}`;
		const encryptedProjectName = `project-encrypted-${timestamp}`;
		const password = `pass-${timestamp}`;

		const unencryptedTodos = [
			`Unencrypted Todo 1 - ${timestamp}`,
			`Unencrypted Todo 2 - ${timestamp}`
		];
		const encryptedTodos = [
			`Encrypted Todo 1 - ${timestamp}`,
			`Encrypted Todo 2 - ${timestamp}`
		];

		console.log('\n🚀 Starting manual encryption test...\n');

		// Initialize app
		await page.goto('/');
		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);

		// STEP 1: Create unencrypted project with todos
		console.log('\n📝 STEP 1: Creating unencrypted project...\n');
		await createProjectWithTodos(page, unencryptedProjectName, false, '', unencryptedTodos);
		await verifyTodosVisible(page, unencryptedTodos);
		console.log('✅ Unencrypted project created with todos visible\n');

		// STEP 2: Create encrypted project with todos (enable encryption immediately)
		console.log('\n📝 STEP 2: Creating encrypted project...\n');
		await createProjectWithTodos(page, encryptedProjectName, true, password, encryptedTodos);
		await verifyTodosVisible(page, encryptedTodos);
		console.log('✅ Encrypted project created with todos visible\n');

		// STEP 3: Switch to unencrypted project - todos should be visible
		console.log('\n📝 STEP 3: Switching to unencrypted project...\n');
		await switchToProject(page, unencryptedProjectName);
		await verifyTodosVisible(page, unencryptedTodos);
		console.log('✅ Unencrypted project todos visible\n');

		// STEP 4: Switch back to encrypted project - should see NO todos (opened as unencrypted)
		console.log('\n📝 STEP 4: Switching to encrypted project (opened as unencrypted)...\n');
		await switchToProject(page, encryptedProjectName);
		
		// Wait a bit for database to load
		await page.waitForTimeout(3000);
		
		// Verify todos are NOT visible (because it's opened as unencrypted)
		for (const todoText of encryptedTodos) {
			const todoLocator = page.locator(`text=${todoText}`).first();
			const isVisible = await todoLocator.isVisible({ timeout: 2000 }).catch(() => false);
			expect(isVisible).toBe(false);
			console.log(`  ✓ Verified todo "${todoText}" is NOT visible (expected)`);
		}
		console.log('✅ Encrypted project shows no todos when opened as unencrypted\n');

		// STEP 5: Enable encryption manually - todos should appear
		console.log('\n📝 STEP 5: Enabling encryption manually...\n');
		
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

		// Wait for migration/reopening to complete
		await page.waitForTimeout(5000);

		// Verify todos are now visible
		await verifyTodosVisible(page, encryptedTodos);
		console.log('✅ Todos visible after enabling encryption manually\n');

		console.log('\n🎉 Test passed! Encrypted project shows todos after manual encryption enable\n');
	});
});

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
	}

	// Type the new project name
	await todoListInput.type(projectName, { delay: 50 });
	await page.waitForTimeout(500);
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
		console.log(`  ✓ Encryption enabled for project ${projectName}`);
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
 * Switch to a different project
 */
async function switchToProject(page, projectName) {
	const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
	await todoListInput.click();
	await page.waitForTimeout(500);

	// Try to select from dropdown first
	const listbox = page.getByRole('listbox');
	const projectButton = listbox.locator(`text=${projectName}`).first();
	const isVisible = await projectButton.isVisible({ timeout: 3000 }).catch(() => false);

	if (isVisible) {
		await projectButton.click();
	} else {
		// Fallback: type and press Enter
		const currentValue = await todoListInput.inputValue();
		if (currentValue && currentValue.trim() !== '') {
			await todoListInput.press('Control+A').catch(() => {});
			await todoListInput.press('Meta+A').catch(() => {});
			await todoListInput.fill('');
			await page.waitForTimeout(200);
		}
		await todoListInput.type(projectName);
		await page.waitForTimeout(300);
		await todoListInput.press('Enter');
	}

	await page.waitForTimeout(1500);

	// Click into main todo input to remove focus from selector
	const mainTodoInput = page.locator('[data-testid="todo-input"]').first();
	const hasMainTodoInput = await mainTodoInput.count();
	if (hasMainTodoInput > 0) {
		await mainTodoInput.click();
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
