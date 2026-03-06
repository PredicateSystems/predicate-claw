# Real Predicate Authority Demo - Agent Container
#
# Demonstrates REAL sidecar authorization calls with the predicate-claw SDK.
# Tool execution is simulated, but authorization decisions are REAL.
#
# This demo doesn't require LLM API credits - it focuses on demonstrating
# the Predicate Authority sidecar authorization flow.

FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the entire SDK for building
COPY package*.json ./
COPY tsconfig.json ./
COPY src/ ./src/

# Install dependencies and build SDK
RUN npm install && npm run build

# Copy demo source files
COPY examples/real-openclaw-demo/src/ ./demo/

# Install demo dependencies and tsx for running TypeScript
WORKDIR /app/demo
RUN npm install && npm install -g tsx

WORKDIR /app

# Copy demo workspace files
COPY examples/real-openclaw-demo/workspace/ /workspace/

# Default command - run the demo scenarios
# Makes REAL authorization calls to Predicate Authority sidecar
CMD ["tsx", "demo/index.ts"]
