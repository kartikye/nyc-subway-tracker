# Build stage for native dependencies
FROM node:20-alpine AS builder

# Install build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including better-sqlite3)
RUN npm ci --production

# Production stage
FROM node:20-alpine

# Install runtime dependencies only
RUN apk add --no-cache sqlite

WORKDIR /app

# Copy built node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY . .

# Create data directory for SQLite database
RUN mkdir -p /app/data && chmod 777 /app/data

# Expose port
EXPOSE 3000

# Set NODE_ENV to production
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/visited', (r) => {process.exit(r.statusCode === 401 ? 0 : 1)})"

# Start the application
CMD ["node", "server.js"]
