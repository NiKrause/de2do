import { Bytes, WebAuthnP256 } from 'ox';
import {
	concatHex,
	createClient,
	createPublicClient,
	createWalletClient,
	encodeAbiParameters,
	encodeFunctionData,
	http,
	keccak256,
	parseEther,
	toBytes,
	toHex
} from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import { generatePrivateKey, privateKeyToAccount, signAuthorization } from 'viem/accounts';
import { prepareAuthorization, prepareTransactionRequest, sendRawTransaction } from 'viem/actions';
import { accountABI } from './openfort/accountABI.js';
import { getStoredWebAuthnCredential } from '@le-space/orbitdb-ui';
import { getIdentityProfile, setIdentityProfile } from '../identity/profile.js';
import {
	getAppChain,
	getBundlerHttpTransportConfig,
	getBundlerUrl,
	getEntryPointAddress,
	getImplementationAddress,
	getPaymasterUrl,
	getRpcUrl,
	shouldUsePasskeyBootstrapViaUserOp
} from '../chain/config.js';
import { getWebAuthnMK } from './openfort/getKeyData.js';
import { toOpenfortSmartAccount } from './openfort/toOpenfortSmartAccount.js';
import { OPENFORT_INIT_DOMAIN } from './openfort/const.js';
import { WEB_AUTHN_STUB_SIGNATURE } from './openfort/stubSignatures.js';
import { deepHexlify } from './openfort/utils.js';
import { createPaymasterClient } from './paymaster-client.js';
import { beforePasskeyPrompt } from '../passkey-notice.js';

const STORAGE_KEY = 'passkey_wallet_credential';
const OWNER_KEY_STORAGE_KEY = 'passkey_wallet_owner_keys';
const DEFAULT_ANVIL_PRIVATE_KEY =
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OPENFORT_INIT_TYPEHASH = '0x82dc6262fca76342c646d126714aa4005dfcd866448478747905b2e7b9837183';

/** Session-only: same EOA across retries so users can fund it on Sepolia before direct EIP-7702 bootstrap. */
const PENDING_BOOTSTRAP_PK_SESSION_KEY = 'passkey_bootstrap_pending_private_key';

/** Rough floor for `initialize` + EIP-7702 type-4 gas on Sepolia (direct bootstrap, not UserOp). */
const DIRECT_EIP7702_BOOTSTRAP_MIN_BALANCE = parseEther('0.00002');

function takeOrCreateBootstrapPrivateKey() {
	if (typeof sessionStorage === 'undefined') {
		return generatePrivateKey();
	}
	const existing = sessionStorage.getItem(PENDING_BOOTSTRAP_PK_SESSION_KEY);
	if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) {
		return /** @type {import('viem/accounts').Hex} */ (existing);
	}
	const pk = generatePrivateKey();
	sessionStorage.setItem(PENDING_BOOTSTRAP_PK_SESSION_KEY, pk);
	return pk;
}

function clearPendingBootstrapPrivateKey() {
	try {
		sessionStorage?.removeItem(PENDING_BOOTSTRAP_PK_SESSION_KEY);
	} catch {
		/* ignore */
	}
}

/**
 * Anvil EIP-7702 type-4 self-delegated txs: RPC `eth_estimateGas` / `eth_fillTransaction` often returns
 * ~48k — far too low for `execute` → external `CALL` (e.g. TodoEscrow.lockEth). Passing `gas` alone is
 * not enough: viem's default `prepareTransactionRequest` includes `'gas'` in `parameters`, so fill /
 * estimate can overwrite it. We omit `gas` from prepare parameters, then force this limit before
 * `signTransaction`.
 */
const LOCAL_ANVIL_7702_TX_GAS = 1_500_000n;

/** @type {const} */
const LOCAL_7702_PREPARE_PARAMETERS = ['blobVersionedHashes', 'chainId', 'fees', 'nonce', 'type'];

/**
 * Prepare + sign + `eth_sendRawTransaction` with a forced gas floor (omit `gas` from prepare `parameters`
 * so RPC fill/estimate does not shrink EIP-7702 / complex txs to ~48k).
 *
 * @param {object} p
 * @param {import('viem/accounts').PrivateKeyAccount} p.signer
 * @param {import('viem/chains').Chain} p.chain
 * @param {string} p.rpcUrl
 * @param {import('viem').PublicClient} p.publicClient
 * @param {Record<string, unknown>} p.partial - `to`, `data`, optional `value`, optional `authorizationList`
 * @param {bigint} p.gasFloor
 */
