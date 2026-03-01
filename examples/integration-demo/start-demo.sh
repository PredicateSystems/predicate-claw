#!/bin/bash
#
# SecureClaw Integration Demo
#
# Shows the actual SDK integration with OpenClaw using createSecureClawPlugin().
# Builds predicate-claw from source since it's not published to npm yet.
#
# Usage:
#   ./start-demo.sh              # Run the demo
#   ./start-demo.sh --slow       # Slower typing for recording
#   ./start-demo.sh --rebuild    # Force rebuild containers
#

set -e

cd "$(dirname "$0")"

# Parse arguments
BUILD_OPTS=""
TYPING_SPEED="${DEMO_TYPING_SPEED:-30}"

for arg in "$@"; do
  case $arg in
    --rebuild)
      BUILD_OPTS="--build --no-cache"
      ;;
    --slow)
      TYPING_SPEED=80
      ;;
  esac
done

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║             SecureClaw Integration Demo                        ║"
echo "║  Real SDK Integration with OpenClaw                            ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  This demo uses createSecureClawPlugin() from predicate-claw   ║"
echo "║  to intercept tool calls and enforce policy.                   ║"
echo "║                                                                 ║"
echo "║  Note: Building SDK from source (not published to npm yet)     ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Build and run
echo "Building containers (includes building predicate-claw from source)..."
docker compose build $BUILD_OPTS

echo ""
echo "Starting demo..."
echo ""

DEMO_TYPING_SPEED=$TYPING_SPEED docker compose up --abort-on-container-exit

echo ""
echo "Demo finished. Run 'docker compose down' to clean up."
