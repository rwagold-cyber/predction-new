# PredictX Backend Services - Docker Image
FROM node:20-alpine

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./
COPY tsconfig.json ./

# Copy source code
COPY runner.ts ./
COPY relayer ./relayer
COPY matcher ./matcher
COPY api ./api
COPY market-manager ./market-manager
COPY utils ./utils

# Copy chain artifacts (for ABIs)
RUN mkdir -p /app/chain
COPY ../chain/artifacts /app/chain/artifacts
COPY ../chain/addresses.json /app/chain/addresses.json
COPY ../chain/test-markets.json /app/chain/test-markets.json 2>/dev/null || true

# Install dependencies
RUN pnpm install --frozen-lockfile

# Expose API port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

# Start the unified runner
CMD ["pnpm", "start"]
