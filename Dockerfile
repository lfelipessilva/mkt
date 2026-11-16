# ==============================================================================
# Multi-stage Dockerfile for Listo Marketing Ops Deployment
# Builds both Frontend (Vite + React) & Backend (Fastify + TypeScript)
# ==============================================================================

# Stage 1: Build Frontend
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend
FROM node:20-bookworm-slim AS backend-builder
WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./
RUN npm run build

# Stage 3: Production Runtime
FROM node:20-bookworm-slim AS runner
WORKDIR /app

# Install system dependencies (curl for healthchecks, fonts/glibc for Sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=4002

# Install production-only backend dependencies
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy compiled backend
COPY --from=backend-builder /app/backend/dist ./dist
COPY backend/migrations ./migrations

# Copy static assets & directories
COPY config /app/config

# Copy compiled frontend dist into /app/frontend/dist for Fastify static serving
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose port
EXPOSE 4002

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4002/health || exit 1

# Start server
CMD ["node", "dist/index.js"]
