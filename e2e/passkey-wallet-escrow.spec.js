/**
 * Passkey smart account + ETH escrow: Alice locks funds for Bob, Bob completes, Alice confirms pay.
 * Both browsers create a passkey smart account; Alice uses Bob’s **visible** wallet address from his
 * profile when delegating (delegate wallet field). Escrow pays Bob’s smart account; balance is asserted on-chain.
 * Requires: global-setup-passkey-escrow (Anvil, docker AA, forge, relay on :3001).
 *
 * ## How we verify Bob received the escrow release
 * 1. `bobBalanceBeforeRelease` = `eth_getBalance(Bob’s passkey smart account)` **after** escrow is **locked**
 *    and **before** Alice clicks **Confirm & Pay**. Bob has not been paid yet (funds sit in `TodoEscrow`).
 * 2. After release, `TodoEscrow` sends locked ETH to Bob’s address **internally** (`call{value}`), so the
 *    outer tx often has `value: 0` — we do **not** rely on that for the payout check.
 * 3. We **poll** `eth_getBalance(bobPayoutAddress)` until it is **strictly greater** than
 *    `bobBalanceBeforeRelease` (see `LOCK_WEI` / test message). That is the on-chain proof Bob received the payout.
 * 4. After lock / **Confirm & Pay**, the UI shows `data-testid="todo-lock-tx-hash"` /
 *    `todo-release-tx-hash`; we call **`eth_getTransactionReceipt`** on Anvil and assert **success status**
 *    so the flow is tied to a **mined L1 tx**, not only DB/UI state.
 * 5. Bob’s **Latest transactions** list scans top-level `from`/`to` only; escrow payout is **internal**, so
 *    the app also merges **`EscrowReleased` logs** (beneficiary = Bob) as `incoming (escrow ETH)` — the E2E
 *    asserts that row shows the **`LOCK_ETH`** amount (same 18-decimal formatting as the wallet UI) after refresh.
 *
 * ## Alice balance after lock (EIP-7702 / AA)
 * `eth_getBalance(aliceSmartAccountAddress)` may drop by **gas only** (~1e13–1e14 wei) while the **locked ETH**
 * still moved into `TodoEscrow` via the user-op / delegated execution path. We therefore assert the lock with
 * **`TodoEscrow.escrows(todoId)`** (amount, beneficiary, `released: false`), not `spentWei >= LOCK_WEI` on Alice.
 *
 * ## Node `eth_*` vs bundle (fixes empty `escrows` reads)
 * `VITE_ESCROW_CONTRACT` / `VITE_RPC_URL` are inlined at **build** time. The spec reads
 * **`window.__PASSKEY_E2E_CHAIN__`** (set in `+layout.svelte` when `import.meta.env.MODE === 'test'`) so Playwright’s
 * `eth_call` / `eth_getBalance` use the **same** TodoEscrow + RPC as the UI. Use **`pnpm run build:test`** for passkey E2E.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
	decodeEventLog,
	decodeFunctionResult,
	encodeFunctionData,
	formatUnits,
	keccak256,
	parseAbiItem,
	parseEther,
	toBytes
} from 'viem';
import {
	addVirtualAuthenticator,
	ensureAddTodoExpanded,
	ensureSettingsExpanded,
	ensureTodoListSectionExpanded,
	waitForP2PInitialization,
	setupPasskeyViaP2PassPanel,
	waitForTodoText,
	waitForTodoVisibleWithReplicationPoll,
	waitForPeerCount,
	getCurrentDatabaseAddress
} from './helpers.js';

/** Escrow lock amount (must match Passkey Wallet + Anvil funding headroom). */
const LOCK_ETH = '1';
const LOCK_WEI = parseEther(LOCK_ETH);

/**
 * Same 18-decimal ETH string as `formatEtherFullDecimals` in the wallet UI (for tx row assertions).
 *
 * @returns {string}
 */
function lockEthDisplayForUiAssert() {
	const s = formatUnits(LOCK_WEI, 18);
	const parts = s.split('.');
	const intPart = parts[0] || '0';
	let frac = parts[1] || '';
	if (frac.length > 18) {
		frac = frac.slice(0, 18);
	}
	frac = frac.padEnd(18, '0');
	return `${intPart}.${frac}`;
}

const escrowsViewAbi = [
	{
		type: 'function',
		name: 'escrows',
		stateMutability: 'view',
		inputs: [{ name: 'todoId', type: 'bytes32' }],
		outputs: [
			{ name: 'creator', type: 'address' },
			{ name: 'beneficiary', type: 'address' },
			{ name: 'token', type: 'address' },
			{ name: 'amount', type: 'uint256' },
			{ name: 'released', type: 'bool' },
			{ name: 'refunded', type: 'bool' },
			{ name: 'deadline', type: 'uint64' }
		]
	}
];

