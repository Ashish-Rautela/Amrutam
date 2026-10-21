# Multi-stage production Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# Install build dependencies
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/

RUN npm ci

COPY src ./src
RUN npx prisma generate
RUN npm run build

# Production base stage
FROM node:20-alpine AS runner-base

WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma
COPY openapi ./openapi

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Worker stage
FROM runner-base AS worker
CMD ["node", "dist/worker/index.js"]

# API stage (default)
FROM runner-base AS api
EXPOSE 4000
CMD ["node", "dist/server.js"]
