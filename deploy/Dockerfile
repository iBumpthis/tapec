# Stage 1: build native deps
FROM node:22-slim AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: runtime image (no build tools)
FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY app/ .

# config.json is bind-mounted at runtime — do not bake it in
# dbPath and metaRoot are set via environment variables

ENV NODE_ENV=production
EXPOSE 32410

CMD ["node", "server.js"]