function readEnvTestValue(key) {
	const p = path.join(process.cwd(), '.env.test');
	if (!fs.existsSync(p)) return null;
	const content = fs.readFileSync(p, 'utf8');
	const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
	if (!m) return null;
	return m[1].trim().replace(/^["']|["']$/g, '');
}

/**
 * Filled from the browser bundle via `window.__PASSKEY_E2E_CHAIN__` (`+layout.svelte`, MODE=test)
 * so Node-side `eth_*` match the same RPC + TodoEscrow address the UI used for lock/release.
 *
 * @type {{ rpcUrl: string, escrowAddress: string } | null}
 */
let passkeyE2EChainResolved = null;

/**
 * @param {import('@playwright/test').Page} page - any page from the test build (Alice or Bob)
 */
async function resolvePasskeyE2EChainFromApp(page) {
	if (passkeyE2EChainResolved) return passkeyE2EChainResolved;

	await expect
		.poll(
			async () => {
				return await page.evaluate(() => {
					const c = globalThis.__PASSKEY_E2E_CHAIN__;
					const esc = c?.escrowAddress && String(c.escrowAddress).trim();
					return esc && /^0x[a-fA-F0-9]{40}$/i.test(esc) ? true : false;
				});
			},
			{
				timeout: 25_000,
				message:
					'Expected window.__PASSKEY_E2E_CHAIN__.escrowAddress from test build (+layout). Use `pnpm run build:test` (mode test), not a dev bundle without MODE=test.'
			}
		)
		.toBe(true);

	const raw = await page.evaluate(() => globalThis.__PASSKEY_E2E_CHAIN__ || null);
	const fileRpc = readEnvTestValue('VITE_RPC_URL') || 'http://127.0.0.1:8545';
	const fileEscrow = readEnvTestValue('VITE_ESCROW_CONTRACT');
	const rpcUrl = (raw?.rpcUrl && String(raw.rpcUrl).trim()) || fileRpc;
	const escrowFromApp = raw?.escrowAddress && String(raw.escrowAddress).trim();
	const escrowAddress =
		escrowFromApp && /^0x[a-fA-F0-9]{40}$/i.test(escrowFromApp)
			? escrowFromApp
			: fileEscrow && /^0x[a-fA-F0-9]{40}$/i.test(fileEscrow)
				? fileEscrow
				: '';
	if (!escrowAddress) {
		throw new Error(
			'Passkey E2E: no TodoEscrow address from app __PASSKEY_E2E_CHAIN__ or .env.test VITE_ESCROW_CONTRACT'
		);
	}
	if (fileEscrow && escrowFromApp && fileEscrow.toLowerCase() !== escrowFromApp.toLowerCase()) {
		console.warn(
			`[passkey-e2e] .env.test VITE_ESCROW_CONTRACT (${fileEscrow}) ≠ bundle (${escrowFromApp}); using bundle for eth_call (matches lock tx). Re-sync: pnpm run build:test`
		);
	}
	passkeyE2EChainResolved = { rpcUrl: rpcUrl.trim(), escrowAddress: escrowAddress.trim() };
	logPasskeyStep(
		'run',
		`Node eth_* aligned with app bundle: RPC=${passkeyE2EChainResolved.rpcUrl} TodoEscrow=${passkeyE2EChainResolved.escrowAddress}`
	);
	return passkeyE2EChainResolved;
}

/** Same RPC the app uses: resolved from bundle first, else `.env.test`. */
function getTestChainRpcUrl() {
	if (passkeyE2EChainResolved?.rpcUrl) return passkeyE2EChainResolved.rpcUrl;
	const u = readEnvTestValue('VITE_RPC_URL');
	return u && String(u).trim() ? String(u).trim() : 'http://127.0.0.1:8545';
}

function buildTodoIdForE2e(todoKey) {
	return keccak256(toBytes(String(todoKey)));
}

/**
 * Prefer `data-escrow-todo-id` from the UI (exact bytes32 from the lock tx); fall back to keccak(db key).
 *
 * @param {string | null} escrowTodoIdAttr
 * @param {string} todoKey
 * @returns {`0x${string}`}
 */
function resolveEscrowTodoIdBytes32(escrowTodoIdAttr, todoKey) {
	const t = (escrowTodoIdAttr || '').trim();
	if (/^0x[a-fA-F0-9]{64}$/.test(t)) {
		return /** @type {`0x${string}`} */ (t);
	}
	return buildTodoIdForE2e(todoKey);
}

async function ethCall(to, data) {
	const res = await fetch(getTestChainRpcUrl(), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_call',
			params: [{ to, data }, 'latest']
		})
	});
	const j = await res.json();
	if (!j.result) throw new Error('eth_call: ' + JSON.stringify(j));
	return j.result;
}

/**
 * Viem `decodeFunctionResult` for multi-value returns is often an **array-like Result** (`row[0]…row[6]`).
 * Named keys (`row.amount`, …) may be missing, which broke polls and logged `creator=undefined`.
 *
 * Order matches `TodoEscrow.escrows`: creator, beneficiary, token, amount, released, refunded, deadline.
 *
 * @param {unknown} decoded
 */
function normalizeEscrowRowDecoded(decoded) {
	if (decoded == null) {
		throw new Error('escrows decode is null');
	}
	const o = typeof decoded === 'object' && decoded !== null ? decoded : {};
	const arr = Array.isArray(decoded) ? decoded : null;
	/** @param {number} i */
	const at = (i) =>
		(arr ? arr[i] : undefined) ??
		/** @type {Record<number, unknown>} */ (o)[i] ??
		/** @type {Record<string, unknown>} */ (o)[String(i)];

	const amountNamed = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (o).amount);
	const amountIndexed = /** @type {unknown} */ (at(3));
	const amount =
		typeof amountNamed === 'bigint'
			? amountNamed
			: typeof amountIndexed === 'bigint'
				? amountIndexed
				: undefined;

	if (amount !== undefined) {
		return {
			creator: String(at(0) ?? /** @type {Record<string, unknown>} */ (o).creator ?? ''),
			beneficiary: String(at(1) ?? /** @type {Record<string, unknown>} */ (o).beneficiary ?? ''),
			token: String(at(2) ?? /** @type {Record<string, unknown>} */ (o).token ?? ''),
			amount,
			released: Boolean(at(4) ?? /** @type {Record<string, unknown>} */ (o).released),
			refunded: Boolean(at(5) ?? /** @type {Record<string, unknown>} */ (o).refunded),
			deadline: BigInt(String(at(6) ?? /** @type {Record<string, unknown>} */ (o).deadline ?? 0))
		};
	}

	throw new Error(
		`normalizeEscrowRowDecoded: unexpected decode shape (keys=${
			typeof decoded === 'object' && decoded
				? Object.keys(/** @type {object} */ (decoded))
						.slice(0, 20)
						.join(',')
				: 'n/a'
		})`
	);
}

async function readEscrowRowOnChain(escrowAddress, todoIdBytes32) {
	const data = encodeFunctionData({
		abi: escrowsViewAbi,
		functionName: 'escrows',
		args: [todoIdBytes32]
	});
	const raw = await ethCall(escrowAddress, data);
	const decoded = decodeFunctionResult({
		abi: escrowsViewAbi,
		functionName: 'escrows',
		data: raw
	});
	return normalizeEscrowRowDecoded(decoded);
}

function logEscrowRow(prefix, row) {
	const amount = row?.amount;
	const deadline = row?.deadline;
	console.log(
		`${prefix} creator=${row?.creator} beneficiary=${row?.beneficiary} token=${row?.token} ` +
			`amount=${typeof amount === 'bigint' ? amount.toString() : amount} ` +
			`released=${row?.released} refunded=${row?.refunded} ` +
			`deadline=${typeof deadline === 'bigint' ? deadline.toString() : deadline}`
	);
}

function readPasskeyRelayInfo() {
	try {
		const p = path.join(process.cwd(), 'e2e', 'relay-info-passkey.json');
		if (fs.existsSync(p)) {
			const j = JSON.parse(fs.readFileSync(p, 'utf8'));
			return {
				httpPort: Number(j.httpPort) || 3001,
				/** From global-setup probe; current npm relay has no `/pinning/*` HTTP. */
				pinningHttpApi: j.pinningHttpApi === true
			};
		}
	} catch {
		/* ignore */
	}
	return { httpPort: 3001, pinningHttpApi: false };
}

const { httpPort: RELAY_HTTP_PORT, pinningHttpApi: RELAY_PINNING_HTTP } = readPasskeyRelayInfo();
const relayApiPassword = process.env.RELAY_API_PASSWORD || process.env.API_PASSWORD || '';

async function fetchRelayJson(pathname) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 8000);
	try {
		const response = await fetch(`http://127.0.0.1:${RELAY_HTTP_PORT}${pathname}`, {
			signal: controller.signal,
			headers: relayApiPassword ? { Authorization: `Bearer ${relayApiPassword}` } : undefined
		});
		let body = null;
		try {
			body = await response.json();
		} catch {
			/* ignore */
		}
		return { ok: response.ok, status: response.status, body };
	} catch (error) {
		return { ok: false, status: 0, body: null, error: error?.message || String(error) };
	} finally {
		clearTimeout(timeout);
	}
}

