import { toHex } from 'viem';

export function deepHexlify(obj) {
	if (typeof obj === 'function') return undefined;
	if (obj == null || typeof obj === 'string' || typeof obj === 'boolean') return obj;
	if (typeof obj === 'bigint') return toHex(obj);
	if ((obj && obj._isBigNumber != null) || typeof obj !== 'object') {
		return toHex(obj).replace(/^0x0/, '0x');
	}
	if (Array.isArray(obj)) return obj.map((member) => deepHexlify(member));
	return Object.keys(obj).reduce((set, key) => {
		set[key] = deepHexlify(obj[key]);
		return set;
	}, {});
}
