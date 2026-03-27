import {
	createPublicClient,
	createWalletClient,
	decodeEventLog,
	http,
	parseAbiItem,
	parseEther,
	zeroAddress
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
	getAppChain,
	getEscrowAddress,
	getLocalDevFunderPrivateKey,
	getRpcUrl
} from '../chain/config.js';
import { accountABI } from './openfort/accountABI.js';

/**
 * @typedef {{
 *   hash: `0x${string}`,
 *   blockNumber: bigint,
 *   timestamp: number,
 *   from: `0x${string}` | null,
 *   to: `0x${string}` | null,
 *   value: bigint,
 *   direction: string,
 *   escrowGrossWei?: bigint,
 *   escrowFeeWei?: bigint
 * }} AccountTxRow
 */

/** Default block scan depth. Keep low: each block uses one `eth_getBlock(full)` — public RPCs rate-limit hard. */
const DEFAULT_LOOKBACK_BLOCKS = 32n;
/** Hard cap so `.env` cannot accidentally trigger hundreds of `getBlock` calls per refresh. */
const MAX_LOOKBACK_BLOCKS = 64n;
/** Enough rows that `incoming (escrow ETH)` from logs is not evicted when many top-level txs share a block. */
const DEFAULT_TX_LIMIT = 16;

function clampBlockLookback(requested) {
	const n = requested > MAX_LOOKBACK_BLOCKS ? MAX_LOOKBACK_BLOCKS : requested;
	return n < 0n ? 0n : n;
}

// Must match `contracts/TodoEscrow.sol` (feeRecipient + gross/fee/net — not the old single `amount`).
const escrowReleasedEvent = parseAbiItem(
	'event EscrowReleased(bytes32 indexed todoId, address indexed beneficiary, address indexed feeRecipient, address token, uint256 grossAmount, uint256 feeAmount, uint256 netAmount)'
);

function insightsHttpTransport(rpcUrl) {
	return http(rpcUrl, {
		retryCount: 2,
		retryDelay: ({ count }) => Math.min(1500 * 2 ** count, 10_000),
		timeout: 25_000
	});
}

function getInsightsClient() {
	const rpcUrl = getRpcUrl();
	if (!rpcUrl) throw new Error('VITE_RPC_URL is not configured');

	return createPublicClient({
		chain: getAppChain(),
		transport: insightsHttpTransport(rpcUrl)
	});
}

/**
 * Whether the passkey smart account is live on-chain. EIP-7702 often yields empty `eth_getCode` on
 * the EOA; we then use `initialized()` via `eth_call` at the same address (delegated code).
 *
 * @param {`0x${string}`} address
 * @param {{ transactions?: Array<{ direction?: string, value?: bigint }> }} [options]
 * @returns {Promise<{ deployed: boolean | null }>} `true` = active, `false` = clearly not, `null` = unknown
 */
export async function probePasskeySmartAccountDeployed(address, { transactions = [] } = {}) {
	const client = getInsightsClient();
	const chain = getAppChain();
	const addressHex = /** @type {`0x${string}`} */ (address);

	const code = await client.getBytecode({ address: addressHex });
	if (code && code !== '0x') {
		return { deployed: true };
	}

	try {
		const initialized = await client.readContract({
			address: addressHex,
			abi: accountABI,
			functionName: 'initialized'
		});
		return { deployed: Boolean(initialized) };
	} catch {
		// No delegation, wrong implementation ABI, or RPC does not run 7702 delegation on eth_call.
	}

	const likely7702Bootstrap =
		chain.id !== 31337 &&
		transactions?.some((t) => t.direction === 'self' && t.value === 0n);
	if (likely7702Bootstrap) {
		return { deployed: null };
	}

	return { deployed: chain.id === 31337 ? false : null };
}

/** @param {`0x${string}`} address */
export async function getAccountEthBalance(address) {
	const client = getInsightsClient();
	return await client.getBalance({ address });
}

/**
 * Native ETH held by the TodoEscrow contract (all users’ locks combined).
 * Helps explain why “Balance” on your address stays ~flat after lock: funds moved to this contract.
 *
 * @returns {Promise<bigint | null>} wei, or null if `VITE_ESCROW_CONTRACT` / RPC is missing
 */
export async function getEscrowContractEthBalance() {
	const escrowAddr = getEscrowAddress();
	if (!escrowAddr || !escrowAddr.startsWith('0x')) return null;
	try {
		const client = getInsightsClient();
		return await client.getBalance({ address: /** @type {`0x${string}`} */ (escrowAddr) });
	} catch (e) {
		console.warn('getEscrowContractEthBalance failed:', e);
		return null;
	}
}

/**
 * Escrow `release` pays the beneficiary via an internal ETH transfer; the outer tx `to` is often the
 * smart account / EntryPoint / TodoEscrow — not the beneficiary. We surface those payouts by scanning
 * `EscrowReleased` logs where `beneficiary` matches this address.
 *
 * @param {import('viem').PublicClient} client
 * @param {`0x${string}`} escrowAddress
 * @param {`0x${string}`} beneficiaryAddress
 * @param {bigint} fromBlock
 * @param {bigint} toBlock
 */
