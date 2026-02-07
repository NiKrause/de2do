# Simple Todo P2P Relay - Quick Start Guide

## 🎯 What's Included

This project now includes a production-ready P2P relay server with the following components:

### ✅ Successfully Integrated

- **P2P Relay Server** (`relay/relay-enhanced.js`)
- **Service Architecture** (storage, pinning, express)
- **Docker Support** (Dockerfile + docker-compose.yml)
- **HTTP API** for monitoring (Prometheus) and management
- **OrbitDB Pinning Service** (without backup to Storacha)

### 📁 Directory Structure

```
simple-todo/
├── relay/
│   ├── relay-enhanced.js       # Main relay server
│   ├── package.json           # Clean dependencies (no Storacha)
│   ├── Dockerfile            # Container for relay
│   └── services/
│       ├── storage.js        # Persistent storage management
│       ├── pinning.js        # OrbitDB pinning (no Storacha)
│       └── express.js        # HTTP API endpoints
├── docker-compose.yml        # Full stack orchestration
├── Dockerfile               # SvelteKit app container
├── test-relay.js            # Integration test script
└── RELAY-QUICKSTART.md      # This guide
```

## 🚀 Quick Start Options

### Option 1: Docker Compose (Recommended)

```bash
# Run both app and relay together
docker-compose up --build

# Access the app: http://localhost:5173
# Access relay API: http://localhost:3000
```

**Data persistence (Docker)**  
The relay stores its datastore + blockstore on the host via Docker volumes. This keeps OrbitDB/IPFS data and the relay PeerId stable across restarts.

- Root compose (`docker-compose.yml`): `./data/relay` → `/app/data` (relay datastore at `/app/data/relay-datastore`)
- Relay-only compose (`relay/docker-compose.yml`): `./relay/relay-datastore` → `/app/relay-datastore`

If you want a fixed PeerId across restarts, set `RELAY_PRIV_KEY` in your `.env`.

`RELAY_PRIV_KEY` can be provided via environment (e.g., `.env` at repo root for root compose, or `relay/.env` for relay-only).  
If it is missing, the relay will generate one on first start and print a `RELAY_PRIV_KEY=...` line in the logs so you can copy it into your env file.

### Option 2: Manual Setup

```bash
# Terminal 1: Start the relay
cd relay
npm install
npm start

# Terminal 2: Start the app
npm run dev
```

### Option 3: Test Integration

```bash
# Run automated integration tests
./test-relay.js
```

## 🔧 Configuration

Key environment variables for the relay:

```bash
# Ports
RELAY_WS_PORT=4001          # WebSocket for browsers
RELAY_TCP_PORT=4002         # TCP for native libp2p
RELAY_WEBRTC_PORT=4003      # WebRTC connections
HTTP_PORT=3000              # API server

# Security (Production)
API_PASSWORD=your_password  # Protect API endpoints
RELAY_PRIV_KEY=your_key    # Fixed peer ID

# Storage
DATASTORE_PATH=./relay-datastore

# Debugging
STRUCTURED_LOGS=true
ENABLE_DATASTORE_DIAGNOSTICS=true
```

## 📡 HTTP API Endpoints

Access these at `http://localhost:3000`:

- `GET /health` - Server health and status
- `GET /multiaddrs` - Relay connection addresses
- `GET /peers` - Connected peer information
- `GET /metrics` - Prometheus metrics (public)
- `GET /pinning/stats` - OrbitDB pinning statistics
- `GET /pinning/databases` - List of pinned databases
- `POST /pinning/sync` - Manually sync database
- `POST /test-pubsub` - Test pubsub messaging

### Kept Essential Features

- ✅ P2P networking and relay functionality
- ✅ OrbitDB pinning and synchronization
- ✅ HTTP API for monitoring
- ✅ Multi-transport support (WebRTC, WebSocket, TCP)
- ✅ Production-ready configuration
- ✅ Docker containerization

## 🐛 Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 3000, 4001-4003, 4006 are available
2. **Node version**: Requires Node.js 22+
3. **Missing dependencies**: Run `npm install` in relay directory
4. **Docker issues**: Check `docker-compose config` for validation

### Testing Commands

```bash
# Syntax check
cd relay && node -c relay-enhanced.js

# Integration test
./test-relay.js

# Docker validation
docker-compose config

# API health check
curl http://localhost:3000/health
```

The relay serves as the backbone for your P2P todo application, enabling browsers to discover each other and maintain synchronized OrbitDB databases without requiring any external dependencies or complex setup procedures.
