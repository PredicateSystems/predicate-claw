#!/bin/bash
# ============================================================================
# File Processor Demo - Run Script
# ============================================================================
#
# Demonstrates zero-trust file processing with /v1/execute endpoint.
#
# Usage:
#   ./run-demo.sh
#
# Environment variables:
#   ANTHROPIC_API_KEY  - Required for LLM processing (optional)
#   PREDICATE_API_KEY  - Cloud tracing key (optional)
#
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "══════════════════════════════════════════════════════════════════════"
echo "║ FILE PROCESSOR DEMO - Zero-Trust Execute Mode"
echo "══════════════════════════════════════════════════════════════════════"
echo -e "${NC}"

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

if ! command -v docker compose &> /dev/null && ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed${NC}"
    exit 1
fi

# Determine docker compose command
if command -v docker compose &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# Check environment
echo -e "${CYAN}Checking environment...${NC}"

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo -e "${YELLOW}Note: ANTHROPIC_API_KEY not set - LLM processing will be disabled${NC}"
else
    echo -e "${GREEN}✓ ANTHROPIC_API_KEY is set${NC}"
fi

# Ensure sample files exist
echo -e "${CYAN}Setting up sample data...${NC}"

mkdir -p workspace/input workspace/output workspace/archive

# Create sample input files if they don't exist
if [ ! -f workspace/input/sales_north.json ]; then
    echo -e "  Creating sample sales data..."

    cat > workspace/input/sales_north.json << 'EOF'
[
  {"id": "N001", "region": "North", "product": "Widget A", "amount": 15200, "date": "2024-01-15", "customer": "Acme Corp"},
  {"id": "N002", "region": "North", "product": "Widget B", "amount": 8900, "date": "2024-01-18", "customer": "TechStart Inc"},
  {"id": "N003", "region": "North", "product": "Widget A", "amount": 12500, "date": "2024-01-22", "customer": "Global Systems"},
  {"id": "N004", "region": "North", "product": "Widget C", "amount": 6300, "date": "2024-01-25", "customer": "DataFlow Ltd"},
  {"id": "N005", "region": "North", "product": "Widget B", "amount": 9800, "date": "2024-01-28", "customer": "CloudNine"}
]
EOF

    cat > workspace/input/sales_south.json << 'EOF'
[
  {"id": "S001", "region": "South", "product": "Widget B", "amount": 11200, "date": "2024-01-12", "customer": "SunTech"},
  {"id": "S002", "region": "South", "product": "Widget A", "amount": 7800, "date": "2024-01-16", "customer": "Coastal Systems"},
  {"id": "S003", "region": "South", "product": "Widget C", "amount": 14500, "date": "2024-01-20", "customer": "Harbor Inc"},
  {"id": "S004", "region": "South", "product": "Widget A", "amount": 5600, "date": "2024-01-24", "customer": "Bay Networks"}
]
EOF

    cat > workspace/input/sales_west.json << 'EOF'
[
  {"id": "W001", "region": "West", "product": "Widget C", "amount": 18900, "date": "2024-01-10", "customer": "Pacific Tech"},
  {"id": "W002", "region": "West", "product": "Widget A", "amount": 13200, "date": "2024-01-14", "customer": "Valley Ventures"},
  {"id": "W003", "region": "West", "product": "Widget B", "amount": 9500, "date": "2024-01-19", "customer": "Mountain Systems"},
  {"id": "W004", "region": "West", "product": "Widget C", "amount": 16800, "date": "2024-01-23", "customer": "Redwood Inc"},
  {"id": "W005", "region": "West", "product": "Widget A", "amount": 7200, "date": "2024-01-27", "customer": "Sequoia Labs"},
  {"id": "W006", "region": "West", "product": "Widget B", "amount": 11100, "date": "2024-01-30", "customer": "Sierra Solutions"}
]
EOF

    echo -e "${GREEN}✓ Created 3 sample input files${NC}"
else
    echo -e "${GREEN}✓ Sample data already exists${NC}"
fi

# Clean up any previous runs
echo -e "${CYAN}Cleaning up previous runs...${NC}"
rm -rf workspace/output/* workspace/archive/*
echo -e "${GREEN}✓ Cleared output and archive directories${NC}"

# Build and run
echo ""
echo -e "${CYAN}Building containers...${NC}"
$COMPOSE_CMD build

echo ""
echo -e "${CYAN}Starting sidecar...${NC}"
$COMPOSE_CMD up -d predicate-sidecar

# Wait for sidecar to be healthy
echo -e "  Waiting for sidecar to be ready..."
for i in {1..30}; do
    if curl -sf http://localhost:8787/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Sidecar is ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}Error: Sidecar failed to start${NC}"
        $COMPOSE_CMD logs predicate-sidecar
        exit 1
    fi
    sleep 1
done

echo ""
echo -e "${CYAN}Running file processor agent...${NC}"
echo ""

# Run the agent
$COMPOSE_CMD run --rm file-processor-agent

echo ""
echo -e "${CYAN}Results:${NC}"
echo ""

# Show output files
if [ -f workspace/output/aggregated_sales.json ]; then
    echo -e "${GREEN}Output file created:${NC}"
    echo "  workspace/output/aggregated_sales.json"
    echo ""
    echo "Contents:"
    cat workspace/output/aggregated_sales.json | head -30
    echo ""
fi

# Show archived files
if [ "$(ls -A workspace/archive 2>/dev/null)" ]; then
    echo -e "${GREEN}Archived files:${NC}"
    ls -la workspace/archive/
fi

echo ""
echo -e "${CYAN}Cleaning up...${NC}"
$COMPOSE_CMD down

echo ""
echo -e "${GREEN}Demo completed successfully!${NC}"
echo ""
echo -e "${CYAN}Key takeaways:${NC}"
echo "  1. Agent had zero direct filesystem access"
echo "  2. All file operations went through sidecar /v1/execute"
echo "  3. Unauthorized access (e.g., /etc/passwd) was blocked"
echo "  4. Every operation returned cryptographic evidence hash"