async function getEscrowReleaseRowsForBeneficiary(
	client,
	escrowAddress,
	beneficiaryAddress,
	fromBlock,
	toBlock
) {
	/** @type {AccountTxRow[]} */
	const rows = [];
	const logs = await client.getLogs({
		address: escrowAddress,
		event: escrowReleasedEvent,
		args: { beneficiary: beneficiaryAddress },
		fromBlock,
		toBlock
	});

	const blockTs = new Map();
	for (const log of logs) {
		const decoded = decodeEventLog({
			abi: [escrowReleasedEvent],
			data: log.data,
			topics: log.topics
		});
		if (decoded.eventName !== 'EscrowReleased') continue;

		const bn = log.blockNumber;
		let timestamp = blockTs.get(bn);
		if (timestamp === undefined) {
			const block = await client.getBlock({ blockNumber: bn });
			timestamp = Number(block.timestamp);
			blockTs.set(bn, timestamp);
		}

		const token = decoded.args.token;
		const grossAmount = decoded.args.grossAmount;
		const feeAmount = decoded.args.feeAmount;
		const netAmount = decoded.args.netAmount;
		const isEth = !token || token.toLowerCase() === zeroAddress.toLowerCase();

		/** @type {AccountTxRow} */
		const row = {
			hash: log.transactionHash,
			blockNumber: bn,
			timestamp,
			from: escrowAddress,
			to: beneficiaryAddress,
			value: isEth ? netAmount : 0n,
			direction: isEth ? 'incoming (escrow ETH)' : 'incoming (escrow token)'
		};
		if (isEth) {
			row.escrowGrossWei = grossAmount;
			row.escrowFeeWei = feeAmount;
		}
		rows.push(row);
	}

	return rows;
}

function sortTxRowsDescending(a, b) {
	const ba = BigInt(a.blockNumber ?? 0);
	const bb = BigInt(b.blockNumber ?? 0);
	if (ba > bb) return -1;
	if (ba < bb) return 1;
	const ha = String(a.hash);
	const hb = String(b.hash);
	return ha > hb ? -1 : ha < hb ? 1 : 0;
}

/** @param {`0x${string}`} address */
export async function getRecentAccountTransactions(
	address,
	{ blockLookback = DEFAULT_LOOKBACK_BLOCKS, limit = DEFAULT_TX_LIMIT } = {}
) {
	const client = getInsightsClient();
	const latestBlockNumber = await client.getBlockNumber();
	const lookback = clampBlockLookback(blockLookback);
	const normalizedAddress = address.toLowerCase();
	/** @type {AccountTxRow[]} */
	const topLevel = [];

	for (
		let blockNumber = latestBlockNumber;
		blockNumber >= 0n && blockNumber >= latestBlockNumber - lookback;
		blockNumber -= 1n
	) {
		const block = await client.getBlock({
			blockNumber,
			includeTransactions: true
		});

		for (const transaction of block.transactions) {
			const from = transaction.from?.toLowerCase?.();
			const to = transaction.to?.toLowerCase?.();
			if (from !== normalizedAddress && to !== normalizedAddress) continue;

			topLevel.push({
				hash: transaction.hash,
				blockNumber: transaction.blockNumber ?? block.number,
				timestamp: Number(block.timestamp),
				from: transaction.from,
				to: transaction.to,
				value: transaction.value,
				direction:
					from === normalizedAddress && to === normalizedAddress
						? 'self'
						: from === normalizedAddress
							? 'outgoing'
							: 'incoming'
			});

			if (topLevel.length >= limit) {
				break;
			}
		}

		if (topLevel.length >= limit) {
			break;
		}
	}

	/** @type {AccountTxRow[]} */
	let escrowRows = [];
	const escrowAddr = getEscrowAddress();
	if (escrowAddr && escrowAddr.startsWith('0x')) {
		const fromBlock = latestBlockNumber > lookback ? latestBlockNumber - lookback : 0n;
		try {
			escrowRows = await getEscrowReleaseRowsForBeneficiary(
				client,
				/** @type {`0x${string}`} */ (escrowAddr),
				/** @type {`0x${string}`} */ (address),
				fromBlock,
				latestBlockNumber
			);
		} catch (e) {
			console.warn('Escrow log scan for wallet insights failed:', e);
		}
	}

	const matches = [...topLevel, ...escrowRows];
	matches.sort(sortTxRowsDescending);
	const escrowKeySet = new Set(escrowRows.map((r) => `${r.hash}:${r.direction}`));
	const seen = new Set();
	/** @type {AccountTxRow[]} */
	const merged = [];

	// Prefer EscrowReleased-derived rows: they share a tx hash with outer AA txs but a distinct
	// `direction`, and can lose same-block tie-breaks against six unrelated top-level rows.
	for (const row of matches) {
		const key = `${row.hash}:${row.direction}`;
		if (seen.has(key)) continue;
		if (!escrowKeySet.has(key)) continue;
		seen.add(key);
		merged.push(row);
		if (merged.length >= limit) break;
	}
	for (const row of matches) {
		const key = `${row.hash}:${row.direction}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(row);
		if (merged.length >= limit) break;
	}

	return merged;
}

/** @param {`0x${string}`} address */
export async function fundLocalAnvilSmartAccount(address, amountEth = '2') {
	const chain = getAppChain();
	if (chain.id !== 31337) {
		throw new Error('Local funding helper is only available on chain 31337');
	}

	const rpcUrl = getRpcUrl();
	if (!rpcUrl) throw new Error('VITE_RPC_URL is not configured');

	const publicClient = createPublicClient({
		chain,
		transport: insightsHttpTransport(rpcUrl)
	});

	const funderPrivateKey = getLocalDevFunderPrivateKey();
	if (!funderPrivateKey) {
		throw new Error('VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY is not configured');
	}

	const funder = privateKeyToAccount(/** @type {`0x${string}`} */ (funderPrivateKey));
	const walletClient = createWalletClient({
		account: funder,
		chain,
		transport: insightsHttpTransport(rpcUrl)
	});

	const hash = await walletClient.sendTransaction({
		to: address,
		value: parseEther(String(amountEth))
	});

	const receipt = await publicClient.waitForTransactionReceipt({ hash });
	return { hash, receipt };
}