async function postRelayJson(pathname, payload, timeoutMs = 30000) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const headers = { 'Content-Type': 'application/json' };
		if (relayApiPassword) headers.Authorization = `Bearer ${relayApiPassword}`;
		const response = await fetch(`http://127.0.0.1:${RELAY_HTTP_PORT}${pathname}`, {
			method: 'POST',
			signal: controller.signal,
			headers,
			body: JSON.stringify(payload ?? {})
		});
		let body = null;
		try {
			body = await response.json();
		} catch {
			/* ignore */
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
			`Relay /pinning/stats unavailable (port ${RELAY_HTTP_PORT}, status=${result.status})`
		);
	}
	return result.body;
}

async function waitForRelayPinnedDatabaseOrThrow(
	dbAddress,
	failedSyncsBefore = 0,
	timeout = 60000
) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeout) {
		const statsResult = await fetchRelayJson('/pinning/stats');
		if (!statsResult.ok || !statsResult.body) {
			throw new Error('Relay /pinning/stats unavailable during pin wait');
		}
		const failedSyncsCurrent = Number(statsResult.body?.failedSyncs || 0);
		if (failedSyncsCurrent > failedSyncsBefore) {
			throw new Error(
				`Relay pinning failed: failedSyncs ${failedSyncsBefore} -> ${failedSyncsCurrent}`
			);
		}
		const result = await fetchRelayJson('/pinning/databases');
		if (!result.ok || !result.body) throw new Error('Relay /pinning/databases unavailable');
		const databases = Array.isArray(result.body.databases) ? result.body.databases : [];
		if (databases.some((entry) => entry?.address === dbAddress)) return result.body;
		await new Promise((r) => setTimeout(r, 1500));
	}
	throw new Error(`Timed out waiting for relay to pin ${dbAddress}`);
}

async function ethGetBalance(address) {
	const res = await fetch(getTestChainRpcUrl(), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_getBalance',
			params: [address, 'latest']
		})
	});
	const j = await res.json();
	if (!j.result) throw new Error('eth_getBalance: ' + JSON.stringify(j));
	return BigInt(j.result);
}

const escrowLockedEventAbi = parseAbiItem(
	'event EscrowLocked(bytes32 indexed todoId, address indexed creator, address indexed beneficiary, address token, uint256 amount, uint64 deadline)'
);

/**
 * @param {unknown} receipt - eth_getTransactionReceipt result
 * @param {string} escrowAddress
 * @param {string} [uiTodoIdHex] - optional compare to EscrowLocked.todoId
 */
/**
 * @param {unknown} receipt
 * @param {string} escrowAddress
 * @returns {unknown | null}
 */
function findEscrowLockedAtAddress(receipt, escrowAddress) {
	const esc = String(escrowAddress).toLowerCase();
	const logs = receipt?.logs;
	if (!Array.isArray(logs)) return null;
	for (const log of logs) {
		if (String(log.address).toLowerCase() !== esc) continue;
		try {
			const decoded = decodeEventLog({
				abi: [escrowLockedEventAbi],
				data: log.data,
				topics: log.topics
			});
			if (decoded.eventName === 'EscrowLocked') return decoded;
		} catch {
			/* not EscrowLocked */
		}
	}
	return null;
}

/** Decode any log as EscrowLocked — finds locks sent to a different TodoEscrow than the bundle address. */
function logEscrowLockedFromAnyAddressInReceipt(receipt) {
	const logs = receipt?.logs;
	if (!Array.isArray(logs)) {
		console.warn('[passkey-e2e] lock receipt has no logs array');
		return;
	}
	let any = false;
	for (const log of logs) {
		try {
			const decoded = decodeEventLog({
				abi: [escrowLockedEventAbi],
				data: log.data,
				topics: log.topics
			});
			if (decoded.eventName !== 'EscrowLocked') continue;
			any = true;
			const args = /** @type {Record<string, unknown>} */ (decoded.args);
			const tid = args.todoId != null ? String(args.todoId) : '?';
			const amt = args.amount;
			const amtStr = typeof amt === 'bigint' ? amt.toString() : String(amt);
			console.log(
				`[passkey-e2e] EscrowLocked @ ${log.address} todoId=${tid} beneficiary=${args.beneficiary} amountWei=${amtStr}`
			);
		} catch {
			/* not EscrowLocked */
		}
	}
	if (!any) {
		console.warn(
			'[passkey-e2e] No EscrowLocked in any log — lock tx did not run TodoEscrow.lockEth/lockToken in this receipt.'
		);
	}
}

function logReceiptLogEmitterAddresses(receipt) {
	const logs = receipt?.logs;
	if (!Array.isArray(logs) || logs.length === 0) return;
	const uniq = [...new Set(logs.map((l) => String(l.address).toLowerCase()))];
	console.log(`[passkey-e2e] lock tx unique log emitters (${uniq.length}): ${uniq.join(', ')}`);
}

function logEscrowLockedFromLockReceipt(receipt, escrowAddress, uiTodoIdHex) {
	const decoded = findEscrowLockedAtAddress(receipt, escrowAddress);
	if (!decoded) {
		console.warn(
			`[passkey-e2e] No EscrowLocked log from TodoEscrow ${escrowAddress} in this receipt — outer tx may not have called lockEth on this contract (7702 / batch).`
		);
		return;
	}
	const args = /** @type {Record<string, unknown>} */ (decoded.args);
	const tid = args.todoId != null ? String(args.todoId) : '?';
	const amt = args.amount;
	const amtStr = typeof amt === 'bigint' ? amt.toString() : String(amt);
	console.log(
		`[passkey-e2e] EscrowLocked in lock tx: todoId=${tid} beneficiary=${args.beneficiary} amountWei=${amtStr} creator=${args.creator}`
	);
	if (uiTodoIdHex && tid !== '?' && tid.toLowerCase() !== uiTodoIdHex.toLowerCase()) {
		console.warn(
			`[passkey-e2e] UI data-escrow-todo-id (${uiTodoIdHex}) ≠ EscrowLocked.todoId (${tid}) — escrows() poll will read wrong slot`
		);
	}
}

/**
 * ETH lock path: receipt must contain EscrowLocked from the configured contract and TodoEscrow must hold the ETH.
 * Avoids a 120s escrows() poll when the UI is wrong (tx never touched escrow).
 *
 * @param {string} lockTxHash
 * @param {unknown} lockReceipt
 * @param {string} escrowAddrForChain
 * @param {bigint} lockWei
 * @param {bigint} escrowContractBalAfterLock
 */
