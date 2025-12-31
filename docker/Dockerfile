# Build stage
FROM node:20-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ vips-dev

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including dev)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN pnpm build

# Prune dev dependencies
RUN pnpm prune --prod

# Production stage
FROM node:20-alpine AS production

# Install runtime dependencies for sharp
RUN apk add --no-cache vips-dev

# Security: Set environment
ENV NODE_ENV=production

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy package.json for version info
COPY package.json ./

# Copy migration files
COPY src/db/migrations ./src/db/migrations

# Create non-root user
RUN addgroup -g 1001 -S bridge && \
    adduser -u 1001 -S bridge -G bridge && \
    mkdir -p /app/data && \
    chown -R bridge:bridge /app

USER bridge

# Expose ports
# 9000 - Matrix appservice
# 8080 - ActivityPub server
EXPOSE 9000 8080

# Labels
LABEL org.opencontainers.image.title="Matrix-ActivityPub Bridge"
LABEL org.opencontainers.image.description="Bidirectional bridge between Matrix and the Fediverse"
LABEL org.opencontainers.image.vendor="Matrix-AP-Bridge"
LABEL maintainer="bridge@example.com"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
