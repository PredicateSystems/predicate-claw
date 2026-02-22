#!/bin/bash
#
# Predicate Authority Demo - Quick Start
#
# This script runs the full "Hack vs Fix" demo showing how
# Predicate Authority blocks prompt injection attacks.
#
# Usage: ./start-demo.sh
#

set -e

cd "$(dirname "$0")"

echo ""
echo "======================================"
echo "  Predicate Authority: Hack vs Fix"
echo "======================================"
echo ""
echo "Starting containerized demo..."
echo "  - Sidecar: Predicate Authority daemon"
echo "  - Demo: Interactive attack scenarios"
echo ""

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is required but not installed."
    echo "Install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check for Docker Compose
if ! docker compose version &> /dev/null; then
    echo "Error: Docker Compose is required but not available."
    echo "Docker Compose is included with Docker Desktop."
    exit 1
fi

# Run the demo
docker compose -f docker-compose.demo.yml up --build --abort-on-container-exit

# Cleanup
echo ""
echo "Cleaning up containers..."
docker compose -f docker-compose.demo.yml down

echo ""
echo "Done! To run again: ./start-demo.sh"
echo ""
