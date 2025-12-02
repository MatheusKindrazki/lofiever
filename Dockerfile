# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache libc6-compat

# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source files
COPY . .

# Build-time environment variables (dummy values for build)
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
ENV REDIS_URL="redis://localhost:6379"
ENV AUTH_SECRET="build-time-secret"
ENV OPENAI_API_KEY="build-time-key"
ENV R2_ACCESS_KEY_ID=""
ENV R2_SECRET_ACCESS_KEY=""
ENV R2_ENDPOINT=""
ENV R2_BUCKET_NAME=""
ENV R2_PUBLIC_URL=""

# Build Next.js application
RUN npm run build

# Build custom server
RUN npm run build:server

# Build scripts for production
RUN npm run build:scripts

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install wget for healthcheck
RUN apk add --no-cache wget

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Install production dependencies only
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --only=production && \
    npx prisma generate && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/i18n ./i18n
COPY --from=builder /app/messages ./messages

# Set correct permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the custom server
CMD ["node", "dist/server.js"]
