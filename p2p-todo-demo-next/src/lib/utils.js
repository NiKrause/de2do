/**
 * Format PeerId for display - shows first 5 characters for better readability
 * @param {string} peerId - Full peer ID string
 * @returns {string} Formatted peer ID
 */
export function formatPeerId(peerId) {
	if (!peerId || typeof peerId !== 'string') {
		return 'unknown';
	}
	// Show first 4 and last 4 characters for better readability
	// const start = peerId.slice(0, 4)
	const end = peerId.slice(-4);
	// return `${start}...${end}`
	return `${end}`;
}
