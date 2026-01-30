/**
 * Browser stub for Node.js 'fs' module
 *
 * orbitdb-storacha-bridge imports fs but doesn't use it in browser code paths.
 * This stub provides empty implementations to prevent runtime errors.
 */

// Export empty implementations of common fs functions
export const readFileSync = () => {
	throw new Error('fs.readFileSync is not available in browser');
};

export const writeFileSync = () => {
	throw new Error('fs.writeFileSync is not available in browser');
};

export const existsSync = () => false;

export const mkdirSync = () => {
	throw new Error('fs.mkdirSync is not available in browser');
};

export const readdirSync = () => [];

export const statSync = () => {
	throw new Error('fs.statSync is not available in browser');
};

export const unlinkSync = () => {
	throw new Error('fs.unlinkSync is not available in browser');
};

export const rmdirSync = () => {
	throw new Error('fs.rmdirSync is not available in browser');
};

// Default export
export default {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	statSync,
	unlinkSync,
	rmdirSync
};
