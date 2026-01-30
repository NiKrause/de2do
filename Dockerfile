# Use Node.js 22 Alpine for smaller image size
FROM node:22-alpine AS base

# Install pnpm globally
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Production stage
FROM node:22-alpine AS production

# Install pnpm globally
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy built application from build stage
COPY --from=base /app/build ./build
COPY --from=base /app/static ./static

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Expose port 5173
EXPOSE 5173

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173

# Start the application using preview mode (serves the built static files)
CMD ["pnpm", "run", "preview", "--host", "0.0.0.0", "--port", "5173"]