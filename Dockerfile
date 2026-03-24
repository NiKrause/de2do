# ---------- Build stage ----------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install -g npm@11.11.0 && npm ci

COPY . .

# Vite/SvelteKit env vars are baked in at build time.
ARG VITE_RELAY_BOOTSTRAP_ADDR_DEV
ARG VITE_RELAY_BOOTSTRAP_ADDR_PROD
ARG VITE_PUBSUB_TOPICS
ARG VITE_NODE_ENV
ENV VITE_RELAY_BOOTSTRAP_ADDR_DEV=$VITE_RELAY_BOOTSTRAP_ADDR_DEV
ENV VITE_RELAY_BOOTSTRAP_ADDR_PROD=$VITE_RELAY_BOOTSTRAP_ADDR_PROD
ENV VITE_PUBSUB_TOPICS=$VITE_PUBSUB_TOPICS
ENV VITE_NODE_ENV=$VITE_NODE_ENV

RUN npm run build


# ---------- Production stage ----------
FROM node:22-alpine AS production

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json ./

#DO NOT omit dev deps because vite preview is used
RUN npm install -g npm@11.11.0 && npm ci

# Copy built output from build stage
COPY --from=build /app/build ./build
COPY --from=build /app/static ./static

# Persistent data directory
RUN mkdir -p /app/data

EXPOSE 5173

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5173

# Serve the built app (unchanged behavior)
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
