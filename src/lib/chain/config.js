import { baseSepolia, foundry, mainnet, polygon, sepolia } from 'viem/chains';

const ENV = {
	VITE_CHAIN_ID: import.meta.env.VITE_CHAIN_ID,
	VITE_RPC_URL: import.meta.env.VITE_RPC_URL,
	VITE_BUNDLER_URL: import.meta.env.VITE_BUNDLER_URL,
	VITE_BUNDLER_AUTH_HEADER: import.meta.env.VITE_BUNDLER_AUTH_HEADER,
	VITE_ESCROW_CONTRACT: import.meta.env.VITE_ESCROW_CONTRACT,
	VITE_USDT_ADDRESS: import.meta.env.VITE_USDT_ADDRESS,
	VITE_ENTRY_POINT_ADDRESS: import.meta.env.VITE_ENTRY_POINT_ADDRESS,
	VITE_IMPLEMENTATION_CONTRACT: import.meta.env.VITE_IMPLEMENTATION_CONTRACT,
	VITE_ENABLE_PAYMASTER: import.meta.env.VITE_ENABLE_PAYMASTER,
	VITE_PAYMASTER_URL: import.meta.env.VITE_PAYMASTER_URL,
	VITE_PAYMASTER_AUTH_HEADER: import.meta.env.VITE_PAYMASTER_AUTH_HEADER,
	VITE_PASSKEY_BOOTSTRAP_VIA_USEROP: import.meta.env.VITE_PASSKEY_BOOTSTRAP_VIA_USEROP,
	VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY: import.meta.env.VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY
};

function maybeProxyLocalDevUrl(value, proxyBasePath, defaultPort) {
	if (!value) return null;

	const normalized = String(value).trim();
	const isBrowserDev = import.meta.env.DEV && typeof window !== 'undefined';
	if (!isBrowserDev) return normalized;

	try {
		const url = new URL(normalized);
		const isLocalHost = ['127.0.0.1', 'localhost'].includes(url.hostname);
		if (!isLocalHost || url.port !== String(defaultPort)) return normalized;

		const proxiedPath = `${proxyBasePath}${url.pathname === '/' ? '' : url.pathname}${url.search}`;
		return proxiedPath || proxyBasePath;
	} catch {
		return normalized;
	}
}

export function getEnvValue(key) {
	const value = ENV[key] ?? import.meta?.env?.[key];
	return value && String(value).trim() ? String(value).trim() : null;
}

export function getChainId() {
	const value = getEnvValue('VITE_CHAIN_ID');
	if (!value) throw new Error('VITE_CHAIN_ID is not defined');
	return Number(value);
}

export function chainIdToChain(chainId) {
	switch (String(chainId)) {
		case '31337':
			return foundry;
		case '1':
			return mainnet;
		case '11155111':
			return sepolia;
		case '137':
			return polygon;
		case '84532':
			return baseSepolia;
		default:
			throw new Error(`Unsupported chain ID: ${chainId}`);
	}
}

export function getAppChain() {
	return chainIdToChain(getChainId());
}

export function getRpcUrl() {
	return getEnvValue('VITE_RPC_URL');
}

export function getBundlerUrl() {
	return maybeProxyLocalDevUrl(getEnvValue('VITE_BUNDLER_URL'), '/__bundler', 4337);
}

/**
 * Optional Authorization header value for hosted bundlers (e.g. Bearer token from the provider).
 * Exposed via VITE_* (client bundle) — use the provider dashboard domain allowlists.
 * @returns {import('viem').HttpTransportConfig | undefined}
 */
export function getBundlerHttpTransportConfig() {
	const authorization = getEnvValue('VITE_BUNDLER_AUTH_HEADER');
	if (!authorization) return undefined;
	return {
		fetchOptions: {
			headers: {
				Authorization: authorization
			}
		}
	};
}

/**
 * Same as bundler, for `pm_sponsorUserOperation` HTTP calls when paymaster is enabled.
 * @returns {string | undefined} Full Authorization header value
 */
export function getPaymasterAuthHeader() {
	return getEnvValue('VITE_PAYMASTER_AUTH_HEADER');
}

/**
 * When true, first passkey smart-account bootstrap uses `eth_sendUserOperation` with `eip7702Auth`
 * (needs a bundler that supports EIP-7702 UserOperations). Default off: bootstrap uses an EIP-7702
 * type-4 transaction via `VITE_RPC_URL` instead (works with Openfort and other strict bundlers).
 */
export function shouldUsePasskeyBootstrapViaUserOp() {
	const v = getEnvValue('VITE_PASSKEY_BOOTSTRAP_VIA_USEROP');
	return v === '1' || v?.toLowerCase() === 'true';
}

export function getEscrowAddress() {
	return getEnvValue('VITE_ESCROW_CONTRACT');
}

export function getUsdtAddress() {
	return getEnvValue('VITE_USDT_ADDRESS');
}

export function getEntryPointAddress() {
	return getEnvValue('VITE_ENTRY_POINT_ADDRESS');
}

export function getImplementationAddress() {
	return getEnvValue('VITE_IMPLEMENTATION_CONTRACT');
}

export function isPaymasterEnabled() {
	const value = getEnvValue('VITE_ENABLE_PAYMASTER');
	if (!value) return true;
	const normalized = value.toLowerCase();
	return !['false', '0', 'no', 'off'].includes(normalized);
}

export function getPaymasterUrl() {
	if (!isPaymasterEnabled()) return null;
	return maybeProxyLocalDevUrl(getEnvValue('VITE_PAYMASTER_URL'), '/__paymaster', 3002);
}

export function getLocalDevFunderPrivateKey() {
	return getEnvValue('VITE_LOCAL_DEV_FUNDER_PRIVATE_KEY');
}

/**
 * Block explorer URL for an address (Etherscan on Sepolia/mainnet, chain-specific when viem defines it).
 * @param {string | null | undefined} address
 * @returns {{ url: string, name: string } | null}
 */
export function getAddressExplorerLink(address) {
	if (!address || typeof address !== 'string') return null;
	const trimmed = address.trim();
	if (!trimmed.startsWith('0x') || trimmed.length < 42) return null;
	try {
		const chain = getAppChain();
		const explorer = chain.blockExplorers?.default;
		if (!explorer?.url) return null;
		const url = `${String(explorer.url).replace(/\/$/, '')}/address/${trimmed}`;
		return { url, name: explorer.name || 'Block explorer' };
	} catch {
		return null;
	}
}
