#!/bin/bash
#
# Run the AI Agent Playground Demo
#
# This script demonstrates:
# 1. Pre-Execution Authorization via Predicate Sidecar
# 2. Post-Execution Verification via Predicate Runtime
#
# Usage:
#   ./run-playground.sh          # Run the market research agent
#   ./run-playground.sh --shell  # Start interactive shell
#   ./run-playground.sh --build  # Force rebuild containers
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
SHELL_MODE=false
FORCE_BUILD=false

for arg in "$@"; do
  case $arg in
    --shell)
      SHELL_MODE=true
      shift
      ;;
    --build)
      FORCE_BUILD=true
      shift
      ;;
    --help|-h)
      echo "Usage: ./run-playground.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --shell   Start interactive shell instead of running agent"
      echo "  --build   Force rebuild of Docker containers"
      echo "  --help    Show this help message"
      exit 0
      ;;
  esac
done

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════════════════╗"
echo "║                                                                           ║"
echo "║          AI AGENT PLAYGROUND - Zero-Trust Demo                            ║"
echo "║                                                                           ║"
echo "║   Pre-Execution:  Predicate Sidecar (Policy Enforcement)                  ║"
echo "║   Post-Execution: Predicate Runtime (State Verification)                  ║"
echo "║   Browser:        PredicateBrowser (ML-Enhanced Snapshots)                ║"
echo "║                                                                           ║"
echo "╚═══════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Create data directory if it doesn't exist
mkdir -p data
mkdir -p workspace

# Initialize leads.csv with header if it doesn't exist
if [ ! -f data/leads.csv ]; then
  echo "rank,title,url,points,timestamp" > data/leads.csv
  echo -e "${GREEN}Created data/leads.csv with header${NC}"
fi

# Build containers if needed
if [ "$FORCE_BUILD" = true ]; then
  echo -e "${YELLOW}Building containers (forced rebuild)...${NC}"
  docker compose -f docker-compose.playground.yml build --no-cache
else
  echo -e "${YELLOW}Building containers (if needed)...${NC}"
  docker compose -f docker-compose.playground.yml build
fi

# Start the sidecar
echo -e "${YELLOW}Starting Predicate Sidecar...${NC}"
docker compose -f docker-compose.playground.yml up -d predicate-sidecar

# Wait for sidecar to be healthy
echo -e "${YELLOW}Waiting for sidecar health check...${NC}"
for i in {1..30}; do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}Sidecar is healthy!${NC}"
    break
  fi
  if [ $i -eq 30 ]; then
    echo -e "${RED}Sidecar failed to start${NC}"
    docker compose -f docker-compose.playground.yml logs predicate-sidecar
    exit 1
  fi
  sleep 1
done

# Run the agent or start shell
if [ "$SHELL_MODE" = true ]; then
  echo -e "${CYAN}Starting interactive shell...${NC}"
  echo -e "${YELLOW}Run the agent with: npx tsx /app/examples/real-openclaw-demo/src/market-research-agent.ts${NC}"
  echo ""
  docker compose -f docker-compose.playground.yml run --rm agent-runtime bash
else
  echo -e "${CYAN}Running Market Research Agent...${NC}"
  echo ""
  docker compose -f docker-compose.playground.yml run --rm agent-runtime
fi

# Cleanup
echo ""
echo -e "${YELLOW}Stopping containers...${NC}"
docker compose -f docker-compose.playground.yml down

echo ""
echo -e "${GREEN}Done! Check data/leads.csv for extracted leads.${NC}"
