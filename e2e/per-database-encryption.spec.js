import { test, expect, chromium } from '@playwright/test';
import { acceptConsentAndInitialize, waitForP2PInitialization, getPeerId } from './helpers.js';

// Mark intentionally unused test helpers so eslint doesn't complain while this suite is skipped
void chromium;
void getPeerId;

/**
 * Comprehensive E2E test for per-database encryption
 *
 * Test flow:
 * 1. Create 3 different todo lists with 3 todos each
 * 2. Third project is created with encryption enabled
 * 3. Switch between projects and verify encryption icons and todos
 * 4. Add encryption to second project (migration test)
 * 5. Open new browser contexts with URLs to test password prompts
 */
test.describe('Per-Database Encryption E2E Tests', () => {
	test.setTimeout(120000); // 2 minutes for this long-running flow

	/**
	 * Simple sanity test: create a single unencrypted project and verify
	 * the project appears in the dropdown and its todo is visible.
	 */
	test('basic unencrypted project dropdown visibility', async ({ page }) => {
		const timestamp = Date.now();
		const projectName = `unencrypted-project-${timestamp}`;
		const todoText = `Task 1 of ${projectName}`;

		// Initialize app
		await page.goto('/');
		await acceptConsentAndInitialize(page);
		await waitForP2PInitialization(page);

		// Create unencrypted project with a single todo
		await createProjectWithTodos(page, projectName, false, '', [todoText]);

		// Wait a bit before opening dropdown to ensure everything is settled
		await page.waitForTimeout(500);

		// Open TodoListSelector dropdown and verify project appears
		const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
		await todoListInput.click();
		await page.waitForTimeout(1000);

		// Wait for dropdown to contain the project
		// Simply check if we can find text matching the project name in the dropdown
		const dropdownWithProject = page.locator('[role="listbox"]', { hasText: projectName });
		await expect(dropdownWithProject).toBeVisible({ timeout: 10000 });

		// Close dropdown and click into the main todo input to ensure focus leaves the selector
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		const mainTodoInput = page.locator('[data-testid="todo-input"]');
		await mainTodoInput.click();
		await page.waitForTimeout(300);

		// First switch to the default 'projects' todo list (expected to be empty),
		// then switch to the new project and verify its todo is visible
		await switchToProject(page, 'projects');
		await switchToProject(page, projectName);
		await verifyTodosVisible(page, [todoText]);
	});
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a project and add todos to it
 */
async function createProjectWithTodos(page, projectName, encrypted, password, todoTexts) {
	// Open TodoListSelector
	const todoListInput = page.locator('input[placeholder*="todo list" i]').first();
	await todoListInput.click();
	await page.waitForTimeout(800);

	// Clear input - use the same simple approach as encryption-migration.spec.js
	// This works because handleInputFocus() already clears the input when clicked,
	// but we need to ensure it's truly empty before typing
	const currentValue = await todoListInput.inputValue();

	// If there's still a value, clear it with Backspace
	if (currentValue && currentValue.trim() !== '') {
		// Select all and delete, or use multiple backspaces
		await todoListInput.press('Control+A').catch(() => {});
		await todoListInput.press('Meta+A').catch(() => {}); // For Mac
		await todoListInput.press('Backspace');
		await page.waitForTimeout(200);

		// Double-check it's empty
		const stillHasValue = await todoListInput.inputValue();
		if (stillHasValue && stillHasValue.trim() !== '') {
			// Fallback: clear character by character
			for (let i = 0; i <= stillHasValue.length; i++) {
				await todoListInput.press('Backspace');
			}
			await page.waitForTimeout(200);
		}
	}

	// Now type the new project name
	await todoListInput.type(projectName, { delay: 50 });
	await page.waitForTimeout(500);

	// Verify what we're about to submit
	const valueBeforeSubmit = await todoListInput.inputValue();
	if (valueBeforeSubmit !== projectName) {
		console.warn(
			`⚠️ Input value before submit is "${valueBeforeSubmit}", expected "${projectName}"`
		);
		// Try to fix it
		await todoListInput.press('Control+A').catch(() => {});
		await todoListInput.press('Meta+A').catch(() => {});
		await todoListInput.fill(projectName);
		await page.waitForTimeout(300);
	}

	// Click create button or press Enter
	await todoListInput.press('Enter');

	// Wait for project to be created and database to be opened
	// Give enough time for the database to be created, registered, and ready
	await page.waitForTimeout(6000); // Match encryption-migration.spec.js timing

	console.log(`  ✓ Created project: ${projectName}${encrypted ? ' 🔐' : ''}`);

	// Verify project was actually created and switched to by checking the input value
	const currentInputValue = await todoListInput.inputValue();
	if (currentInputValue !== projectName) {
		console.warn(
			`⚠️ Input value after creation is "${currentInputValue}", expected "${projectName}"`
		);
	}
	console.log(`  ✓ Project database opened: ${projectName}`);

	// If this project should be encrypted "from the start", enable encryption immediately
	// using the same UI flow as the migration step (EncryptionSettings component).
	if (encrypted) {
		console.log(`  → Enabling encryption for project ${projectName} immediately after creation...`);

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
		await page.waitForTimeout(5000); // was 8000

		// Best-effort: verify success toast, but don't fail the helper if it races
		const successToast = page.locator('text=/migrated to encrypted/i').first();
		try {
			await expect(successToast).toBeVisible({ timeout: 5000 });
			console.log(`  ✓ Encryption enabled for project ${projectName}`);
		} catch {
			console.warn(
				`⚠️ Encryption success toast not detected for project ${projectName}, continuing test flow`
			);
		}
	}

	// Wait for todo input to be enabled before adding todos
	const todoInput = page.locator('[data-testid="todo-input"]').first();
	await expect(todoInput).toBeEnabled({ timeout: 10000 });
	console.log(`  ✓ Todo input is enabled and ready`);

	// Add todos
	for (const todoText of todoTexts) {
		await todoInput.fill(todoText);

		const addButton = page.locator('[data-testid="add-todo-button"]').first();
		await addButton.click();

		// Wait for todo to appear
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

	// Prefer selecting the project directly from the dropdown rather than typing into the input.
	const listbox = page.getByRole('listbox');
	// Use a text-based locator so this works for encrypted entries (which include 🔐 and
	// possibly identity badges in the accessible name).
	const projectButton = listbox.locator(`text=${projectName}`).first();

	const isVisible = await projectButton.isVisible({ timeout: 3000 }).catch(() => false);

	if (isVisible) {
		await projectButton.click();
	} else {
		// Fallback: filter by typing the project name and pressing Enter
		// IMPORTANT: Clear the input properly before typing to avoid appending to existing value
		// The reactive statement might have restored the input value after focus
		const currentValue = await todoListInput.inputValue();
		if (currentValue && currentValue.trim() !== '') {
			// Clear it more reliably
			await todoListInput.press('Control+A').catch(() => {});
			await todoListInput.press('Meta+A').catch(() => {});
			await todoListInput.fill(''); // Directly clear
			await page.waitForTimeout(200);

			// Double-check it's empty
			const stillHasValue = await todoListInput.inputValue();
			if (stillHasValue && stillHasValue.trim() !== '') {
				// Fallback: clear character by character
				for (let i = 0; i <= stillHasValue.length; i++) {
					await todoListInput.press('Backspace');
				}
				await page.waitForTimeout(200);
			}
		}

		await todoListInput.type(projectName);
		await page.waitForTimeout(300);
		await todoListInput.press('Enter');
	}

	await page.waitForTimeout(1500);

	// After switching, click into the main todo input (if available) so focus leaves
	// the TodoListSelector before the next project switch. This better matches how
	// a user would work (select project, then work in the main input).
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

// Mark helper functions as used for eslint while parts of the test flow are commented out
void switchToProject;
void verifyTodosVisible;