function assertLockTxFundedTodoEscrowOrThrow(
	lockTxHash,
	lockReceipt,
	escrowAddrForChain,
	lockWei,
	escrowContractBalAfterLock
) {
	const atBundle = findEscrowLockedAtAddress(lockReceipt, escrowAddrForChain);
	if (!atBundle) {
		logEscrowLockedFromAnyAddressInReceipt(lockReceipt);
		logReceiptLogEmitterAddresses(lockReceipt);
		const rawGu = lockReceipt?.gasUsed ?? lockReceipt?.cumulativeGasUsed;
		let gasUsedNum = null;
		if (rawGu != null) {
			if (typeof rawGu === 'bigint') gasUsedNum = Number(rawGu);
			else if (typeof rawGu === 'number') gasUsedNum = rawGu;
			else {
				const s = String(rawGu);
				gasUsedNum = s.startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);
			}
			if (Number.isNaN(gasUsedNum)) gasUsedNum = null;
		}
		const gasHint =
			gasUsedNum != null
				? gasUsedNum < 120_000
					? ` receipt.gasUsed≈${gasUsedNum} — very low with no logs: often broken Anvil EIP-7702 self-execute (app should use direct owner→TodoEscrow txs on 31337; rebuild build:test).`
					: ` receipt.gasUsed≈${gasUsedNum} — still no EscrowLocked: check tx target/calldata with cast run, or stale preview bundle.`
				: '';
		throw new Error(
			`[passkey-e2e] Lock tx ${lockTxHash} succeeded on-chain but TodoEscrow (${escrowAddrForChain}) emitted no EscrowLocked.${gasHint} ` +
				'The UI can still show "Escrow: locked" from OrbDB state. Fix the wallet path (7702 `execute` → escrow `lockEth`) or VITE_ESCROW_CONTRACT / Anvil deploy mismatch. ' +
				'Rebuild `build:test` after wallet changes; preview must serve that build.'
		);
	}
	if (escrowContractBalAfterLock < lockWei) {
		throw new Error(
			`[passkey-e2e] EscrowLocked appeared but TodoEscrow (${escrowAddrForChain}) ETH balance is ${escrowContractBalAfterLock} wei (< ${lockWei}). ` +
				'Possible wrong contract in receipt decode, partial execution, or RPC not seeing latest block.'
		);
	}
}

/**
 * Confirms a tx hash is mined on Anvil with success status (proves Confirm & Pay / lock sent a real tx).
 *
 * @param {string} txHash
 * @returns {Promise<unknown>} raw JSON-RPC receipt (for log decoding)
 */
async function assertSuccessfulTxReceipt(txHash, label) {
	const res = await fetch(getTestChainRpcUrl(), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_getTransactionReceipt',
			params: [txHash]
		})
	});
	const j = await res.json();
	if (!j.result) {
		throw new Error(`${label}: eth_getTransactionReceipt missing result: ${JSON.stringify(j)}`);
	}
	const st = j.result.status;
	const ok = st === '0x1' || st === '0x01' || st === 1 || st === '1' || st === true;
	expect(ok, `${label}: receipt status not success for ${txHash} (got ${String(st)})`).toBe(true);
	logPasskeyStep(
		'run',
		`${label}: on-chain receipt OK — ${txHash} blockNumber=${j.result.blockNumber ?? '?'}`
	);
	return j.result;
}

async function safeCloseContext(context) {
	if (!context) return;
	try {
		await context.close();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('ENOENT')) {
			console.warn('Ignoring context close ENOENT:', message);
			return;
		}
		throw error;
	}
}

/** @param {import('@playwright/test').Page} page */
function attachPasskeyDebugLogging(page, tag) {
	const prefix = `[passkey-e2e:${tag}]`;
	const verbose = process.env.PW_PASSKEY_VERBOSE === '1';
	page.on('console', (msg) => {
		const text = msg.text();
		if (msg.type() === 'error') {
			console.error(prefix, 'console.error:', text);
		} else if (verbose) {
			console.log(prefix, `console.${msg.type()}:`, text);
		}
	});
	page.on('pageerror', (err) => console.error(prefix, 'pageerror:', err.message));
	page.on('close', () => console.log(prefix, 'page closed'));
	page.on('requestfailed', (req) => {
		const f = req.failure();
		if (f) console.warn(prefix, 'requestfailed:', req.url(), f.errorText);
	});
}

function logPasskeyStep(role, step) {
	console.log(`[passkey-e2e:${role}] ${step}`);
}

/**
 * Select a DID in the Users combobox (opens that user's projects DB). Needed so Passkey Wallet / todos
 * run in the right DB context; clicking the list row from Playwright often fails because blur closes the
 * dropdown before the click lands — we use fill + Enter (single match) or force-click the option.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @param {string} did
 */
