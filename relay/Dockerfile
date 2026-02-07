FROM node:22-bookworm-slim AS build

ARG TARGETARCH
ARG TARGETPLATFORM

# Relay lives here
WORKDIR /app/relay

# Build deps for native modules (e.g., node-datachannel)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 make g++ cmake pkg-config libssl-dev git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy relay-specific dependency files
COPY relay/package.json relay/package-lock.json ./

# Install only production deps (force correct platform/arch)
RUN if [ "$TARGETARCH" = "amd64" ]; then ARCH=x64; else ARCH="$TARGETARCH"; fi \
  && npm install --omit=dev --platform=linux --arch="$ARCH"

# Copy the actual relay source
COPY relay .

FROM node:22-bookworm-slim AS runtime

WORKDIR /app/relay

# Copy built app + node_modules from build stage
COPY --from=build /app/relay /app/relay

# Persistent data directory (matches docker-compose)
RUN mkdir -p /app/data

# Expose relay ports
# 4001: WebSocket
# 4002: TCP
# 4003: WebRTC 
# 4006: WebRTC Direct
# 3000: HTTP API
EXPOSE 4001 4002 4003 4006 3000

ENV NODE_ENV=production

# Start relay correctly
CMD ["node", "relay-enhanced.js"]
