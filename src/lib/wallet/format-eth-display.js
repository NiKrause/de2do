import { formatUnits } from 'viem';

/** @param {unknown} wei */
function toBigIntWei(wei) {
	if (wei == null) return 0n;
	if (typeof wei === 'bigint') return wei;
	if (typeof wei === 'number' && Number.isFinite(wei)) return BigInt(Math.trunc(wei));
	if (typeof wei === 'string' && /^-?\d+$/.test(wei.trim())) return BigInt(wei.trim());
	try {
		return BigInt(/** @type {any} */ (wei));
	} catch {
		return 0n;
	}
}

/**
 * Format wei as ETH with exactly 18 fractional digits (full wei resolution in the UI).
 *
 * @param {bigint | null | undefined | string | number} wei
 * @returns {string}
 */
export function formatEtherFullDecimals(wei) {
	const w = toBigIntWei(wei);
	const s = formatUnits(w, 18);
	const parts = s.split('.');
	const intPart = parts[0] || '0';
	let frac = parts[1] || '';
	if (frac.length > 18) {
		frac = frac.slice(0, 18);
	}
	frac = frac.padEnd(18, '0');
	return `${intPart}.${frac}`;
}

/**
 * Format a JS number ETH amount (e.g. from todo estimatedCosts) with exactly 18 fractional digits.
 *
 * @param {number} eth
 * @returns {string}
 */
export function formatEthNumberFullDecimals(eth) {
	if (!Number.isFinite(eth)) return String(eth);
	return eth.toFixed(18);
}
