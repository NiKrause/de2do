FROM node:22-alpine

WORKDIR /app

# Copy only relay-specific files first
COPY package.json ./
# Copy package-lock.json if it exists (optional for pnpm/yarn projects)
COPY package-lock.json* ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy the rest of the relay files
COPY . .

# Expose ports
# 4001: WebSocket
# 4002: TCP
# 4003: WebRTC 
# 4006: WebRTC Direct
# 3000: HTTP API
EXPOSE 4001 4002 4003 4006 3000

# Set default environment variables
ENV NODE_ENV=production

# Run the enhanced relay server
CMD ["node", "relay-enhanced.js"]