import express from 'express';

// DoS Protection imports - install with: npm install express-rate-limit express-slow-down helmet
let rateLimit, slowDown, helmet;
try {
	rateLimit = (await import('express-rate-limit')).default;
	slowDown = (await import('express-slow-down')).default;
	helmet = (await import('helmet')).default;
	console.log('✅ DoS protection modules loaded');
} catch {
	console.warn(
		'⚠️ DoS protection modules not found. Install with: npm install express-rate-limit express-slow-down helmet'
	);
	console.warn('⚠️ Running without DoS protection!');
}

/**
 * Helper function to check if an address is public/routable
 */
function isPublicAddress(addr) {
	// Check for public IP ranges and DNS addresses
	if (addr.includes('/dns4/') || addr.includes('/dns6/')) {
		return true; // DNS addresses are likely public
	}

	// Extract IP from multiaddr
	const ipMatch = addr.match(/\/ip4\/(\d+\.\d+\.\d+\.\d+)\//) || addr.match(/\/ip6\/([^/]+)\//);

	if (!ipMatch) return false;

	const ip = ipMatch[1];

	// IPv4 private ranges
	if (ip.match(/^10\./)) return false; // 10.0.0.0/8
	if (ip.match(/^192\.168\./)) return false; // 192.168.0.0/16
	if (ip.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return false; // 172.16.0.0/12
	if (ip.match(/^127\./)) return false; // 127.0.0.0/8 (loopback)
	if (ip.match(/^169\.254\./)) return false; // 169.254.0.0/16 (link-local)

	// IPv6 private ranges
	if (ip.match(/^::1$/)) return false; // ::1 (loopback)
	if (ip.match(/^fe80:/)) return false; // fe80::/10 (link-local)
	if (ip.match(/^fc00:/)) return false; // fc00::/7 (unique local)
	if (ip.match(/^fd00:/)) return false; // fd00::/8 (unique local)

	return true; // Assume public if not in private ranges
}

/**
 * Helper function to prioritize addresses
 */
function prioritizeAddresses(addresses) {
	const publicAddrs = [];
	const privateAddrs = [];

	addresses.forEach((addr) => {
		if (isPublicAddress(addr)) {
			publicAddrs.push(addr);
		} else {
			privateAddrs.push(addr);
		}
	});

	// Return public addresses first, then private ones
	return [...publicAddrs, ...privateAddrs];
}

/**
 * Creates and configures the Express HTTP API server
 * @param {Object} server - The libp2p server instance
 * @param {Map} connectedPeers - Map of connected peers
 * @param {Object} peerStats - Peer statistics object
 * @param {Object} pinningService - The pinning service instance
 * @returns {Object} Express app instance
 */
export function createExpressServer(server, connectedPeers, peerStats, pinningService) {
	const app = express();

	// DoS Protection Middleware Configuration
	if (rateLimit && slowDown && helmet) {
		console.log('🛡️ Applying DoS protection middleware...');

		// General security headers
		app.use(
			helmet({
				crossOriginEmbedderPolicy: false // Allow cross-origin requests for P2P functionality
			})
		);

		// General rate limiting - 100 requests per 15 minutes per IP
		const generalLimiter = rateLimit({
			windowMs: 15 * 60 * 1000, // 15 minutes
			max: 100, // limit each IP to 100 requests per windowMs
			message: {
				error: 'Too many requests from this IP, please try again later.',
				retryAfter: '15 minutes'
			},
			standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
			legacyHeaders: false // Disable the `X-RateLimit-*` headers
		});

		// Strict rate limiting for test-pubsub endpoint - 10 requests per minute
		const pubsubLimiter = rateLimit({
			windowMs: 60 * 1000, // 1 minute
			max: 10, // limit each IP to 10 pubsub requests per minute
			message: {
				error: 'Too many pubsub test requests, please try again later.',
				retryAfter: '1 minute'
			}
		});

		// Slow down repeated requests to multiaddrs endpoint
		const multiaddrsSlowDown = slowDown({
			windowMs: 15 * 60 * 1000, // 15 minutes
			delayAfter: 5, // Allow 5 requests per 15 minutes at full speed
			delayMs: () => 500, // Add 500ms delay per request after delayAfter (v2 syntax)
			maxDelayMs: 5000 // Maximum delay of 5 seconds
		});

		// Apply general rate limiting to all routes
		app.use(generalLimiter);

		// Apply specific limiters to specific routes
		app.use('/test-pubsub', pubsubLimiter);
		app.use('/multiaddrs', multiaddrsSlowDown);

		console.log('✅ DoS protection middleware applied');
	} else {
		console.warn('⚠️ DoS protection middleware not available - install packages for protection');
	}

	// Enhanced CORS configuration
	app.use((req, res, next) => {
		res.header('Access-Control-Allow-Origin', '*');
		res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
		res.header(
			'Access-Control-Allow-Headers',
			'Origin, X-Requested-With, Content-Type, Accept, Authorization'
		);
		next();
	});

	// API Password Middleware
	const apiPassword = process.env.API_PASSWORD;

	// Middleware to protect routes with API password (except /metrics and /health)
	function protectWithPassword(req, res, next) {
		// Skip authentication for /metrics and /health endpoints
		if (req.path === '/metrics' || req.path === '/health') {
			return next();
		}

		// Skip authentication if no password is configured
		if (!apiPassword) {
			console.warn('⚠️ API_PASSWORD not configured - endpoints are unprotected!');
			return next();
		}

		const authHeader = req.headers.authorization;
		const expectedAuth = `Bearer ${apiPassword}`;

		if (!authHeader || authHeader !== expectedAuth) {
			console.log(`🚫 Unauthorized API access attempt to ${req.method} ${req.path} from ${req.ip}`);
			return res.status(401).json({
				error: 'Unauthorized',
				message:
					'Invalid or missing API password. Include Authorization: Bearer <password> header.',
				timestamp: new Date().toISOString()
			});
		}

		console.log(`🔐 Authenticated API access to ${req.method} ${req.path} from ${req.ip}`);
		next();
	}

	// Apply password protection to all routes
	app.use(protectWithPassword);

	// Log API password status
	if (apiPassword) {
		console.log('🔐 API password protection enabled (except /metrics)');
	} else {
		console.warn('⚠️ API password protection disabled - configure API_PASSWORD in .env');
	}

	app.use(express.json());

	// Enhanced multiaddrs endpoint with address prioritization and refresh
	app.get('/multiaddrs', async (req, res) => {
		try {
			// Force refresh of multiaddresses to get latest public IPs
			console.log('🔄 Refreshing multiaddresses for API request...');

			// Get current multiaddresses
			const allMultiaddrs = server.getMultiaddrs().map((ma) => ma.toString());

			// Categorize by transport
			const webrtcAddrs = allMultiaddrs.filter((ma) => ma.includes('webrtc'));
			const tcpAddrs = allMultiaddrs.filter((ma) => ma.includes('/tcp/') && !ma.includes('/ws'));
			const wsAddrs = allMultiaddrs.filter((ma) => ma.includes('/ws'));

			// Prioritize public addresses for each transport
			const prioritizedWebrtc = prioritizeAddresses(webrtcAddrs);
			const prioritizedTcp = prioritizeAddresses(tcpAddrs);
			const prioritizedWs = prioritizeAddresses(wsAddrs);
			const prioritizedAll = prioritizeAddresses(allMultiaddrs);

			// For client compatibility, also provide "best" addresses
			const bestWebrtc = prioritizedWebrtc[0] || null;
			const bestWs = prioritizedWs[0] || null;
			const bestTcp = prioritizedTcp[0] || null;

			console.log('📊 Multiaddrs served:', {
				total: allMultiaddrs.length,
				webrtc: webrtcAddrs.length,
				websocket: wsAddrs.length,
				tcp: tcpAddrs.length,
				publicWebrtc: prioritizedWebrtc.filter((addr) => isPublicAddress(addr)).length,
				publicWs: prioritizedWs.filter((addr) => isPublicAddress(addr)).length
			});

			res.json({
				peerId: server.peerId.toString(),
				all: prioritizedAll,
				byTransport: {
					webrtc: prioritizedWebrtc,
					tcp: prioritizedTcp,
					websocket: prioritizedWs
				},
				// Best addresses for easy client access
				best: {
					webrtc: bestWebrtc,
					websocket: bestWs,
					tcp: bestTcp
				},
				// Address quality info
				addressInfo: {
					totalAddresses: allMultiaddrs.length,
					publicAddresses: prioritizedAll.filter((addr) => isPublicAddress(addr)).length,
					privateAddresses: prioritizedAll.filter((addr) => !isPublicAddress(addr)).length
				},
				timestamp: new Date().toISOString()
			});
		} catch (error) {
			console.error('❌ Error in /multiaddrs endpoint:', error);
			res.status(500).json({
				error: 'Failed to get multiaddresses',
				message: error.message,
				timestamp: new Date().toISOString()
			});
		}
	});

	// Enhanced health check with system information
	// Health endpoint should be public for monitoring and e2e tests
	app.get('/health', (req, res) => {
		const connections = server.getConnections();
		const uptime = process.uptime();

		res.json({
			status: 'ok',
			peerId: server.peerId.toString(),
			uptime: Math.round(uptime),
			connections: {
				active: connections.length,
				peak: peerStats.peakConnections,
				total: peerStats.totalConnections
			},
			transports: peerStats.connectionsByTransport,
			multiaddrs: server.getMultiaddrs().length,
			timestamp: new Date().toISOString()
		});
	});

	// Enhanced peers endpoint with detailed statistics
	app.get('/peers', (req, res) => {
		const peers = Array.from(connectedPeers.values()).map((peer) => ({
			peerId: peer.peerIdShort,
			transport: peer.transport,
			connectedAt: peer.connectedAt,
			connectionCount: peer.connectionCount,
			duration: Math.round((Date.now() - new Date(peer.connectedAt).getTime()) / 1000) + 's'
		}));

		res.json({
			totalConnected: connectedPeers.size,
			peakConnections: peerStats.peakConnections,
			totalConnectionsEver: peerStats.totalConnections,
			transportStats: peerStats.connectionsByTransport,
			peers,
			timestamp: new Date().toISOString()
		});
	});

	// Enhanced metrics endpoint (Prometheus-compatible if enabled)
	app.get('/metrics', (req, res) => {
		if (server.metrics) {
			res.set('Content-Type', 'text/plain');
			res.send(server.metrics.toString());
		} else {
			res.json({ error: 'Metrics not enabled' });
		}
	});

	// Test pubsub endpoint
	app.post('/test-pubsub', express.json(), async (req, res) => {
		const testMsg =
			req.body?.msg ||
			JSON.stringify({
				peerId: 'test-peer',
				dbAddress: 'test-address',
				timestamp: new Date().toISOString()
			});

		try {
			await server.services.pubsub.publish(
				'orbitdb-address',
				Buffer.from(typeof testMsg === 'string' ? testMsg : JSON.stringify(testMsg))
			);
			res.json({ success: true, sent: testMsg });
			console.log('[relay] Sent test pubsub message:', testMsg);
		} catch (e) {
			// Check if it's a PublishError - this is not fatal, just means no peers are subscribed
			const isPublishErr =
				e &&
				((e.message && e.message.includes('PublishError.NoPeersSubscribedToTopic')) ||
					(e.message && e.message.includes('NoPeersSubscribedToTopic')) ||
					e.name === 'PublishError');
			if (isPublishErr) {
				console.warn(
					'[relay] Gossipsub publish failed: No peers subscribed to topic (this is normal when no peers are connected)'
				);
				res.json({ success: false, warning: 'No peers subscribed to topic', sent: testMsg });
			} else {
				res.status(500).json({ success: false, error: e.message });
				console.error('[relay] Failed to send test pubsub message:', e);
			}
		}
	});

	// Pinning Service Routes (if pinningService is available)
	if (pinningService) {
		// Get pinning service statistics
		app.get('/pinning/stats', (req, res) => {
			try {
				const stats = pinningService.getDetailedStats();
				res.json({
					...stats,
					timestamp: new Date().toISOString()
				});
			} catch (error) {
				res.status(500).json({
					error: 'Failed to get pinning stats',
					message: error.message
				});
			}
		});

		// Get list of pinned databases
		app.get('/pinning/databases', (req, res) => {
			try {
				const databases = pinningService.getPinnedDatabases();
				res.json({
					databases,
					total: databases.length,
					timestamp: new Date().toISOString()
				});
			} catch (error) {
				res.status(500).json({
					error: 'Failed to get pinned databases',
					message: error.message
				});
			}
		});

		// Manually trigger sync for a specific database address
		app.post('/pinning/sync', express.json(), async (req, res) => {
			const { dbAddress } = req.body;

			if (!dbAddress) {
				return res.status(400).json({
					error: 'Database address is required',
					example: { dbAddress: '/orbitdb/bafyreid...' }
				});
			}

			try {
				const result = await pinningService.syncAndPinDatabase(dbAddress);
				res.json({
					success: true,
					dbAddress,
					result,
					timestamp: new Date().toISOString()
				});
			} catch (error) {
				res.status(500).json({
					success: false,
					error: 'Failed to sync database',
					message: error.message,
					dbAddress
				});
			}
		});

		console.log('📌 Pinning service routes added to HTTP API');
	} else {
		console.log('⚠️  Pinning service not available - skipping pinning routes');
	}

	return app;
}

/**
 * Starts the Express HTTP server
 * @param {Object} app - Express app instance
 * @param {number} httpPort - Port to listen on
 * @param {Object} server - libp2p server instance for logging
 */
export function startExpressServer(app, httpPort, server) {
	return new Promise((resolve, reject) => {
		const httpServer = app.listen(httpPort, (err) => {
			if (err) {
				reject(err);
				return;
			}

			const apiPassword = process.env.API_PASSWORD;

			console.log(`\n🌐 HTTP API Server:`);
			console.log(`  - Running on port: ${httpPort}`);
			console.log(
				`  - Authentication: ${apiPassword ? '🔐 Protected (except /metrics)' : '⚠️ Unprotected'}`
			);
			if (apiPassword) {
				console.log(`  - Auth Header: Authorization: Bearer ${apiPassword}`);
			}
			console.log(`  - Multiaddrs: http://localhost:${httpPort}/multiaddrs`);
			console.log(`  - Health check: http://localhost:${httpPort}/health`);
			console.log(`  - Connected peers: http://localhost:${httpPort}/peers`);
			console.log(`  - Metrics: http://localhost:${httpPort}/metrics (public)`);
			console.log(`  - Test pubsub: POST http://localhost:${httpPort}/test-pubsub`);
			console.log(`  - Pinning stats: http://localhost:${httpPort}/pinning/stats`);
			console.log(`  - Pinned databases: http://localhost:${httpPort}/pinning/databases`);
			console.log(`  - Manual sync: POST http://localhost:${httpPort}/pinning/sync`);

			console.log(`\n✨ Enhanced Relay Server Ready!`);
			console.log(`   Peer ID: ${server.peerId.toString()}`);
			console.log(`   Use --verbose flag for detailed logging`);
			console.log(`   Use STRUCTURED_LOGS=true for JSON logging`);

			resolve(httpServer);
		});
	});
}
