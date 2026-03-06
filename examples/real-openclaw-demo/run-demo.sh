#!/bin/bash
# Real Predicate Authority Demo
#
# This script demonstrates REAL authorization calls to the Predicate Authority sidecar.
# Tool execution is simulated, but authorization decisions are REAL.
#
# No LLM API credits required - focuses on demonstrating the authorization flow.

set -e

cd "$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Real Predicate Authority Demo with SecureClaw SDK          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}This demo makes REAL authorization calls to the Predicate Authority sidecar.${NC}"
echo -e "${YELLOW}Tool execution is simulated, but authorization decisions are REAL.${NC}"
echo ""

# Build and start services
echo -e "${YELLOW}Building and starting services...${NC}"
docker compose build
docker compose up -d sidecar

# Wait for sidecar to be healthy
echo -e "${YELLOW}Waiting for Predicate Authority sidecar to be healthy...${NC}"
for i in {1..30}; do
    if docker compose exec -T sidecar curl -sf http://localhost:8787/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Sidecar is healthy${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}✗ Sidecar failed to start${NC}"
        docker compose logs sidecar
        exit 1
    fi
    sleep 1
done

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Running 16 authorization scenarios...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo ""

# Run the demo agent
docker compose run --rm demo-agent

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Demo Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""

# Cleanup
echo -e "${YELLOW}Stopping services...${NC}"
docker compose down

echo -e "${GREEN}Done!${NC}"