async function signAndSendWithGasFloor({ signer, chain, rpcUrl, publicClient, partial, gasFloor }) {
	const walletClient = createWalletClient({
		account: signer,
		chain,
		transport: http(rpcUrl)
	});

	const prepared = await prepareTransactionRequest(walletClient, {
		account: signer,
		chain,
		...partial,
		gas: gasFloor,
		parameters: [...LOCAL_7702_PREPARE_PARAMETERS]
	});

	const withFixedGas = { ...prepared, gas: gasFloor };
	const serializedTransaction = await signer.signTransaction(withFixedGas);
	const hash = await sendRawTransaction(publicClient, { serializedTransaction });
	const receipt = await publicClient.waitForTransactionReceipt({ hash });
	return { hash, receipt };
}

/**
 * @param {object} p
 * @param {import('viem').SignedAuthorizationList} p.authorizationList
 * @param {import('viem').Hex} p.callData
 */
async function sendAnvil7702PreparedRawTx({
	signer,
	chain,
	rpcUrl,
	publicClient,
	authorizationList,
	callData
}) {
	return signAndSendWithGasFloor({
		signer,
		chain,
		rpcUrl,
		publicClient,
		partial: {
			to: signer.address,
			data: callData,
			authorizationList
		},
		gasFloor: LOCAL_ANVIL_7702_TX_GAS
	});
}

/**
 * Anvil 31337: `to: self` + delegated `execute` → external `CALL` often "succeeds" with ~48k gasUsed and no logs
 * (inner CALL not applied). Escrow flows use normal txs from the **same owner EOA** as the passkey smart-account
 * address (`encodeCalls` targets): `to` = TodoEscrow / ERC20, optional `value` for ETH lock.
 *
 * @param {object} p
 * @param {import('viem/accounts').PrivateKeyAccount} p.signer
 * @param {Array<{ to: import('viem').Address, value?: bigint, data?: import('viem').Hex }>} p.calls
 */
async function sendLocalAnvilDirectOwnerCalls({ signer, chain, rpcUrl, publicClient, calls }) {
	if (!calls?.length) {
		throw new Error('sendLocalAnvilDirectOwnerCalls: non-empty calls required');
	}
	const gasFloor = 900_000n;
	/** @type {import('viem').Hash | undefined} */
	let lastHash;
	/** @type {import('viem').TransactionReceipt | undefined} */
	let lastReceipt;
	for (const call of calls) {
		const step = await signAndSendWithGasFloor({
			signer,
			chain,
			rpcUrl,
			publicClient,
			partial: {
				to: call.to,
				data: call.data ?? '0x',
				value: call.value ?? 0n
			},
			gasFloor
		});
		lastHash = step.hash;
		lastReceipt = step.receipt;
		const st = lastReceipt.status;
		const ok = st === 'success' || st === 1n || st === 1 || st === '0x1' || st === true;
		if (!ok) {
			throw new Error(`Local direct owner tx failed: ${lastHash} status=${String(st)}`);
		}
	}
	if (!lastHash || !lastReceipt) {
		throw new Error('sendLocalAnvilDirectOwnerCalls: internal error (no receipt)');
	}
	return { hash: lastHash, receipt: lastReceipt };
}
const EIP712_DOMAIN_TYPEHASH = keccak256(
	toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
);

export function loadPasskeyWalletCredential() {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return null;
		return JSON.parse(stored);
	} catch (error) {
		console.warn('Failed to load passkey wallet credential:', error);
		return null;
	}
}

export function getPasskeyWalletCredentialSource() {
	const credential = loadPasskeyWalletCredential();
	if (!credential) return null;
	return credential.source || 'legacy';
}

export function hasPasskeyWalletCredential() {
	return Boolean(loadPasskeyWalletCredential());
}

export function storePasskeyWalletCredential(credential) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(credential));
	} catch (error) {
		console.warn('Failed to store passkey wallet credential:', error);
	}
}

