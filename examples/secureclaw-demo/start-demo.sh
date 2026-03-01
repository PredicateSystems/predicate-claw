#!/bin/bash
#
# SecureClaw Demo Launcher (Simple Mode - no dashboard)
#
# Usage:
#   ./start-demo.sh              # Run the demo (uses cached images)
#   ./start-demo.sh --rebuild    # Force rebuild containers
#   ./start-demo.sh --slow       # Slower typing for screen recording
#
# For split-pane demo with dashboard, use:
#   ./start-demo-split.sh
#
# First run downloads the sidecar binary (~30s). Subsequent runs are fast.
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
echo "║                    SecureClaw Demo                             ║"
echo "║  Policy-Enforced AI Agent Security                            ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  Tip: For split-pane with dashboard, use:                     ║"
echo "║       ./start-demo-split.sh                                   ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Build images if needed (uses cache, fast on subsequent runs)
echo "Building images (uses cache if available)..."
docker compose -f docker-compose.demo.yml --profile full build $BUILD_OPTS

echo ""
echo "Starting containers (sidecar + demo)..."
echo ""

# Run with docker compose (--profile full includes the sidecar)
DEMO_TYPING_SPEED=$TYPING_SPEED docker compose -f docker-compose.demo.yml --profile full up

echo ""
echo "Demo finished. Run 'docker compose -f docker-compose.demo.yml down' to clean up."
