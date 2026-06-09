# ─── Andromeda v9.16.3 — Dockerfile ─────────────────────────────────────────
#
# Multi-stage build:
#   Stage 1 (builder): Install deps, build TypeScript + Vite frontend
#   Stage 2 (runner):  Minimal production image with only dist/ and node_modules
#
# Fix history:
#   v9.16.3 — pnpm@11.3.0 → pnpm@10.15.1 (matches package.json engines field).
#             pnpm 11 changed lockfile handling causing exit code 254 in CI.
#             Added canvas native deps (cairo, pango, jpeg, giflib).
#             Two-step install: --ignore-scripts first, then pnpm rebuild to
#             compile native addons (better-sqlite3, canvas) cleanly.
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

# Install pnpm matching the engines field in package.json (^10.15.1)
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

# Native build tools: better-sqlite3 needs python3/make/g++; canvas needs cairo stack
RUN apk add --no-cache python3 make g++ cairo-dev pango-dev jpeg-dev giflib-dev

WORKDIR /app

# Copy dependency manifests first (layer cache optimization)
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./

# Two-step install: skip postinstall scripts first, then rebuild native addons.
# This prevents canvas/better-sqlite3 from failing mid-install.
RUN pnpm install --no-frozen-lockfile --ignore-scripts
RUN pnpm rebuild

# Copy source
COPY . .

# Build TypeScript server + Vite frontend
RUN pnpm run build

# ── Stage 2: Runner ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Install pnpm matching the engines field in package.json
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

# Runtime native deps: better-sqlite3 + canvas + git (for RSI patch apply)
RUN apk add --no-cache python3 make g++ git cairo-dev pango-dev jpeg-dev giflib-dev

# Create non-root user for security
RUN addgroup --system --gid 1001 andromeda && \
    adduser --system --uid 1001 --ingroup andromeda andromeda

WORKDIR /app

# Copy built artifacts from builder stage
COPY --from=builder --chown=andromeda:andromeda /app/dist ./dist
COPY --from=builder --chown=andromeda:andromeda /app/package.json ./package.json
COPY --from=builder --chown=andromeda:andromeda /app/pnpm-lock.yaml* ./
COPY --from=builder --chown=andromeda:andromeda /app/pnpm-workspace.yaml ./

# Install production dependencies only (two-step for native addons)
RUN pnpm install --no-frozen-lockfile --prod --ignore-scripts
RUN pnpm rebuild

# Create data directories for persistent storage (SQLite, episodic memory, eval baseline, RSI state)
RUN mkdir -p /app/data /app/.data && chown -R andromeda:andromeda /app/data /app/.data

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
CMD ["node", "dist/_core/index.js"]
