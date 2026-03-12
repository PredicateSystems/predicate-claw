# ============================================================================
# File Processor Agent - Dockerfile
# ============================================================================
#
# Builds the file processor agent with zero filesystem privileges.
# All file operations go through the sidecar's /v1/execute endpoint.
#
# ============================================================================

FROM node:20-slim

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json tsconfig.json ./
COPY src ./src

# Install npm dependencies
RUN npm install

# Build TypeScript
RUN npm run build

# Create non-root user (agent runs with minimal privileges)
RUN useradd -m -s /bin/bash agent
USER agent

# Entry point
CMD ["node", "dist/file-processor-agent.js"]
