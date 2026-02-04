FROM node:22-alpine

# Relay lives here
WORKDIR /app/relay

# Copy relay-specific dependency files
COPY relay/package.json relay/package-lock.json ./

# Install only production deps
RUN npm ci --omit=dev

# Copy the actual relay source
COPY relay .

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
