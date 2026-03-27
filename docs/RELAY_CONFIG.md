# Relay Server Configuration

## Features

The relay server provides the following capabilities:

- **Circuit Relay v2** - Helps peers connect through NAT and firewalls
- **WebRTC Signaling** - Enables direct peer-to-peer connections
- **OrbitDB Pinning** - Automatically pins and syncs OrbitDB databases
- **HTTP API** - Management and monitoring endpoints
- **Multi-Transport Support** - WebSocket, TCP, WebRTC, and WebRTC Direct
- **Metrics & Monitoring** - Prometheus-compatible metrics and health checks
- **Production Ready** - DoS protection, rate limiting, and secure configuration

## 🏗️ Network Architecture

![Local-First P2P Network Architecture](docs/p2p-network-diagram.svg)

## Configuration

The relay server can be configured using environment variables:

```bash
# Port Configuration
RELAY_WS_PORT=4001          # WebSocket port for browsers
RELAY_TCP_PORT=4002          # TCP port for native libp2p nodes
RELAY_WEBRTC_PORT=4003       # WebRTC port
RELAY_WEBRTC_DIRECT_PORT=4006 # WebRTC Direct port
HTTP_PORT=3000               # HTTP API port

# Storage
DATASTORE_PATH=./relay-datastore

# Networking
PUBSUB_TOPICS=todo._peer-discovery._p2p._pubsub

# Circuit relay v2 (orbitdb-relay-pinner ≥0.4.0; see node_modules/orbitdb-relay-pinner/.env.example)
# RELAY_CIRCUIT_HOP_TIMEOUT_MS=300000
# RELAY_CIRCUIT_MAX_RESERVATIONS=10000
# RELAY_CIRCUIT_RESERVATION_TTL_MS=72000000
# RELAY_CIRCUIT_DEFAULT_DATA_LIMIT_BYTES=10737418240
# RELAY_CIRCUIT_DEFAULT_DURATION_LIMIT_MS=1200000

# Security (Production)
API_PASSWORD=your_secure_password_here
RELAY_PRIV_KEY=your_hex_private_key_here

# Debugging
ENABLE_DATASTORE_DIAGNOSTICS=true
STRUCTURED_LOGS=true
```

## HTTP API Endpoints

The relay provides several HTTP API endpoints for monitoring and management:

> **Package note:** The **`orbitdb-relay-pinner`** npm build used by this repo exposes **`GET /health`**, **`GET /multiaddrs`**, and **`GET /metrics`** on `HTTP_PORT` / `METRICS_PORT` (see `dist/services/metrics.js`). It does **not** mount **`/pinning/*`** or **`/peers`** on that HTTP server. OrbitDB pinning/sync still runs over **libp2p**; older or custom relay images may add the REST routes below.

- `GET /health` - Health check and system status
- `GET /multiaddrs` - Get relay multiaddresses for peer connection
- `GET /peers` - List connected peers _(not on npm metrics server)_
- `GET /metrics` - Prometheus metrics (public endpoint)
- `POST /test-pubsub` - Test pubsub messaging _(not on npm metrics server)_
- `GET /pinning/stats` - OrbitDB pinning statistics _(optional / fork-specific HTTP)_
- `GET /pinning/databases` - List pinned databases
- `POST /pinning/sync` - Manually sync a database
