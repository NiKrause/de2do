import { test, expect } from '@playwright/test';
import {
	acceptConsentAndInitialize,
	ensureAddTodoExpanded,
	waitForP2PInitialization,
	waitForPeerCount,
	getPeerId,
	getConnectedPeerIds,
	getPeerCount,
	getCurrentDatabaseAddress,
	waitForTodoText,
	handleWebAuthnModal,
	addVirtualAuthenticator,
	setupPasskeyViaP2PassPanel
} from './helpers.js';
import { createWebAuthnDelegationHelpers } from './webauthn-delegation-helpers.js';

test.describe('Simple Todo P2P Application', () => {
	const {
		initializeWithWebAuthn,
		addAndSelectUserByDid,
		waitForTodoAfterDidSwitch,
		assertAccessControllerType,
		getCurrentDbName,
		getTodoDiagnostics,
		assertDelegatedStateAfterAction,
		safeCloseContext
	} = createWebAuthnDelegationHelpers(test, expect);

	test('should have webserver running and accessible', async ({ page, request }) => {
		// Check if the webserver is responding
		const response = await request.get('/');
		expect(response.status()).toBe(200);

		// Verify the page loads
		await page.goto('/');
		await expect(page).toHaveTitle(/Simple TODO/i);

		// Verify main content is present
		await expect(page.locator('main')).toBeVisible({ timeout: 10000 });

		console.log('✅ Webserver is running and accessible');
	});

	test.skip('should open and close the QR code modal from the header', async ({ page }) => {
		await page.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		// Accept consent so header is interactable
		await acceptConsentAndInitialize(page);

		// Open QR code modal
		const qrButton = page
			.locator('header')
			.getByRole('button', { name: 'Show QR code for sharing this page' });
		await expect(qrButton).toBeVisible({ timeout: 10000 });
		await qrButton.click();
		const qrDialog = page.locator('[role="dialog"][aria-labelledby="qr-modal-title"]');
		const dialogVisible = await qrDialog.isVisible().catch(() => false);
		if (!dialogVisible) {
			await qrButton.click({ force: true });
		}
		await expect(qrDialog).toBeVisible({ timeout: 10000 });
		await expect(qrDialog.locator('#qr-modal-title')).toHaveText(/Simple-Todo Example/i);

		// Close via close button
		const closeButton = qrDialog.getByRole('button', { name: /Close QR code modal/i });
		await closeButton.click();
		await expect(qrDialog).not.toBeVisible();
	});

	test('should show consent modal and proceed with P2P initialization', async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		// Give time for onMount to complete and modal to render
		await page.waitForTimeout(1000);

		// Step 1: Accept consent and initialize P2P
		console.log('✅ Consent banner visible with default settings');
		await acceptConsentAndInitialize(page);

		// Step 2: Wait for P2P initialization to complete
		console.log('⏳ Waiting for P2P initialization...');
		await waitForP2PInitialization(page);
		await ensureAddTodoExpanded(page);

		console.log('✅ P2P initialization successful');
		console.log('✅ Todo input form is visible');

		// Step 8: Add a test todo
		const testTodoText = 'Test todo from Playwright e2e test';

		// Use the data-testid selectors we added
		const todoInput = page.locator('[data-testid="todo-input"]');
		await todoInput.fill(testTodoText);

		const addButton = page.locator('[data-testid="add-todo-button"]');
		await addButton.click();

		console.log(`✅ Added todo: "${testTodoText}"`);

		// Step 9: Verify the todo appears in the list
		await expect(page.locator('text=' + testTodoText).first()).toBeVisible({ timeout: 10000 });

		console.log('✅ Todo is visible in the list');

		// Step 10: Todo verification completed (already confirmed visible above)
		console.log('✅ Todo verification completed successfully');

		// Step 11: Verify P2P connection status (optional)
		// Look for connected peers indicator or similar
		const connectionStatus = page.locator('[data-testid="connection-status"], .connection-status');
		if (await connectionStatus.isVisible()) {
			console.log('✅ Connection status indicator found');
		}

		console.log('🎉 All test steps completed successfully!');
	});

	test('should default signing pref to worker in P2Pass and expose mode in footer', async ({
		page
	}) => {
		await addVirtualAuthenticator(page);
		await page.goto('http://127.0.0.1:4174/');

		await page.waitForFunction(
			() =>
				document.querySelector('main') !== null ||
				document.querySelector('[data-testid="consent-modal"]') !== null,
			{ timeout: 30000 }
		);
		await page.waitForTimeout(1000);

		const consentModal = page.locator('[data-testid="consent-modal"]');
		await expect(consentModal).toBeVisible({ timeout: 10000 });
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.getByTestId('consent-accept-button').click();
		await expect(consentModal).not.toBeVisible();

		await waitForP2PInitialization(page);

		await page.getByTestId('footer-p2pass-toggle').click();
		await expect(page.getByTestId('storacha-panel')).toBeVisible({ timeout: 15000 });
		const workerPref = page.getByTestId('storacha-signing-pref-worker');
		await expect(workerPref).toBeChecked();
		await page.getByTestId('storacha-signing-pref-hardware-ed25519').check();
		await expect(page.getByTestId('storacha-signing-pref-hardware-ed25519')).toBeChecked();
		await workerPref.check();
		await expect(workerPref).toBeChecked();

		await expect(page.getByTestId('identity-mode')).toContainText(
			/(software|unknown|worker \(ed25519\)|hardware \((ed25519|p-256)\))/i,
			{
				timeout: 30000
			}
		);
	});

	test('should handle offline mode correctly', async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		// Give time for onMount to complete
		await page.waitForTimeout(1000);

		// Wait for consent modal to appear
		await page.waitForSelector('[data-testid="consent-modal"]', {
			state: 'attached',
			timeout: 20000
		});

		// Scroll to bottom to ensure modal is in viewport
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

		await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible({ timeout: 5000 });

		// Toggle Network to Off (clicking the toggle button)
		// The second toggle button is Network
		const consentModal = page.locator('[data-testid="consent-modal"]');
		const toggleButtons = consentModal.locator('button.relative.inline-flex');
		await toggleButtons.nth(1).click(); // Second toggle is Network

		// Click Proceed button
		const proceedButton = consentModal.getByRole('button', { name: 'Accept & Continue' });
		await expect(proceedButton).toBeVisible({ timeout: 5000 });
		await proceedButton.click();

		// Wait for modal to disappear
		await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

		// Handle WebAuthn modal if present
		await handleWebAuthnModal(page);

		// Should still be able to use the app in offline mode
		await ensureAddTodoExpanded(page);

		console.log('✅ Offline mode test completed');
	});

	test('should display system toast notifications', async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		await page.waitForTimeout(1000);

		// Wait for consent modal
		await page.waitForSelector('[data-testid="consent-modal"]', {
			state: 'attached',
			timeout: 20000
		});

		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible({ timeout: 5000 });

		// Click Proceed button
		const consentModal = page.locator('[data-testid="consent-modal"]');
		const proceedButton = consentModal.getByRole('button', { name: 'Accept & Continue' });
		await proceedButton.click();

		// Wait for modal to disappear
		await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

		// Look for system toast notifications that should appear during initialization
		// These might indicate libp2p creation, Helia creation, OrbitDB creation, etc.
		const toastSelectors = [
			'[data-testid="system-toast"]',
			'.toast',
			'.notification',
			'.alert',
			'[role="alert"]'
		];

		let toastFound = false;
		for (const selector of toastSelectors) {
			const toast = page.locator(selector);
			if (await toast.isVisible()) {
				console.log(`✅ Found toast notification: ${selector}`);
				toastFound = true;
				break;
			}
		}

		// Wait a bit more for potential toasts
		await page.waitForTimeout(3000);

		console.log(
			toastFound
				? '✅ Toast notifications test completed'
				: '⚠️ No toast notifications found (may be expected)'
		);
	});

	test('should handle todo operations correctly', async ({ page }) => {
		// Navigate to the application
		await page.goto('/');

		// Wait for SvelteKit to finish hydrating
		await page.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		await page.waitForTimeout(1000);

		// Wait for consent modal
		await page.waitForSelector('[data-testid="consent-modal"]', {
			state: 'attached',
			timeout: 20000
		});

		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible({ timeout: 5000 });

		// Click Proceed button
		const consentModal = page.locator('[data-testid="consent-modal"]');
		const proceedButton = consentModal.getByRole('button', { name: 'Accept & Continue' });
		await proceedButton.click();

		await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

		// Handle WebAuthn modal if present
		await handleWebAuthnModal(page);

		// Wait for todo input to be ready and enabled
		await ensureAddTodoExpanded(page);
		const todoInput = page.locator('[data-testid="todo-input"]');
		await expect(todoInput).toBeVisible({ timeout: 15000 });
		await expect(todoInput).toBeEnabled({ timeout: 10000 });

		// Test adding multiple todos
		const todos = [
			'First test todo',
			'Second test todo',
			'Third test todo with special chars: áéíóú'
		];

		for (const todoText of todos) {
			await todoInput.fill(todoText);
			await page.locator('[data-testid="add-todo-button"]').click();

			// Verify todo appears
			await expect(page.locator('text=' + todoText)).toBeVisible({ timeout: 5000 });

			console.log(`✅ Added and verified todo: "${todoText}"`);
		}

		// Test todo count
		const todoElements = page.locator('[data-testid="todo-item"], .todo-item');
		if (await todoElements.first().isVisible()) {
			const count = await todoElements.count();
			expect(count).toBeGreaterThanOrEqual(todos.length);
			console.log(`✅ Todo count verified: ${count} todos found`);
		}

		console.log('🎉 Todo operations test completed successfully!');
	});

	test('should connect two browsers and see each other as connected peers', async ({ browser }) => {
		// Create two separate browser contexts (simulating two different browsers)
		const context1 = await browser.newContext();
		const context2 = await browser.newContext();

		const page1 = await context1.newPage();
		const page2 = await context2.newPage();

		// Enable console logging for debugging
		page1.on('console', (msg) => console.log('Page1:', msg.text()));
		page2.on('console', (msg) => console.log('Page2:', msg.text()));

		console.log('🚀 Starting two-browser peer connection test...');

		// Navigate both pages to the application
		await page1.goto('/');
		await page2.goto('/');

		// Wait for SvelteKit to finish hydrating on both pages
		await page1.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		await page2.waitForFunction(
			() => {
				const hasMain = document.querySelector('main') !== null;
				const hasModal = document.querySelector('[data-testid="consent-modal"]') !== null;
				return hasMain || hasModal;
			},
			{ timeout: 30000 }
		);

		// Give time for onMount to complete
		await page1.waitForTimeout(1000);
		await page2.waitForTimeout(1000);

		// Step 1: Accept consent and initialize P2P on both pages
		console.log('📋 Accepting consent on both pages...');
		await acceptConsentAndInitialize(page1);
		await acceptConsentAndInitialize(page2);

		// Step 2: Wait for P2P initialization on both pages
		console.log('⏳ Waiting for P2P initialization on both pages...');
		await waitForP2PInitialization(page1);
		await waitForP2PInitialization(page2);

		// Step 3: Get peer IDs from both pages
		const peerId1 = await getPeerId(page1);
		const peerId2 = await getPeerId(page2);

		console.log(`📱 Page 1 Peer ID: ${peerId1}`);
		console.log(`📱 Page 2 Peer ID: ${peerId2}`);

		expect(peerId1).toBeTruthy();
		expect(peerId2).toBeTruthy();
		expect(peerId1).not.toBe(peerId2); // They should have different peer IDs

		// Step 4: Wait for peer connections to be established
		// Both pages should connect to the relay, and then discover each other
		console.log('🔗 Waiting for peer connections...');
		await waitForPeerCount(page1, 2, 120000); // relay + other browser
		await waitForPeerCount(page2, 2, 120000); // relay + other browser

		// Give extra time for peer discovery and connection
		console.log('⏳ Waiting for peer discovery and connection...');
		await page1.waitForTimeout(5000);
		await page2.waitForTimeout(5000);

		// Step 5: Verify both pages see each other in connected peers
		console.log('🔍 Checking if pages see each other...');

		// Extract short peer IDs for comparison (first 8-16 characters)
		const shortPeerId1 = peerId1?.substring(0, 16) || '';
		const shortPeerId2 = peerId2?.substring(0, 16) || '';

		// Helper function to check peer visibility
		const checkPeerVisibility = async () => {
			const peers1 = await getConnectedPeerIds(page1);
			const peers2 = await getConnectedPeerIds(page2);

			console.log(`📊 Page 1 sees ${peers1.length} peer(s):`, peers1);
			console.log(`📊 Page 2 sees ${peers2.length} peer(s):`, peers2);

			const page1SeesPage2 = peers1.some((peer) => peer.includes(shortPeerId2));
			const page2SeesPage1 = peers2.some((peer) => peer.includes(shortPeerId1));

			return { page1SeesPage2, page2SeesPage1 };
		};

		// Initial check
		let { page1SeesPage2, page2SeesPage1 } = await checkPeerVisibility();

		// Wait a bit more if they don't see each other yet (peer discovery can take time)
		if (!page1SeesPage2 || !page2SeesPage1) {
			console.log('⏳ Waiting additional time for peer discovery...');
			await page1.waitForTimeout(10000);
			await page2.waitForTimeout(10000);

			// Re-check
			const result = await checkPeerVisibility();
			page1SeesPage2 = result.page1SeesPage2;
			page2SeesPage1 = result.page2SeesPage1;
		}

		// Assert that both pages see each other
		console.log(`🔍 Page 1 sees Page 2: ${page1SeesPage2}`);
		console.log(`🔍 Page 2 sees Page 1: ${page2SeesPage1}`);

		expect(page1SeesPage2).toBe(true);
		expect(page2SeesPage1).toBe(true);

		console.log('✅ Both pages see each other as connected peers!');

		// Step 6: Verify final peer counts
		const finalPeerCount1 = await getPeerCount(page1);
		const finalPeerCount2 = await getPeerCount(page2);

		console.log(`📊 Final peer count - Page 1: ${finalPeerCount1}, Page 2: ${finalPeerCount2}`);

		// Both should have at least 2 peers (relay + each other)
		expect(finalPeerCount1).toBeGreaterThanOrEqual(2);
		expect(finalPeerCount2).toBeGreaterThanOrEqual(2);

		// Clean up
		await context1.close();
		await context2.close();

		console.log('✅ Two-browser peer connection test completed!');
	});

	test('should create passkey, add todos, and sync to another browser', async ({ browser }) => {
		test.setTimeout(300000);

		const context1 = await browser.newContext();
		const context2 = await browser.newContext();

		const page1 = await context1.newPage();
		const page2 = await context2.newPage();

		page1.on('console', (msg) => console.log('Alice:', msg.text()));
		page2.on('console', (msg) => console.log('Bob:', msg.text()));

		console.log('🚀 Starting passkey + database sharing test...');

		// ===== ALICE: Set up virtual authenticator, create passkey, add 3 todos =====
		await addVirtualAuthenticator(page1);

		// Use localhost (not 127.0.0.1) so WebAuthn has a valid RP ID
		await page1.goto('http://localhost:4174/');
		await page1.waitForFunction(
			() =>
				document.querySelector('main') !== null ||
				document.querySelector('[data-testid="consent-modal"]') !== null,
			{ timeout: 30000 }
		);
		await page1.waitForTimeout(1000);

		// Accept consent — the WebAuthn modal will appear next
		console.log('📱 Alice: Accepting consent...');
		const consentModal1 = page1.locator('[data-testid="consent-modal"]');
		await expect(consentModal1).toBeVisible({ timeout: 10000 });
		await page1.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		const proceedButton1 = page1.getByTestId('consent-accept-button');
		await proceedButton1.click();
		await expect(consentModal1).not.toBeVisible();

		console.log('🔐 Alice: Waiting for P2P, then passkey via P2Pass…');
		await waitForP2PInitialization(page1);
		await setupPasskeyViaP2PassPanel(page1, { mode: 'worker' });
		console.log('✅ Alice: Passkey created (P2Pass)');

		// Add 3 todos
		const todos = ['Buy groceries', 'Walk the dog', 'Write tests'];
		await ensureAddTodoExpanded(page1);
		const todoInput1 = page1.locator('[data-testid="todo-input"]');
		await expect(todoInput1).toBeVisible({ timeout: 15000 });
		await expect(todoInput1).toBeEnabled({ timeout: 10000 });

		for (const todoText of todos) {
			await todoInput1.fill(todoText);
			await page1.locator('[data-testid="add-todo-button"]').click();
			await expect(page1.locator('text=' + todoText).first()).toBeVisible({ timeout: 5000 });
			console.log(`✅ Alice: Added "${todoText}"`);
		}

		// Wait for todos to persist
		await page1.waitForTimeout(3000);

		// Get database address
		const dbAddress = await getCurrentDatabaseAddress(page1, 15000);
		expect(dbAddress).toBeTruthy();
		console.log(`✅ Alice: Database address: ${dbAddress}`);
		const aliceDid = await page1.evaluate(() => window.__currentIdentityId__ || null);
		expect(aliceDid).toBeTruthy();
		console.log(`✅ Alice: DID: ${aliceDid}`);

		// ===== BOB: Open shared database and verify todos =====
		console.log('📱 Bob: Opening shared database...');
		const baseUrl = await page1.evaluate(() => window.location.origin);
		const sharedDbUrl = `${baseUrl}/#${dbAddress}`;
		const passwordModalHeading = page2.locator('text=/enter.*password/i').first();
		let bobInitialized = false;
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			await page2.goto(sharedDbUrl);

			// Hash URL auto-initializes P2P (skips consent)
			await waitForP2PInitialization(page2);

			const hasPasswordModal = await passwordModalHeading
				.isVisible({ timeout: 3000 })
				.catch(() => false);
			if (!hasPasswordModal) {
				bobInitialized = true;
				break;
			}

			console.warn(
				`⚠️ Bob: Unexpected password modal while opening unencrypted DB (attempt ${attempt}/3), retrying...`
			);
			await page2.reload();
			await page2.waitForTimeout(2000);
		}
		expect(bobInitialized).toBe(true);

		// Verify Alice DID is visible in Bob's left users list by default
		const usersListbox = page2.getByTestId('users-listbox');
		await expect(usersListbox).toBeVisible({ timeout: 30000 });
		await expect(usersListbox.getByRole('option', { name: aliceDid })).toBeVisible({
			timeout: 60000
		});
		console.log('✅ Bob: Alice DID is visible in UsersList');

		// Wait for peer connection
		console.log('🔗 Bob: Waiting for peer connections...');
		await waitForPeerCount(page2, 2, 120000);

		// Verify all 3 todos sync
		console.log('⏳ Bob: Waiting for todos to sync...');
		for (const todoText of todos) {
			await waitForTodoText(page2, todoText, 60000);
			console.log(`✅ Bob: Found "${todoText}"`);
		}

		console.log('✅ Bob: All 3 todos synced successfully!');

		await context1.close();
		await context2.close();

		console.log('🎉 Passkey + database sharing test completed!');
	});

	/**
	 * Same flow as `should create passkey, add todos, and sync to another browser` (hash URL + todo sync),
	 * but with **Alice = worker (ed25519)** and **Bob = hardware (ed25519)** — matches the mixed identity
	 * pair used in the delegated signature tests (UsersList path vs hash URL path).
	 */
	test('should sync passkey todos via hash URL (Alice worker, Bob hardware ed25519)', async ({
		browser
	}) => {
		test.setTimeout(300000);

		const context1 = await browser.newContext();
		const context2 = await browser.newContext();

		const page1 = await context1.newPage();
		const page2 = await context2.newPage();

		page1.on('console', (msg) => console.log('Alice:', msg.text()));
		page2.on('console', (msg) => console.log('Bob:', msg.text()));

		console.log(
			'🚀 Passkey + hash URL sync — Alice worker(ed25519), Bob hardware(ed25519) (mixed mode)'
		);

		await initializeWithWebAuthn(page1, 'Alice', { mode: 'worker' });

		const todos = ['Buy groceries', 'Walk the dog', 'Write tests'];
		await ensureAddTodoExpanded(page1);
		const todoInput1 = page1.locator('[data-testid="todo-input"]');
		await expect(todoInput1).toBeVisible({ timeout: 15000 });
		await expect(todoInput1).toBeEnabled({ timeout: 10000 });

		for (const todoText of todos) {
			await todoInput1.fill(todoText);
			await page1.locator('[data-testid="add-todo-button"]').click();
			await expect(page1.locator('text=' + todoText).first()).toBeVisible({ timeout: 5000 });
			console.log(`✅ Alice: Added "${todoText}"`);
		}

		await page1.waitForTimeout(3000);

		const dbAddress = await getCurrentDatabaseAddress(page1, 15000);
		expect(dbAddress).toBeTruthy();
		console.log(`✅ Alice: Database address: ${dbAddress}`);
		const aliceDid = await page1.evaluate(() => window.__currentIdentityId__ || null);
		expect(aliceDid).toBeTruthy();
		console.log(`✅ Alice: DID: ${aliceDid}`);

		await initializeWithWebAuthn(page2, 'Bob', {
			mode: 'hardware',
			hardwareAlgorithm: 'ed25519'
		});

		console.log('📱 Bob: Opening shared database (hash URL)...');
		const baseUrl = await page1.evaluate(() => window.location.origin);
		const sharedDbUrl = `${baseUrl}/#${dbAddress}`;
		const passwordModalHeading = page2.locator('text=/enter.*password/i').first();
		let bobInitialized = false;
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			await page2.goto(sharedDbUrl);

			await waitForP2PInitialization(page2);

			const hasPasswordModal = await passwordModalHeading
				.isVisible({ timeout: 3000 })
				.catch(() => false);
			if (!hasPasswordModal) {
				bobInitialized = true;
				break;
			}

			console.warn(
				`⚠️ Bob: Unexpected password modal while opening unencrypted DB (attempt ${attempt}/3), retrying...`
			);
			await page2.reload();
			await page2.waitForTimeout(2000);
		}
		expect(bobInitialized).toBe(true);

		const usersListbox = page2.getByTestId('users-listbox');
		await expect(usersListbox).toBeVisible({ timeout: 30000 });
		await expect(usersListbox.getByRole('option', { name: aliceDid })).toBeVisible({
			timeout: 60000
		});
		console.log('✅ Bob: Alice DID is visible in UsersList');

		console.log('🔗 Bob: Waiting for peer connections...');
		await waitForPeerCount(page2, 2, 120000);

		console.log('⏳ Bob: Waiting for todos to sync...');
		for (const todoText of todos) {
			await waitForTodoText(page2, todoText, 60000);
			console.log(`✅ Bob: Found "${todoText}"`);
		}

		console.log('✅ Bob: All 3 todos synced (worker + hardware ed25519)!');

		await context1.close();
		await context2.close();

		console.log('🎉 Mixed-mode passkey + database sharing test completed!');
	});

	test('should allow delegated user to edit and complete todo via UsersList DID flow', async ({
		browser
	}) => {
		test.setTimeout(300000);
		const contextAlice = await browser.newContext();
		const contextBob = await browser.newContext();

		const alice = await contextAlice.newPage();
		const bob = await contextBob.newPage();
		const aliceConsoleErrors = [];
		const bobConsoleErrors = [];
		const bobPageErrors = [];
		alice.on('console', (msg) => {
			if (msg.type() === 'error') aliceConsoleErrors.push(msg.text());
		});
		bob.on('console', (msg) => {
			if (msg.type() === 'error') bobConsoleErrors.push(msg.text());
		});
		bob.on('pageerror', (error) => {
			bobPageErrors.push(error?.message || String(error));
		});

		await initializeWithWebAuthn(alice, 'Alice', {
			mode: 'worker'
		});
		await initializeWithWebAuthn(bob, 'Bob', {
			mode: 'worker'
		});

		const aliceDid = await alice.evaluate(() => window.__currentIdentityId__ || null);
		const bobDid = await bob.evaluate(() => window.__currentIdentityId__ || null);
		expect(aliceDid).toBeTruthy();
		expect(bobDid).toBeTruthy();

		const originalTitle = `Delegated todo ${Date.now()}`;
		const originalDescription = 'Original description';
		const updatedTitle = `${originalTitle} - updated by Bob`;
		const updatedDescription = 'Updated by Bob via delegation';

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

		await addAndSelectUserByDid(bob, aliceDid);

		await expect
			.poll(async () => await getCurrentDatabaseAddress(bob, 10000), { timeout: 60000 })
			.toBe(aliceDbAddress);
		await expect
			.poll(async () => await getCurrentDbName(bob), { timeout: 60000 })
			.toBe(`${aliceDid}_projects`);
		await assertAccessControllerType(bob, 'todo-delegation', 30000);

		await waitForPeerCount(bob, 2, 120000);
		await waitForTodoAfterDidSwitch(bob, aliceDid, originalTitle);
		console.log('🔎 Bob diagnostics before edit:', await getTodoDiagnostics(bob, originalTitle));

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
		await expect(editButton).toBeVisible({
			timeout: 60000
		});
		await editButton.click();
		const editFormInput = bob.locator('input[placeholder="Edit todo..."]').first();
		await expect(editFormInput).toBeVisible({ timeout: 30000 });
		const editFormContainer = editFormInput
			.locator('xpath=ancestor::div[contains(@class,"mb-6") and contains(@class,"shadow-md")]')
			.first();
		await editFormInput.fill(updatedTitle);
		await editFormContainer.locator('#add-todo-description').first().fill(updatedDescription);
		const saveButton = editFormContainer.locator('[data-testid="add-todo-button"]').first();
		console.log(
			'🔎 Bob diagnostics before save click:',
			await getTodoDiagnostics(bob, originalTitle)
		);
		await saveButton.click();
		const delegatedAuthState = bob.getByTestId('delegated-auth-state');
		await assertDelegatedStateAfterAction(bob, delegatedAuthState);
		console.log('🔎 Bob diagnostics after save/auth:', await getTodoDiagnostics(bob, updatedTitle));

		await waitForTodoText(bob, updatedTitle, 30000, { browserName: test.info().project.name });

		const bobTodoRow = bob
			.locator('div.rounded-md.border', { has: bob.locator(`[data-todo-text="${updatedTitle}"]`) })
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
		console.log(
			'🔎 Alice diagnostics after replication:',
			await getTodoDiagnostics(alice, updatedTitle)
		);
		console.log('🔎 Bob console errors:', bobConsoleErrors);
		console.log('🔎 Bob page errors:', bobPageErrors);
		console.log('🔎 Alice console errors:', aliceConsoleErrors);

		await safeCloseContext(contextAlice);
		await safeCloseContext(contextBob);
	});
});
