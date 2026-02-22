#!/bin/bash
#
# Predicate Authority Demo - Native Quick Start
#
# This script runs the full "Hack vs Fix" demo natively on your machine.
# Best for Apple Silicon Macs where Docker Linux emulation is slow.
#
# Usage: ./start-demo-native.sh
#

set -e

cd "$(dirname "$0")"
DEMO_DIR="$(pwd)"
REPO_ROOT="$(cd ../.. && pwd)"

echo ""
echo "======================================"
echo "  Predicate Authority: Hack vs Fix"
echo "======================================"
echo ""

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "Error: npm is required but not installed."
    exit 1
fi

# Install sidecar if not present
if ! command -v predicate-authorityd &> /dev/null; then
    echo "Installing Predicate Authority sidecar..."
    npm install -g @predicatesystems/authorityd
fi

# Check if sidecar binary exists after npm install
SIDECAR_BIN=$(npm root -g)/@predicatesystems/authorityd/bin/predicate-authorityd
if [ ! -f "$SIDECAR_BIN" ]; then
    echo "Downloading sidecar binary..."
    # Detect platform
    PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
        ARCH="arm64"
    else
        ARCH="x64"
    fi

    BINARY_URL="https://github.com/PredicateSystems/predicate-authority-sidecar/releases/latest/download/predicate-authorityd-${PLATFORM}-${ARCH}.tar.gz"

    echo "Downloading from: $BINARY_URL"
    mkdir -p /tmp/predicate-demo
    curl -fsSL -o /tmp/predicate-demo/sidecar.tar.gz "$BINARY_URL"
    tar -xzf /tmp/predicate-demo/sidecar.tar.gz -C /tmp/predicate-demo
    SIDECAR_BIN="/tmp/predicate-demo/predicate-authorityd"
    chmod +x "$SIDECAR_BIN"
fi

# Install demo dependencies
echo "Installing demo dependencies..."
cd "$REPO_ROOT"
npm install --silent 2>/dev/null || npm install

# Start sidecar in background
echo ""
echo "Starting Predicate Authority sidecar..."
"$SIDECAR_BIN" \
    --host 127.0.0.1 \
    --port 8787 \
    --mode local_only \
    --policy-file "$DEMO_DIR/policy.demo.json" \
    --log-level warn \
    run &
SIDECAR_PID=$!

# Wait for sidecar to be ready
echo "Waiting for sidecar to be ready..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:8787/health > /dev/null 2>&1; then
        echo "Sidecar is ready."
        break
    fi
    sleep 0.5
done

# Run demo
echo ""
echo "Running demo..."
echo ""

cd "$REPO_ROOT"
SIDECAR_URL=http://127.0.0.1:8787 npx tsx "$DEMO_DIR/demo.ts"

# Cleanup
echo ""
echo "Cleaning up..."
kill $SIDECAR_PID 2>/dev/null || true

echo ""
echo "Done! To run again: ./start-demo-native.sh"
echo ""
