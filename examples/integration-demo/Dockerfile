# Integration Demo: OpenClaw + SecureClaw Plugin
#
# Demonstrates the actual predicate-claw SDK integration with OpenClaw.
# Shows createSecureClawPlugin() intercepting real tool calls.
#
# Since predicate-claw isn't published to npm yet, we build from source.
#
FROM node:22-slim AS builder

# Install git (needed for some npm dependencies)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Build the SDK from source
WORKDIR /sdk
COPY package.json tsconfig.json ./
COPY src ./src
# Install dependencies including tsx for the demo
RUN npm install && npm install tsx && npm run build

FROM node:22-slim

# Setup demo app in a structure that matches the local relative import
# demo.ts imports from "../../dist/src/index.js"
# So we need: /repo/examples/integration-demo/demo.ts -> /repo/dist/src/index.js
WORKDIR /repo

# Copy the built SDK from builder stage
# Note: Builder outputs flat to /sdk/dist/, but local build outputs to dist/src/
# We copy to dist/src/ to match the import path in demo.ts
COPY --from=builder /sdk/dist ./dist/src
COPY --from=builder /sdk/node_modules ./node_modules

# Create the demo directory structure
RUN mkdir -p examples/integration-demo

# Copy demo files
COPY examples/integration-demo/demo.ts ./examples/integration-demo/
COPY examples/integration-demo/policy.json ./examples/integration-demo/

WORKDIR /repo/examples/integration-demo

# Run the integration demo (--silent suppresses npm update notices)
CMD ["npx", "--silent", "tsx", "demo.ts"]
