# ============================================================================
# Kiro Operator Agent - Dockerfile
# ============================================================================
#
# Builds the Kiro operator agent that simulates the Amazon infrastructure
# deletion incident. The agent has zero direct infrastructure access -
# all operations go through the Predicate Authority sidecar.
#
# ============================================================================

FROM node:20-slim

WORKDIR /app

# Install dependencies (curl for health checks if needed)
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
CMD ["node", "dist/kiro_reenactment.js"]
