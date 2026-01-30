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

# Security (Production)
API_PASSWORD=your_secure_password_here
RELAY_PRIV_KEY=your_hex_private_key_here

# Debugging
ENABLE_DATASTORE_DIAGNOSTICS=true
STRUCTURED_LOGS=true
```

## HTTP API Endpoints

The relay provides several HTTP API endpoints for monitoring and management:

- `GET /health` - Health check and system status
- `GET /multiaddrs` - Get relay multiaddresses for peer connection
- `GET /peers` - List connected peers
- `GET /metrics` - Prometheus metrics (public endpoint)
- `POST /test-pubsub` - Test pubsub messaging
- `GET /pinning/stats` - OrbitDB pinning statistics
- `GET /pinning/databases` - List pinned databases
- `POST /pinning/sync` - Manually sync a database
