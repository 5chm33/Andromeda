# ─── Andromeda v6.37 — Dockerfile ────────────────────────────────────────────
#
# Multi-stage build:
#   Stage 1 (builder): Install deps, build TypeScript + Vite frontend
#   Stage 2 (runner):  Minimal production image with only dist/ and node_modules
#
# Usage:
#   docker build -t andromeda:latest .
#   docker run -p 3000:3000 --env-file .env.local andromeda:latest
#
# Or with docker-compose:
#   docker-compose up
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /app

# Copy dependency manifests first (layer cache optimization)
COPY package.json pnpm-lock.yaml* ./

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build TypeScript server + Vite frontend
RUN pnpm run build

# ── Stage 2: Runner ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Install pnpm (needed for production start)
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# Create non-root user for security
RUN addgroup --system --gid 1001 andromeda && \
    adduser --system --uid 1001 --ingroup andromeda andromeda

WORKDIR /app

# Copy built artifacts from builder stage
COPY --from=builder --chown=andromeda:andromeda /app/dist ./dist
COPY --from=builder --chown=andromeda:andromeda /app/package.json ./package.json
COPY --from=builder --chown=andromeda:andromeda /app/pnpm-lock.yaml* ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Create data directory for persistent storage (episodic memory, eval baseline, RSI state)
RUN mkdir -p /app/data && chown andromeda:andromeda /app/data

# Create workspace directory for file operations
RUN mkdir -p /app/workspace && chown andromeda:andromeda /app/workspace

# Switch to non-root user
USER andromeda

# Expose the default port
EXPOSE 3000

# Health check — uses the /health endpoint added in v6.04
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Environment defaults (override with --env-file or -e flags)
ENV NODE_ENV=production \
    PORT=3000

# Start the production server
CMD ["node", "dist/index.js"]