async function selectUserDidInCombobox(page, label, did) {
	if (!did || typeof did !== 'string') return;
	logPasskeyStep(
		label,
		`Users combobox: select current DID (${did.slice(0, 28)}…) for app context`
	);
	await ensureSettingsExpanded(page);
	const input = page.locator('#users-list');
	await expect(input).toBeVisible({ timeout: 20000 });
	await expect(input).toBeEnabled({ timeout: 20000 });
	await input.click();
	await input.fill(did);
	// Listbox is gated on `showDropdown`; blur/timing can skip rendering it while Enter still selects.
	const listbox = page.getByTestId('users-listbox');
	let listboxVisible = false;
	try {
		await listbox.waitFor({ state: 'visible', timeout: 8000 });
		listboxVisible = true;
	} catch {
		// fall through to Enter
	}

	const byAttr = page.locator(`[data-testid="users-list-select-did"][data-user-did="${did}"]`);
	if (listboxVisible && (await byAttr.count()) === 1) {
		await byAttr.click({ force: true });
	} else {
		await input.press('Enter');
	}

	await page.waitForTimeout(600);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @param {string} did
 */
async function setupPasskeyWallet(page, label, did) {
	await selectUserDidInCombobox(page, label, did);

	logPasskeyStep(label, 'Passkey Wallet Profile: warning checkbox + Create Passkey Smart Account…');
	const walletProfile = page.getByTestId('wallet-profile');
	if (!(await walletProfile.isVisible().catch(() => false))) {
		const walletSectionToggle = page.getByRole('button', { name: /Passkey Wallet/i });
		await expect(walletSectionToggle).toBeVisible({ timeout: 15000 });
		await walletSectionToggle.click();
	}
	await expect(walletProfile).toBeVisible({ timeout: 15000 });
	await walletProfile.scrollIntoViewIfNeeded();

	await page.getByTestId('wallet-smart-account-warning').check();
	await expect(page.getByTestId('wallet-smart-account-warning')).toBeChecked();

	const createBtn = page.getByTestId('wallet-create-smart-account');
	await expect(createBtn).toBeEnabled({ timeout: 180000 });
	await createBtn.click();

	logPasskeyStep(label, 'waiting for smart account UI (fund button, up to 5 min)…');
	const fundBtn = page.getByTestId('wallet-fund-anvil');
	const funderMissingHint = page.getByText(/Local fund button is disabled/);
	try {
		await expect(fundBtn.or(funderMissingHint)).toBeVisible({ timeout: 300000 });
	} catch (e) {
		await page
			.screenshot({
				path: `test-results/passkey-escrow/${label.toLowerCase()}-no-fund-button.png`,
				fullPage: true
			})
			.catch(() => {});
		throw new Error(
			`${e?.message || String(e)} — If "Fund 2 ETH" never appears: rebuild with .env.test that sets VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY (global setup merges it) or check Wallet Profile for "Local fund button is disabled".`
		);
	}
	if (await funderMissingHint.isVisible().catch(() => false)) {
		await page
			.screenshot({
				path: `test-results/passkey-escrow/${label.toLowerCase()}-funder-not-in-bundle.png`,
				fullPage: true
			})
			.catch(() => {});
		throw new Error(
			`Passkey E2E (${label}): "Fund 2 ETH" is missing because VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY was not compiled into the app. ` +
				`With PW_REUSE_PREVIEW=1, global setup adds the key to .env.test after you may have built — run \`pnpm run build:test\` with VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY in .env.test, then \`pnpm run preview:test\`, and re-run.`
		);
	}
	await expect(fundBtn).toBeEnabled({ timeout: 60000 });
	await fundBtn.click();
	// Success is a 3s toast with slide-in CSS; headless often never satisfies Playwright "visible".
	// Treat button idle + on-chain balance as ground truth (same RPC as `getTestChainRpcUrl()`).
	await expect(fundBtn).toBeEnabled({ timeout: 120000 });
	await expect(fundBtn).toHaveText(/Fund 2 ETH/, { timeout: 15000 });

	const fundErr = page.getByText(/Failed to fund local account/i);
	if (await fundErr.isVisible().catch(() => false)) {
		throw new Error(
			`Passkey E2E (${label}): local fund failed (toast). Check Anvil, funder key, and RPC.`
		);
	}

	const addrSpan = page.getByTestId('wallet-smart-account-address');
	await expect(addrSpan).toBeVisible({ timeout: 15000 });
	const fundedAddr = (await addrSpan.textContent())?.trim();
	expect(fundedAddr).toMatch(/^0x[a-fA-F0-9]{40}$/);
	const minWei = parseEther('1');
	await expect
		.poll(async () => (await ethGetBalance(fundedAddr)) >= minWei, {
			timeout: 90000,
			intervals: [400, 800, 1200, 2000]
		})
		.toBe(true);

	console.log(`✅ ${label}: smart account funded`);
}

/**
 * Read Bob’s payout address as shown in Wallet Profile (smart account line + input should match).
 *
 * @param {import('@playwright/test').Page} page
 */
async function readVisibleSmartAccountAddress(page) {
	const bySummary = page.getByTestId('wallet-smart-account-address');
	await expect(bySummary).toBeVisible({ timeout: 30000 });
	const fromSummary = (await bySummary.textContent())?.trim() || '';
	expect(fromSummary).toMatch(/^0x[a-fA-F0-9]{40}$/);

	const input = page.getByTestId('wallet-address-input');
	const fromInput = (await input.inputValue()).trim();
	expect(fromInput.toLowerCase()).toBe(fromSummary.toLowerCase());

	return fromSummary;
}

/**
 * Balance + “Latest transactions” are loaded via `refreshSmartAccountInsights`; list stays stale until this runs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label - log label (Alice / Bob)
 * @param {string} did - DID for Users combobox (which DB + profile context)
 */
async function refreshWalletBalanceAndTxs(page, label, did) {
	logPasskeyStep(label, 'Wallet Profile: Refresh balance + txs');
	await selectUserDidInCombobox(page, label, did);
	await page.getByTestId('wallet-profile').scrollIntoViewIfNeeded();
	const btn = page.getByTestId('wallet-refresh-balance-txs');
	await expect(btn).toBeVisible({ timeout: 20000 });
	await expect(btn).toBeEnabled({ timeout: 10000 });
	await btn.click();
	await expect(btn).toBeEnabled({ timeout: 120000 });
}

/** Headed runs: explains why TODO Items (0) is normal until Alice clicks Add (and Bob until P2P + Alice’s DB). */
async function logTodoUiSnapshot(page, who) {
	const itemCount = await page.getByTestId('todo-item').count();
	let heading = '';
	try {
		heading =
			(
				await page
					.getByRole('heading', { name: /TODO Items/ })
					.first()
					.textContent()
			)?.trim() || '';
	} catch {
		heading = '(heading not found)';
	}
	console.log(
		`[passkey-e2e:${who}] TODO UI snapshot: ${heading} → data-todo-item count=${itemCount}`
	);
	return itemCount;
}

test.describe('Passkey wallet + escrow (Alice / Bob)', () => {
	test.describe.configure({ timeout: 600_000, mode: 'serial' });

	test('Alice locks ETH for Bob’s passkey wallet; Bob completes; Alice pays; Bob’s smart account balance increases', async ({
		browser
	}) => {
		const contextAlice = await browser.newContext();
		const contextBob = await browser.newContext();
		const alice = await contextAlice.newPage();
		const bob = await contextBob.newPage();
		attachPasskeyDebugLogging(alice, 'Alice');
		attachPasskeyDebugLogging(bob, 'Bob');

		const todoTitle = `Passkey escrow E2E ${Date.now()}`;

		console.log(
			`[passkey-e2e] app http://localhost:4174 relay HTTP ${RELAY_HTTP_PORT} — PW_HEADED=${process.env.PW_HEADED || '(unset)'} PW_PASSKEY_VERBOSE=${process.env.PW_PASSKEY_VERBOSE || '(unset)'} PW_SLOW_MO=${process.env.PW_SLOW_MO || '(unset)'}`
		);

		async function initializeWithWebAuthn(page, label) {
			logPasskeyStep(label, 'addVirtualAuthenticator…');
			await addVirtualAuthenticator(page);
			logPasskeyStep(label, 'virtual authenticator OK');

			if (process.env.PW_HEADED === '1') {
				await page.bringToFront();
			}

			// `load` can hang on long-lived connections; `domcontentloaded` is enough to interact with consent.
			logPasskeyStep(label, "page.goto('/') waitUntil=domcontentloaded (120s)…");
			await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
			logPasskeyStep(label, `goto done url=${page.url()}`);

			logPasskeyStep(label, 'wait for <main> or consent modal (30s)…');
			await page.waitForFunction(
				() =>
					document.querySelector('main') !== null ||
					document.querySelector('[data-testid="consent-modal"]') !== null,
				{ timeout: 30_000 }
			);
			await page.waitForTimeout(800);

			logPasskeyStep(label, 'consent modal visible → Accept');
			await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible({ timeout: 15000 });
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
			await page.getByTestId('consent-accept-button').click();
			await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

			logPasskeyStep(label, 'waitForP2PInitialization (todo-input + footer)…');
			await waitForP2PInitialization(page);

			logPasskeyStep(label, 'P2Pass footer → worker passkey…');
			await setupPasskeyViaP2PassPanel(page, { mode: 'worker' });

			logPasskeyStep(label, 'expect identity-mode (software or worker until OrbitDB bridge)…');
			await expect(page.getByTestId('identity-mode')).toContainText(
				/software|worker \(ed25519\)/i,
				{
					timeout: 30000
				}
			);
			console.log(`✅ ${label}: P2P + worker identity ready`);
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

		async function assertDelegatedStateAfterAction(page, delegatedAuthState) {
			const state = await delegatedAuthState.getAttribute('data-state');
			if (state === 'awaiting' || state === 'success') {
				await expect(delegatedAuthState).toHaveAttribute('data-state', 'success', {
					timeout: 20000
				});
				return;
			}
			await expect(delegatedAuthState).toHaveAttribute('data-state', 'idle');
		}

		async function assertAccessControllerType(page, expectedType, timeout = 45000) {
			await expect
				.poll(async () => await page.evaluate(() => window.__todoDB__?.access?.type || null), {
					timeout
				})
				.toBe(expectedType);
		}

		try {
			await initializeWithWebAuthn(alice, 'Alice');
			const aliceDid = await alice.evaluate(() => window.__currentIdentityId__ || null);
			expect(aliceDid).toBeTruthy();

			// Bob before long smart-account steps so the second headed window loads the app early.
			logPasskeyStep(
				'run',
				'initialize Bob (WebAuthn + P2P), then Bob passkey wallet → visible address for Alice’s delegate field'
			);
			await initializeWithWebAuthn(bob, 'Bob');
			const bobDid = await bob.evaluate(() => window.__currentIdentityId__ || null);
			expect(bobDid).toBeTruthy();

			await setupPasskeyWallet(bob, 'Bob', bobDid);
			const bobPayoutAddress = await readVisibleSmartAccountAddress(bob);
			logPasskeyStep(
				'run',
				`Bob payout (smart account) address for delegation: ${bobPayoutAddress}`
			);

			await setupPasskeyWallet(alice, 'Alice', aliceDid);
			const aliceSmartAccountAddress = await readVisibleSmartAccountAddress(alice);
			logPasskeyStep(
				'run',
				`Alice smart account (lock + release payer): ${aliceSmartAccountAddress}`
			);
			await resolvePasskeyE2EChainFromApp(alice);

			await logTodoUiSnapshot(alice, 'Alice');
			await logTodoUiSnapshot(bob, 'Bob');
			console.log(
				'[passkey-e2e:run] Expect TODO Items (0) above until this step: Alice adds the delegated todo next; Bob stays on his own DB until we select Alice’s DID + sync.'
			);

			logPasskeyStep(
				'run',
				'P2P mesh: wait for ≥2 peers on Alice and Bob before delegated todo (helps replication)'
			);
			await Promise.all([
				waitForPeerCount(alice, 2, 120000),
				waitForPeerCount(bob, 2, 120000)
			]);

			logPasskeyStep('Alice', 'expand Add Todo section (collapsible; default is collapsed)');
			await ensureAddTodoExpanded(alice);

			await alice.getByRole('button', { name: /Show Advanced Fields/i }).click();
			await alice.getByTestId('todo-input').fill(todoTitle);
			await alice.locator('#add-todo-cost-currency').selectOption('eth');
			await alice.locator('#add-todo-cost').fill(LOCK_ETH);

			await alice.locator('#add-todo-delegate-did').fill(bobDid);
			await alice.locator('#add-todo-delegate-wallet').fill(bobPayoutAddress);
			const delegateWalletFilled = (
				await alice.locator('#add-todo-delegate-wallet').inputValue()
			).trim();
			expect(delegateWalletFilled.toLowerCase()).toBe(bobPayoutAddress.toLowerCase());
			await alice.getByTestId('add-todo-button').click();
			await ensureTodoListSectionExpanded(alice);
			await waitForTodoText(alice, todoTitle, 60000, { browserName: 'chromium' });
			await logTodoUiSnapshot(alice, 'Alice');
			await expect(alice.getByTestId('todo-item')).toHaveCount(1);

			const aliceDbAddress = await getCurrentDatabaseAddress(alice, 20000);
			expect(aliceDbAddress).toBeTruthy();
			await assertAccessControllerType(alice, 'todo-delegation', 45000);

			if (RELAY_PINNING_HTTP) {
				const pinningStatsBefore = await getRelayPinningStatsOrThrow();
				const failedSyncsBefore = Number(pinningStatsBefore?.failedSyncs || 0);
				await postRelayJson('/pinning/sync', { dbAddress: aliceDbAddress }, 45000);
				await waitForRelayPinnedDatabaseOrThrow(aliceDbAddress, failedSyncsBefore, 60000);
			} else {
				logPasskeyStep(
					'run',
					'skip relay /pinning/* (not in this orbitdb-relay-pinner HTTP server) — waiting on P2P replication only'
				);
			}

			await addAndSelectUserByDid(bob, aliceDid);
			await expect
				.poll(async () => await getCurrentDatabaseAddress(bob, 15000), { timeout: 120000 })
				.toBe(aliceDbAddress);
			await assertAccessControllerType(bob, 'todo-delegation', 45000);

			// Align with simple-todo two-browser tests: relay + other browser (not a specific peer id string).
			await waitForPeerCount(bob, 2, 120000);

			await waitForTodoVisibleWithReplicationPoll(bob, todoTitle, {
				totalTimeoutMs: 120000,
				browserName: 'chromium'
			});
			await logTodoUiSnapshot(bob, 'Bob');
			await expect(bob.getByTestId('todo-item')).toHaveCount(1);

			const aliceRow = alice
				.locator('div.rounded-md.border', { has: alice.locator(`[data-todo-text="${todoTitle}"]`) })
				.first();

			const aliceBalanceBeforeLock = await ethGetBalance(aliceSmartAccountAddress);
			logPasskeyStep(
				'run',
				`Alice balance before lock (wei): ${aliceBalanceBeforeLock.toString()}`
			);

			await expect(aliceRow.getByTestId('todo-lock-funds')).toBeEnabled({ timeout: 180000 });
			await aliceRow.getByTestId('todo-lock-funds').click();
			await expect(aliceRow.getByText(/Escrow: locked/i)).toBeVisible({ timeout: 300000 });

			const aliceBalanceAfterLock = await ethGetBalance(aliceSmartAccountAddress);
			logPasskeyStep('run', `Alice balance after lock (wei): ${aliceBalanceAfterLock.toString()}`);
			const aliceSpentOnLock = aliceBalanceBeforeLock - aliceBalanceAfterLock;
			if (aliceSpentOnLock < LOCK_WEI) {
				logPasskeyStep(
					'run',
					`Alice balance delta after lock = ${aliceSpentOnLock.toString()} wei (often gas-only on EIP-7702/AA). ` +
						'Asserting lock via TodoEscrow.escrows, not Alice balance drop.'
				);
			}

			const { escrowAddress: escrowAddrForChain } =
				/** @type {{ rpcUrl: string, escrowAddress: string }} */ (passkeyE2EChainResolved);
			expect(
				escrowAddrForChain,
				'TodoEscrow address from app bundle (__PASSKEY_E2E_CHAIN__)'
			).toMatch(/^0x[a-fA-F0-9]{40}$/i);
			const todoKeyForChain = await aliceRow.getAttribute('data-todo-key');
			expect(
				todoKeyForChain,
				'todo row must expose data-todo-key for on-chain escrows(bytes32)'
			).toBeTruthy();

			await expect(aliceRow.getByTestId('todo-lock-tx-hash')).toBeVisible({ timeout: 120000 });
			const lockTxHash = (await aliceRow.getByTestId('todo-lock-tx-hash').textContent())?.trim();
			expect(lockTxHash, 'Lock UI should show a 32-byte tx hash from the wallet').toMatch(
				/^0x[a-fA-F0-9]{64}$/
			);
			const lockReceipt = await assertSuccessfulTxReceipt(lockTxHash, 'Lock');
			const escrowTodoIdAttrForLog = await aliceRow.getAttribute('data-escrow-todo-id');
			const todoIdBytes32Ui = resolveEscrowTodoIdBytes32(escrowTodoIdAttrForLog, todoKeyForChain);
			logEscrowLockedFromLockReceipt(lockReceipt, escrowAddrForChain, todoIdBytes32Ui);
			const escrowContractBalAfterLock = await ethGetBalance(escrowAddrForChain);
			logPasskeyStep(
				'run',
				`TodoEscrow contract ETH balance after lock (wei): ${escrowContractBalAfterLock.toString()} — expect ≥ LOCK_WEI if ETH landed in contract`
			);
			assertLockTxFundedTodoEscrowOrThrow(
				lockTxHash,
				lockReceipt,
				escrowAddrForChain,
				LOCK_WEI,
				escrowContractBalAfterLock
			);

			// On-chain escrow only (not waiting for Bob’s checkbox). `escrowAddrForChain` matches the bundle
			// (see resolvePasskeyE2EChainFromApp). If amount=0 / beneficiary=0x0… → wrong todoId or lock failed silently.
			logPasskeyStep(
				'run',
				`Polling TodoEscrow on RPC=${getTestChainRpcUrl()} contract=${escrowAddrForChain} beneficiary(Bob)=${bobPayoutAddress} LOCK_WEI=${LOCK_WEI.toString()} uiTodoId=${todoIdBytes32Ui}`
			);

			await expect
				.poll(
					async () => {
						try {
							const escrowTodoIdAttr = await aliceRow.getAttribute('data-escrow-todo-id');
							const todoIdBytes32 = resolveEscrowTodoIdBytes32(escrowTodoIdAttr, todoKeyForChain);
							const row = await readEscrowRowOnChain(escrowAddrForChain, todoIdBytes32);
							const ok =
								row.amount >= LOCK_WEI &&
								!row.released &&
								String(row.beneficiary || '').toLowerCase() === bobPayoutAddress.toLowerCase();
							if (!ok) {
								logEscrowRow(
									`[passkey-e2e] on-chain escrow after lock (waiting) todoId=${todoIdBytes32}`,
									row
								);
							}
							return ok;
						} catch (e) {
							console.log(`[passkey-e2e] read escrow after lock failed: ${e?.message || e}`);
							return false;
						}
					},
					{
						timeout: 120_000,
						message:
							'After Escrow: locked UI, TodoEscrow.escrows(todoId) must show amount ≥ lock, beneficiary = Bob, released=false. ' +
							'Escrow contract + RPC are taken from window.__PASSKEY_E2E_CHAIN__ (build:test). If still empty: wrong todoId, ' +
							'Anvil reset, or lock reverted. (Alice eth_getBalance may not drop by full LOCK_ETH on 7702 path.)'
					}
				)
				.toBe(true);

			logPasskeyStep(
				'run',
				'After lock: refresh Alice wallet insights (balance + Latest transactions scan)'
			);
			await refreshWalletBalanceAndTxs(alice, 'Alice', aliceDid);
			await expect
				.poll(async () => alice.getByTestId('wallet-recent-tx-row').count(), { timeout: 90000 })
				.toBeGreaterThan(0);

			// Bob’s balance here = after fund + any gas; escrow still holds LOCK_ETH until release.
			const bobBalanceBeforeRelease = await ethGetBalance(bobPayoutAddress);
			logPasskeyStep(
				'run',
				`Bob smart account balance before release (wei): ${bobBalanceBeforeRelease.toString()} — expect this to jump after Alice confirms pay`
			);

			const bobRow = bob
				.locator('div.rounded-md.border', { has: bob.locator(`[data-todo-text="${todoTitle}"]`) })
				.first();
			const delegatedAuthState = bob.getByTestId('delegated-auth-state');
			logPasskeyStep(
				'run',
				'Bob: mark delegated todo complete (checkbox) so Alice can Confirm & Pay'
			);
			const bobComplete = bobRow.getByTestId('todo-complete-checkbox');
			await expect(bobComplete).toBeEnabled({ timeout: 120000 });
			await expect(bobComplete).not.toBeChecked();
			await bobComplete.click();
			await expect(bobComplete).toBeChecked({ timeout: 60000 });
			await assertDelegatedStateAfterAction(bob, delegatedAuthState);
			// Re-check after delegated-auth flow: if replication rewrote the todo, unchecked would block release.
			await expect
				.poll(async () => bobComplete.isChecked(), {
					timeout: 30000,
					message:
						'Bob’s todo-complete-checkbox should stay checked after delegate signing (if false, Bob did not complete / DB reverted).'
				})
				.toBe(true);

			await expect(aliceRow.getByTestId('todo-complete-checkbox')).toBeChecked({
				timeout: 120000
			});

			logPasskeyStep('run', 'Alice: Confirm & Pay (escrow release tx)');
			await expect(aliceRow.getByTestId('todo-confirm-pay')).toBeEnabled({ timeout: 180000 });
			await aliceRow.getByTestId('todo-confirm-pay').click();
			await expect(aliceRow.getByText(/Escrow: released/i)).toBeVisible({ timeout: 300000 });

			await expect(aliceRow.getByTestId('todo-release-tx-hash')).toBeVisible({ timeout: 120000 });
			const releaseTxHash = (
				await aliceRow.getByTestId('todo-release-tx-hash').textContent()
			)?.trim();
			expect(
				releaseTxHash,
				'Confirm & Pay should persist a real release tx hash on the todo'
			).toMatch(/^0x[a-fA-F0-9]{64}$/);
			await assertSuccessfulTxReceipt(releaseTxHash, 'Release (Confirm & Pay)');

			// UI only updates after `releaseEscrowForTodo` returns; still verify Anvil state matches Bob’s payout
			// address so failures aren’t a 120s “silent” balance poll when contract/RPC/todoId diverge.
			// escrowAddrForChain + todoKeyForChain were set after lock.

			await expect
				.poll(
					async () => {
						try {
							const escrowTodoIdAttr = await aliceRow.getAttribute('data-escrow-todo-id');
							const todoIdBytes32 = resolveEscrowTodoIdBytes32(escrowTodoIdAttr, todoKeyForChain);
							const row = await readEscrowRowOnChain(escrowAddrForChain, todoIdBytes32);
							const released = Boolean(row.released);
							const beneficiaryOk =
								String(row.beneficiary || '').toLowerCase() === bobPayoutAddress.toLowerCase();
							const amountOk = row.amount >= LOCK_WEI;
							if (!released || !beneficiaryOk || !amountOk) {
								logEscrowRow(
									`[passkey-e2e] on-chain escrow poll (waiting) todoId=${todoIdBytes32}`,
									row
								);
							}
							return released && beneficiaryOk && amountOk;
						} catch (e) {
							console.log(`[passkey-e2e] on-chain escrows() read failed: ${e?.message || e}`);
							return false;
						}
					},
					{
						timeout: 120_000,
						message:
							'UI shows Escrow: released but TodoEscrow.escrows(todoId) is not released, beneficiary ≠ Bob’s smart account, or amount < lock. ' +
							'Compare VITE_ESCROW_CONTRACT / RPC in .env.test with the app build; avoid PW_REUSE_PREVIEW without pnpm run build:test.'
					}
				)
				.toBe(true);

			try {
				await expect
					.poll(
						async () => {
							const after = await ethGetBalance(bobPayoutAddress);
							const ok = after > bobBalanceBeforeRelease;
							if (!ok) {
								console.log(
									`[passkey-e2e] Bob smart account balance poll: beforeWei=${bobBalanceBeforeRelease.toString()} afterWei=${after.toString()} expected increase after release (lock ${LOCK_ETH} ETH)`
								);
							}
							return ok;
						},
						{
							timeout: 120000,
							message:
								'Bob’s passkey smart account (delegate wallet) should receive locked ETH after on-chain release. ' +
								'Check same Anvil RPC as VITE_RPC_URL, beneficiary = visible profile address, and release tx success.'
						}
					)
					.toBe(true);
			} catch (err) {
				const afterFail = await ethGetBalance(bobPayoutAddress).catch(() => null);
				console.log(
					`[passkey-e2e] Bob smart account balance on failure: beforeWei=${bobBalanceBeforeRelease.toString()} afterWei=${afterFail?.toString() ?? 'n/a'}`
				);
				const escrowAddrDiag =
					passkeyE2EChainResolved?.escrowAddress || readEnvTestValue('VITE_ESCROW_CONTRACT');
				const todoKeyDiag = await aliceRow.getAttribute('data-todo-key');
				const escrowTodoIdDiag = await aliceRow.getAttribute('data-escrow-todo-id');
				if (escrowAddrDiag && todoKeyDiag && escrowAddrDiag.startsWith('0x')) {
					try {
						const tid = resolveEscrowTodoIdBytes32(escrowTodoIdDiag, todoKeyDiag);
						const row = await readEscrowRowOnChain(escrowAddrDiag, tid);
						logEscrowRow(`[passkey-e2e] TodoEscrow.escrows after failure todoId=${tid}`, row);
					} catch (e) {
						console.warn('[passkey-e2e] could not read escrow row:', e?.message || e);
					}
				}
				throw err;
			}

			const bobBalanceAfter = await ethGetBalance(bobPayoutAddress);
			const aliceBalanceAfterRelease = await ethGetBalance(aliceSmartAccountAddress);
			const bobDelta = bobBalanceAfter - bobBalanceBeforeRelease;
			expect(
				bobDelta >= LOCK_WEI,
				`Bob should gain at least locked amount on release: deltaWei=${bobDelta.toString()}`
			).toBe(true);
			logPasskeyStep(
				'run',
				`Alice balance after release (wei): ${aliceBalanceAfterRelease.toString()} — release only costs Alice gas (${LOCK_ETH} ETH left escrow → Bob, not Alice’s balance)`
			);
			expect(
				aliceBalanceAfterRelease <= aliceBalanceAfterLock,
				'After release Alice balance should not increase (payout comes from escrow contract, not refund to Alice)'
			).toBe(true);
			const aliceGasRelease = aliceBalanceAfterLock - aliceBalanceAfterRelease;
			const maxReasonableGasWei = parseEther('0.05');
			expect(
				aliceGasRelease <= maxReasonableGasWei,
				`Alice gas for release tx should be bounded: gasWei=${aliceGasRelease.toString()}`
			).toBe(true);
			console.log(
				`✅ Bob smart account balance: beforeRelease=${bobBalanceBeforeRelease.toString()} after=${bobBalanceAfter.toString()} (delta=${bobDelta.toString()})`
			);
			console.log(
				`✅ Alice smart account balance: beforeLock=${aliceBalanceBeforeLock.toString()} afterLock=${aliceBalanceAfterLock.toString()} afterRelease=${aliceBalanceAfterRelease.toString()}`
			);

			// Insights UI only picks up new txs after explicit refresh (both browsers).
			logPasskeyStep(
				'run',
				'After release: Refresh balance + txs on Alice + Bob; assert Latest transactions lists update'
			);
			if (process.env.PW_HEADED === '1') {
				await alice.bringToFront();
			}
			await refreshWalletBalanceAndTxs(alice, 'Alice', aliceDid);
			await expect(alice.getByTestId('wallet-smart-account-summary')).toContainText(
				aliceSmartAccountAddress,
				{
					timeout: 15000
				}
			);
			await expect
				.poll(async () => alice.getByTestId('wallet-recent-tx-row').count(), { timeout: 90000 })
				.toBeGreaterThan(0);
			await expect(
				alice
					.getByTestId('wallet-recent-tx-row')
					.filter({ hasText: /outgoing/i })
					.first()
			).toBeVisible({ timeout: 15000 });

			if (process.env.PW_HEADED === '1') {
				await bob.bringToFront();
			}
			await refreshWalletBalanceAndTxs(bob, 'Bob', bobDid);
			await expect(bob.getByTestId('wallet-smart-account-summary')).toContainText(
				bobPayoutAddress,
				{
					timeout: 15000
				}
			);
			await expect
				.poll(async () => bob.getByTestId('wallet-recent-tx-row').count(), { timeout: 90000 })
				.toBeGreaterThan(0);
			// Direct ETH sends show as "incoming"; escrow payout is internal to the outer tx — insights merge
			// `EscrowReleased` logs as "incoming (escrow ETH)" with the released amount in Value.
			await expect(
				bob
					.getByTestId('wallet-recent-tx-row')
					.filter({ hasText: /incoming/i })
					.first()
			).toBeVisible({ timeout: 15000 });
			await expect(
				bob
					.getByTestId('wallet-recent-tx-row')
					.filter({ hasText: /escrow ETH/i })
					.first()
			).toBeVisible({
				timeout: 30000
			});
			const bobEscrowRow = bob
				.getByTestId('wallet-recent-tx-row')
				.filter({ hasText: /escrow ETH/i })
				.first();
			const bobEscrowRowText = (await bobEscrowRow.textContent()) || '';
			const expectedValueSnippet = `Value: ${lockEthDisplayForUiAssert()}`;
			expect(
				bobEscrowRowText.includes(expectedValueSnippet),
				`Bob wallet insights should list escrow release ${expectedValueSnippet} in the row; got: ${bobEscrowRowText.slice(0, 400)}`
			).toBe(true);
		} finally {
			await safeCloseContext(contextAlice);
			await safeCloseContext(contextBob);
		}
	});
});
