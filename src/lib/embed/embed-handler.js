/**
 * Detect if the current URL is in embed mode
 * @param {string} hash - window.location.hash
 * @returns {boolean} True if in embed mode
 */
export function detectEmbedMode(hash) {
	return hash && hash.startsWith('#/embed/');
}

/**
 * Parse embed route parameters
 * @param {string} hash - window.location.hash
 * @returns {Object} Parsed embed parameters
 */
export function parseEmbedParams(hash) {
	if (!detectEmbedMode(hash)) {
		return null;
	}

	// Extract path after #/embed/
	const embedPath = hash.slice(8); // Remove '#/embed/'
	const [addressPart, queryString] = embedPath.split('?');

	// Parse query params
	const params = {};
	if (queryString) {
		const urlParams = new URLSearchParams(queryString);
		params.allowAdd = urlParams.get('allowAdd') === 'true';
	} else {
		params.allowAdd = false;
	}

	// Normalize address (ensure leading slash)
	const address = addressPart
		? addressPart.startsWith('/')
			? addressPart
			: `/${addressPart}`
		: null;

	return {
		address,
		allowAdd: params.allowAdd
	};
}

/**
 * Build an embed URL
 * @param {string} address - Database address
 * @param {Object} options - Options
 * @param {boolean} options.allowAdd - Whether to allow adding todos
 * @returns {string} Embed URL hash
 */
export function buildEmbedUrl(address, options = {}) {
	const { allowAdd = false } = options;

	// Normalize address
	const normalizedAddress = address.startsWith('/') ? address : `/${address}`;

	// Build query string
	const queryParams = [];
	if (allowAdd) {
		queryParams.push('allowAdd=true');
	}

	const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

	return `#/embed${normalizedAddress}${queryString}`;
}

/**
 * Check if current page is in embed mode
 * @returns {boolean} True if in embed mode
 */
export function isEmbedMode() {
	if (typeof window === 'undefined') {
		return false;
	}
	return detectEmbedMode(window.location.hash);
}

/**
 * Get current embed parameters
 * @returns {Object|null} Embed parameters or null if not in embed mode
 */
export function getCurrentEmbedParams() {
	if (typeof window === 'undefined') {
		return null;
	}
	return parseEmbedParams(window.location.hash);
}