function loadPasskeyWalletOwnerKeys() {
	try {
		const stored = localStorage.getItem(OWNER_KEY_STORAGE_KEY);
		return stored ? JSON.parse(stored) : {};
	} catch (error) {
		console.warn('Failed to load passkey wallet owner keys:', error);
		return {};
	}
}

function storePasskeyWalletOwnerKey(address, privateKey) {
	try {
		const existing = loadPasskeyWalletOwnerKeys();
		existing[address.toLowerCase()] = privateKey;
		localStorage.setItem(OWNER_KEY_STORAGE_KEY, JSON.stringify(existing));
	} catch (error) {
		console.warn('Failed to store passkey wallet owner key:', error);
	}
}

function getPasskeyWalletOwnerKey(address) {
	const stored = loadPasskeyWalletOwnerKeys();
	return stored[address.toLowerCase()] || null;
}

function bytesToHex(bytes) {
	return `0x${Array.from(bytes)
		.map((value) => value.toString(16).padStart(2, '0'))
		.join('')}`;
}

function hexToBytes(value) {
	const normalized = value.toLowerCase().replace(/^0x/, '');
	if (!normalized || normalized.length % 2 !== 0) return null;
	const out = new Uint8Array(normalized.length / 2);
	for (let i = 0; i < normalized.length; i += 2) {
		out[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
	}
	return out;
}

function toUint8Array(value) {
	if (!value) return null;
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value))
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (Array.isArray(value)) return Uint8Array.from(value);
	if (typeof value === 'string' && value.startsWith('0x')) return hexToBytes(value);
	return null;
}

function toBase64Url(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeCoordinate(value) {
	if (typeof value === 'bigint') return toHex(value, { size: 32 });
	if (typeof value === 'number') return toHex(BigInt(value), { size: 32 });
	if (typeof value === 'string') {
		if (value.startsWith('0x')) return toHex(BigInt(value), { size: 32 });
		if (/^\d+$/.test(value)) return toHex(BigInt(value), { size: 32 });
		return null;
	}
	const bytes = toUint8Array(value);
	if (bytes?.length === 32) return bytesToHex(bytes);
	return null;
}

function extractPublicKeyCoordinates(candidate) {
	if (!candidate || typeof candidate !== 'object') return null;

	const directX = normalizeCoordinate(candidate.x ?? candidate.publicKeyX);
	const directY = normalizeCoordinate(candidate.y ?? candidate.publicKeyY);
	if (directX && directY) return { x: directX, y: directY };

	const keyBytes = toUint8Array(candidate.publicKey ?? candidate.pubKey ?? candidate.key);
	if (keyBytes?.length === 65 && keyBytes[0] === 0x04) {
		return {
			x: bytesToHex(keyBytes.slice(1, 33)),
			y: bytesToHex(keyBytes.slice(33, 65))
		};
	}

	return null;
}

function extractCredentialId(candidate) {
	if (!candidate || typeof candidate !== 'object') return null;

	if (typeof candidate.id === 'string') return candidate.id;
	if (typeof candidate.credentialId === 'string') return candidate.credentialId;

	const rawId = toUint8Array(candidate.rawCredentialId ?? candidate.credentialId);
	if (rawId?.length) return toBase64Url(rawId);

	return null;
}

function toQuantityHex(value) {
	if (typeof value === 'bigint') return toHex(value);
	if (typeof value === 'number') return toHex(BigInt(value));
	if (typeof value === 'string' && value.startsWith('0x')) return value;
	return '0x0';
}

function normalizeEip7702Auth(authorization) {
	if (!authorization) return null;
	const yParity =
		authorization.yParity != null
			? toQuantityHex(authorization.yParity)
			: authorization.v != null
				? authorization.v === 27n || authorization.v === 27
					? '0x0'
					: '0x1'
				: '0x0';
	return {
		address: authorization.address,
		chainId: toQuantityHex(authorization.chainId),
		nonce: toQuantityHex(authorization.nonce),
		r: authorization.r,
		s: authorization.s,
		yParity
	};
}

function normalizeUserOperationForSend(userOperation, publicFeeEstimate) {
	const maxFeePerGas =
		userOperation.maxFeePerGas ??
		publicFeeEstimate.maxFeePerGas ??
		publicFeeEstimate.gasPrice ??
		1n;
	const maxPriorityFeePerGas =
		userOperation.maxPriorityFeePerGas ?? publicFeeEstimate.maxPriorityFeePerGas ?? 1n;

	const normalized = {
		...userOperation,
		initCode: userOperation.initCode ?? '0x',
		maxFeePerGas,
		maxPriorityFeePerGas,
		paymasterAndData: userOperation.paymasterAndData ?? '0x'
	};

	// Alto rejects these fields when no paymaster is attached.
	delete normalized.paymaster;
	delete normalized.paymasterData;
	delete normalized.paymasterVerificationGasLimit;
	delete normalized.paymasterPostOpGasLimit;

	return normalized;
}

function applyLocalDevGasBuffer(userOperation, chain) {
	if (chain?.id !== 31337) return userOperation;

	return {
		...userOperation,
		callGasLimit:
			userOperation.callGasLimit && userOperation.callGasLimit > 1_500_000n
				? userOperation.callGasLimit
				: 1_500_000n,
		verificationGasLimit:
			userOperation.verificationGasLimit && userOperation.verificationGasLimit > 2_000_000n
				? userOperation.verificationGasLimit
				: 2_000_000n,
		preVerificationGas:
			userOperation.preVerificationGas && userOperation.preVerificationGas > 350_000n
				? userOperation.preVerificationGas
				: 350_000n
	};
}

async function ensureLocalAnvilPrefund({ address, chain, publicClient, rpcUrl, paymasterUrl }) {
	if (paymasterUrl || chain?.id !== 31337) return;

	const balance = await publicClient.getBalance({ address });
	if (balance >= parseEther('0.05')) return;

	const funder = privateKeyToAccount(DEFAULT_ANVIL_PRIVATE_KEY);
	const walletClient = createWalletClient({
		account: funder,
		chain,
		transport: http(rpcUrl)
	});

	const hash = await walletClient.sendTransaction({
		to: address,
		value: parseEther('1')
	});

	await publicClient.waitForTransactionReceipt({ hash });
}

function resolveWalletCredential(address) {
	return (
		loadPasskeyWalletCredential() ||
		importWalletCredentialFromIdentityPasskey() ||
		createPasskeyWalletCredential(address)
	);
}

async function createOpenfortClients({
	signer,
	credential,
	publicClient,
	chain,
	bundlerUrl,
	entryPointAddress,
	paymasterUrl
}) {
	const account = await toOpenfortSmartAccount({
		owner: signer,
		client: publicClient,
		address: signer.address,
		entryPointAddress,
		credential
	});

	const paymaster = createPaymasterClient({ paymasterUrl, entryPointAddress });
	const bundlerHttpConfig = getBundlerHttpTransportConfig();
	const smartAccountClient = createBundlerClient({
		account,
		chain,
		transport: bundlerHttpConfig ? http(bundlerUrl, bundlerHttpConfig) : http(bundlerUrl),
		paymaster
	});

	return { account, paymaster, smartAccountClient };
}

async function buildSignedAuthorization({
	chain,
	rpcUrl,
	signerAddress,
	privateKey,
	implementationAddress
}) {
	const baseClient = createClient({
		chain,
		transport: http(rpcUrl)
	});

	const authorization = await prepareAuthorization(baseClient, {
		account: signerAddress,
		contractAddress: implementationAddress
	});

	return await signAuthorization({
		...authorization,
		privateKey
	});
}

async function buildInitializeCallData({ signer, credential, chainId, accountAddress }) {
	const keyData = await getWebAuthnMK(credential.x, credential.y);
	const initialGuardian = keccak256(toBytes(signer.address));
	const masterKeyData = encodeAbiParameters(
		[
			{ name: 'keyType', type: 'uint8' },
			{ name: 'validUntil', type: 'uint48' },
			{ name: 'validAfter', type: 'uint48' },
			{ name: 'limits', type: 'uint48' },
			{ name: 'key', type: 'bytes' },
			{ name: 'keyControl', type: 'uint8' }
		],
		[
			keyData.masterKeyData.keyType,
			keyData.masterKeyData.validUntil,
			keyData.masterKeyData.validAfter,
			keyData.masterKeyData.limits,
			keyData.masterKeyData.key,
			keyData.masterKeyData.keyControl
		]
	);
	const sessionKeyData = encodeAbiParameters(
		[
			{ name: 'keyType', type: 'uint8' },
			{ name: 'validUntil', type: 'uint48' },
			{ name: 'validAfter', type: 'uint48' },
			{ name: 'limits', type: 'uint48' },
			{ name: 'key', type: 'bytes' },
			{ name: 'keyControl', type: 'uint8' }
		],
		[
			keyData.sessionKeyData.keyType,
			keyData.sessionKeyData.validUntil,
			keyData.sessionKeyData.validAfter,
			keyData.sessionKeyData.limits,
			keyData.sessionKeyData.key,
			keyData.sessionKeyData.keyControl
		]
	);
	const domainSeparator = keccak256(
		encodeAbiParameters(
			[
				{ type: 'bytes32' },
				{ type: 'bytes32' },
				{ type: 'bytes32' },
				{ type: 'uint256' },
				{ type: 'address' }
			],
			[
				EIP712_DOMAIN_TYPEHASH,
				keccak256(toBytes(OPENFORT_INIT_DOMAIN.name)),
				keccak256(toBytes(OPENFORT_INIT_DOMAIN.version)),
				BigInt(chainId),
				accountAddress
			]
		)
	);

	const structHash = keccak256(
		encodeAbiParameters(
			[{ type: 'bytes32' }, { type: 'bytes' }, { type: 'bytes' }, { type: 'bytes32' }],
			[OPENFORT_INIT_TYPEHASH, masterKeyData, sessionKeyData, initialGuardian]
		)
	);

	const initDigest = keccak256(concatHex(['0x1901', domainSeparator, structHash]));
	const initSignature = await signer.sign({ hash: initDigest });

	const callData = encodeFunctionData({
		abi: accountABI,
		functionName: 'initialize',
		args: [keyData.masterKeyData, keyData.sessionKeyData, initSignature, initialGuardian]
	});

	return { callData };
}

async function prepareWebAuthnUserOperation({ smartAccountClient, calls, callData, paymaster }) {
	const userOperation = await smartAccountClient.prepareUserOperation({
		calls,
		callData,
		paymaster,
		signature: WEB_AUTHN_STUB_SIGNATURE
	});

	const signature = await smartAccountClient.account.signWithWebAuthn({ userOperation });
	return { ...userOperation, signature };
}

async function sendBundlerUserOperation({
	smartAccountClient,
	publicClient,
	chain,
	entryPointAddress,
	userOperation,
	signedAuthorization
}) {
	const bufferedOperation = applyLocalDevGasBuffer(userOperation, chain);
	const feeEstimate = await publicClient.estimateFeesPerGas();
	const sendUserOperation = normalizeUserOperationForSend(bufferedOperation, feeEstimate);
	const payload = signedAuthorization
		? { ...sendUserOperation, eip7702Auth: normalizeEip7702Auth(signedAuthorization) }
		: sendUserOperation;

	return await smartAccountClient.request({
		method: 'eth_sendUserOperation',
		params: [deepHexlify(payload), entryPointAddress]
	});
}

async function sendLocal7702BootstrapTransaction({
	signer,
	chain,
	rpcUrl,
	callData,
	signedAuthorization,
	publicClient
}) {
	return sendAnvil7702PreparedRawTx({
		signer,
		chain,
		rpcUrl,
		publicClient,
		authorizationList: [signedAuthorization],
		callData
	});
}

async function sendLocal7702DelegatedTransaction({
	signer,
	privateKey,
	chain,
	rpcUrl,
	callData,
	publicClient,
	implementationAddress
}) {
	const signedAuthorization = await buildSignedAuthorization({
		chain,
		rpcUrl,
		signerAddress: signer.address,
		privateKey,
		implementationAddress
	});

	const { hash, receipt } = await sendAnvil7702PreparedRawTx({
		signer,
		chain,
		rpcUrl,
		publicClient,
		authorizationList: [signedAuthorization],
		callData
	});
	return { hash, receipt, signedAuthorization };
}

export function importWalletCredentialFromIdentityPasskey() {
	try {
		const stored = getStoredWebAuthnCredential();
		const credentialInfo = stored?.credentialInfo;
		if (!credentialInfo) return null;

		const id = extractCredentialId(credentialInfo);
		const publicKey = extractPublicKeyCoordinates(credentialInfo);
		if (!id || !publicKey?.x || !publicKey?.y) return null;

		const credential = { id, x: publicKey.x, y: publicKey.y, source: 'identity' };
		storePasskeyWalletCredential(credential);
		return credential;
	} catch (error) {
		console.warn('Failed to import identity passkey for wallet credential:', error);
		return null;
	}
}

export async function consolidatePasskeyCredentials() {
	const walletCredential =
		loadPasskeyWalletCredential() || importWalletCredentialFromIdentityPasskey();
	if (!walletCredential) {
		return { walletCredential: null, source: null, profileUpdated: false };
	}

	let profileUpdated = false;
	try {
		const profile = (await getIdentityProfile()) || {};
		const nextProfile = {
			...profile,
			passkeyCredentialId: walletCredential.id,
			passkeyPublicKey: { x: walletCredential.x, y: walletCredential.y },
			passkeyCredentialSource: walletCredential.source || 'legacy'
		};
		await setIdentityProfile(nextProfile);
		profileUpdated = true;
	} catch (error) {
		console.warn('Failed to sync wallet passkey into identity profile:', error);
	}

	return {
		walletCredential,
		source: walletCredential.source || 'legacy',
		profileUpdated
	};
}

export async function createPasskeyWalletCredential(address) {
	if (!address) throw new Error('Wallet address is required to bind the passkey');

	await beforePasskeyPrompt(
		'Create wallet passkey',
		'Needed to create a dedicated passkey credential for wallet signing on this device.'
	);

	const credential = await WebAuthnP256.createCredential({
		authenticatorSelection: {
			requireResidentKey: false,
			residentKey: 'preferred',
			userVerification: 'required'
		},
		user: {
			id: Bytes.from(address),
			name: address
		}
	});

	const stored = {
		id: credential.raw.id,
		x: toHex(credential.publicKey.x, { size: 32 }),
		y: toHex(credential.publicKey.y, { size: 32 }),
		source: 'dedicated'
	};

	storePasskeyWalletCredential(stored);
	return stored;
}

export async function createPasskeySmartAccount() {
	const entryPointAddress = getEntryPointAddress();
	if (!entryPointAddress) throw new Error('VITE_ENTRY_POINT_ADDRESS is not configured');

	const bundlerUrl = getBundlerUrl();
	if (!bundlerUrl) throw new Error('VITE_BUNDLER_URL is not configured');

	const implementationAddress = getImplementationAddress();
	if (!implementationAddress) throw new Error('VITE_IMPLEMENTATION_CONTRACT is not configured');
	if (entryPointAddress.toLowerCase() === implementationAddress.toLowerCase()) {
		throw new Error(
			'VITE_IMPLEMENTATION_CONTRACT must be a deployed Openfort implementation and cannot equal VITE_ENTRY_POINT_ADDRESS.'
		);
	}

	const rpcUrl = getRpcUrl();
	if (!rpcUrl) throw new Error('VITE_RPC_URL is not configured');

	const chain = getAppChain();
	const publicClient = createPublicClient({
		chain,
		transport: http(rpcUrl)
	});

	const [entryPointCode, implementationCode] = await Promise.all([
		publicClient.getBytecode({ address: entryPointAddress }),
		publicClient.getBytecode({ address: implementationAddress })
	]);
	if (!entryPointCode || entryPointCode === '0x') {
		throw new Error(
			`EntryPoint is not deployed at ${entryPointAddress}. Deploy EntryPoint on this chain or update VITE_ENTRY_POINT_ADDRESS.`
		);
	}
	if (!implementationCode || implementationCode === '0x') {
		throw new Error(
			`Implementation contract is not deployed at ${implementationAddress}. Deploy it or update VITE_IMPLEMENTATION_CONTRACT.`
		);
	}

	const privateKey = takeOrCreateBootstrapPrivateKey();
	const signer = privateKeyToAccount(privateKey);

	// Before passkey: direct EIP-7702 bootstrap needs ETH on this EOA (bundler UserOp path can use paymaster).
	if (chain.id !== 31337 && !shouldUsePasskeyBootstrapViaUserOp()) {
		const balance = await publicClient.getBalance({ address: signer.address });
		if (balance < DIRECT_EIP7702_BOOTSTRAP_MIN_BALANCE) {
			throw new Error(
				`Fund ${signer.address} with Sepolia ETH (≥ ~0.00002 ETH) for gas, then create again. ` +
					'The address stays the same until you finish this step. ' +
					'Alternatively set VITE_PASSKEY_BOOTSTRAP_VIA_USEROP=1 only if your bundler supports EIP-7702 UserOperations.'
			);
		}
	}

	const paymasterUrl = getPaymasterUrl();
	const credential = await resolveWalletCredential(signer.address);
	const { account, paymaster, smartAccountClient } = await createOpenfortClients({
		signer,
		credential,
		publicClient,
		chain,
		bundlerUrl,
		entryPointAddress,
		paymasterUrl
	});

	await ensureLocalAnvilPrefund({
		address: signer.address,
		chain,
		publicClient,
		rpcUrl,
		paymasterUrl
	});

	const signedAuthorization = await buildSignedAuthorization({
		chain,
		rpcUrl,
		signerAddress: signer.address,
		privateKey,
		implementationAddress
	});

	const { callData } = await buildInitializeCallData({
		signer,
		credential,
		chainId: chain.id,
		accountAddress: signer.address
	});

	if (chain.id === 31337) {
		storePasskeyWalletOwnerKey(signer.address, privateKey);
		const { hash, receipt } = await sendLocal7702BootstrapTransaction({
			signer,
			chain,
			rpcUrl,
			callData,
			signedAuthorization,
			publicClient
		});

		clearPendingBootstrapPrivateKey();
		return {
			address: signer.address,
			credential,
			signedAuthorization,
			userOperationHash: hash,
			userOperation: null,
			receipt,
			smartAccountClient
		};
	}

	// Public networks: many bundlers (including Openfort) reject `eip7702Auth` on `eth_sendUserOperation`.
	// Default: same EIP-7702 type-4 + authorizationList bootstrap as Anvil, using `VITE_RPC_URL` only.
	if (!shouldUsePasskeyBootstrapViaUserOp()) {
		const { hash, receipt } = await sendLocal7702BootstrapTransaction({
			signer,
			chain,
			rpcUrl,
			callData,
			signedAuthorization,
			publicClient
		});

		clearPendingBootstrapPrivateKey();
		return {
			address: signer.address,
			credential,
			signedAuthorization,
			userOperationHash: hash,
			userOperation: null,
			receipt,
			smartAccountClient
		};
	}

	let userOperation;
	try {
		// Preferred path: estimate with authorization so sender simulation has delegated code.
		userOperation = await smartAccountClient.prepareUserOperation({
			callData,
			authorization: signedAuthorization,
			paymaster
		});
	} catch (error) {
		const message = String(error?.message || error || '');
		const unsupportedEstimate =
			message.includes("Unrecognized key(s) in object: 'eip7702Auth'") ||
			message.includes('Cannot decode zero data ("0x") with ABI parameters') ||
			message.includes('eth_estimateUserOperationGas');
		if (!unsupportedEstimate) {
			throw error;
		}
		console.warn(
			'Bundler gas estimation is incompatible with this local 7702 flow. Falling back to manual gas fields.'
		);
		const feeEstimate = await publicClient.estimateFeesPerGas();
		const maxFeePerGas = feeEstimate.maxFeePerGas ?? feeEstimate.gasPrice ?? 1n;
		const maxPriorityFeePerGas = feeEstimate.maxPriorityFeePerGas ?? 1n;
		userOperation = {
			sender: signer.address,
			nonce: await account.getNonce(),
			callData,
			callGasLimit: 1_500_000n,
			verificationGasLimit: 1_500_000n,
			preVerificationGas: 250_000n,
			maxFeePerGas,
			maxPriorityFeePerGas
		};
	}

	const userOpSig = await account.signUserOperation(userOperation);
	const wrappedSig = encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes' }], [0, userOpSig]);

	userOperation = { ...userOperation, signature: wrappedSig };
	if ('authorization' in userOperation) {
		// eslint-disable-next-line no-unused-vars
		const { authorization: _authorization, ...rest } = userOperation;
		userOperation = rest;
	}

	const userOperationHash = await sendBundlerUserOperation({
		smartAccountClient,
		publicClient,
		chain,
		entryPointAddress,
		userOperation,
		signedAuthorization
	});

	const receipt = await smartAccountClient.waitForUserOperationReceipt({
		hash: userOperationHash
	});

	clearPendingBootstrapPrivateKey();
	return {
		address: signer.address,
		credential,
		signedAuthorization,
		userOperationHash,
		userOperation,
		receipt,
		smartAccountClient
	};
}

export async function getPasskeySmartAccountClient(address) {
	const credential = loadPasskeyWalletCredential();
	if (!credential) throw new Error('No passkey wallet credential found');

	const entryPointAddress = getEntryPointAddress();
	if (!entryPointAddress) throw new Error('VITE_ENTRY_POINT_ADDRESS is not configured');

	const chain = getAppChain();
	const publicClient = createPublicClient({
		chain,
		transport: http(getRpcUrl() || undefined)
	});
	const ownerPrivateKey = chain.id === 31337 ? getPasskeyWalletOwnerKey(address) : null;
	const ownerSigner = ownerPrivateKey ? privateKeyToAccount(ownerPrivateKey) : undefined;

	const account = await toOpenfortSmartAccount({
		owner: ownerSigner,
		client: publicClient,
		address,
		entryPointAddress,
		credential
	});

	const bundlerUrl = getBundlerUrl();
	if (!bundlerUrl) throw new Error('VITE_BUNDLER_URL is not configured');

	const paymasterUrl = getPaymasterUrl();
	const paymaster = createPaymasterClient({ paymasterUrl, entryPointAddress });
	const bundlerHttpConfig = getBundlerHttpTransportConfig();

	return createBundlerClient({
		account,
		chain,
		transport: bundlerHttpConfig ? http(bundlerUrl, bundlerHttpConfig) : http(bundlerUrl),
		paymaster
	});
}

export async function sendPasskeyBundlerCall({
	smartAccountClient,
	publicClient,
	calls,
	callData
}) {
	const entryPointAddress = getEntryPointAddress();
	if (!entryPointAddress) throw new Error('VITE_ENTRY_POINT_ADDRESS is not configured');

	const implementationAddress = getImplementationAddress();
	if (!implementationAddress) throw new Error('VITE_IMPLEMENTATION_CONTRACT is not configured');
	const rpcUrl = getRpcUrl();
	if (!rpcUrl) throw new Error('VITE_RPC_URL is not configured');

	if (smartAccountClient.chain?.id === 31337) {
		const ownerPrivateKey = getPasskeyWalletOwnerKey(smartAccountClient.account.address);
		if (!ownerPrivateKey) {
			throw new Error(
				'Local owner key not found for smart account; recreate the smart account on Anvil.'
			);
		}
		const signer = privateKeyToAccount(ownerPrivateKey);
		if (signer.address.toLowerCase() !== smartAccountClient.account.address.toLowerCase()) {
			throw new Error('Local owner key does not match passkey smart-account address');
		}

		// Anvil: type-4 self-call + delegated `execute` → external `CALL` often completes with ~48k gasUsed and no logs.
		// Escrow (and similar) use normal txs from this same EOA to each target — same `msg.sender` as the 7702 account.
		if (calls?.length) {
			return await sendLocalAnvilDirectOwnerCalls({
				signer,
				chain: smartAccountClient.chain,
				rpcUrl,
				publicClient,
				calls
			});
		}

		const delegatedCallData =
			callData ?? (await smartAccountClient.account.encodeCalls(calls || []));
		return await sendLocal7702DelegatedTransaction({
			signer,
			privateKey: ownerPrivateKey,
			chain: smartAccountClient.chain,
			rpcUrl,
			callData: delegatedCallData,
			publicClient,
			implementationAddress
		});
	}

	const userOperation = await prepareWebAuthnUserOperation({
		smartAccountClient,
		calls,
		callData,
		paymaster: smartAccountClient.paymaster
	});

	const hash = await sendBundlerUserOperation({
		smartAccountClient,
		publicClient,
		chain: smartAccountClient.chain,
		entryPointAddress,
		userOperation
	});

	const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash });
	return { hash, receipt, userOperation };
}
