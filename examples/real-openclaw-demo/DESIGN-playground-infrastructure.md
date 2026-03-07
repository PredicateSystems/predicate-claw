# AI Agent Playground Infrastructure Design

## Overview

This document describes the containerized demonstration playground for AI agents using the OpenClaw framework with Predicate Authority sidecar for pre-execution authorization.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Docker Compose Network                          │
│                           (playground-net)                              │
│                                                                         │
│  ┌─────────────────────────────────┐    ┌─────────────────────────────┐ │
│  │       agent-runtime             │    │    predicate-sidecar        │ │
│  │                                 │    │                             │ │
│  │  Ubuntu 24.04 LTS               │    │  Ubuntu 24.04 LTS           │ │
│  │  ├── Node.js 22.x               │    │  ├── predicate-authorityd   │ │
│  │  ├── Playwright + Browsers      │───▶│  │   (Rust binary)          │ │
│  │  ├── @predicatesystems/runtime  │    │  └── Port 8000              │ │
│  │  ├── Python 3.12 (optional)     │    │                             │ │
│  │  └── Non-root user: agentuser   │    │  Volume: ./policy.yaml      │ │
│  │                                 │    │                             │ │
│  │  Volumes:                       │    └─────────────────────────────┘ │
│  │  ├── ./data → /data (outputs)   │                                    │
│  │  └── ./workspace → /workspace   │                                    │
│  └─────────────────────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Container Specifications

### 1. agent-runtime Container

**Base Image:** Ubuntu 24.04 LTS

**Purpose:** Run OpenClaw agent with Playwright browser automation and SDK verification capabilities.

**Components:**
- **Node.js 22.x** - Runtime for TypeScript agent code
- **Playwright 1.40+** - Browser automation with Chromium, Firefox, WebKit
- **@predicatesystems/runtime** - Snapshot-based verification SDK
- **Python 3.12** (optional) - For webbench agents (planner_executor_agent.py)
- **Non-root user** - `agentuser` (UID 1000) for security

**System Dependencies for Playwright:**
```bash
# Required for Chromium
libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2
libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
libgbm1 libasound2 libpango-1.0-0 libcairo2

# Required for Firefox
libdbus-glib-1-2

# Required for WebKit
libwoff1 libharfbuzz-icu0 libgstreamer-plugins-base1.0-0
libgstreamer-gl1.0-0 libgstreamer-plugins-bad1.0-0 libenchant-2-2
libsecret-1-0 libhyphen0 libmanette-0.2-0 libgles2
```

**Environment Variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `PREDICATE_SIDECAR_URL` | `http://predicate-sidecar:8000` | Sidecar endpoint |
| `SECURECLAW_PRINCIPAL` | `agent:playground` | Agent identity |
| `SECURECLAW_VERBOSE` | `true` | Enable verbose logging |
| `PLAYWRIGHT_BROWSERS_PATH` | `/home/agentuser/.cache/ms-playwright` | Browser cache |

### 2. predicate-sidecar Container

**Base Image:** Ubuntu 24.04 LTS (for GLIBC 2.39 compatibility)

**Purpose:** Run Predicate Authority daemon for pre-execution authorization.

**Components:**
- **predicate-authorityd** - Rust-based execution proxy binary
- **Policy file** - YAML/JSON policy rules

**Port:** 8000 (configurable)

**Modes:**
- `local_only` - Local policy evaluation without control plane
- `hybrid` - Local + control plane sync

## Volume Mounts

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `./data` | `/data` | Agent output files (verification artifacts, screenshots) |
| `./workspace` | `/workspace` | Working directory for agent tasks |
| `./policy.yaml` | `/app/policy.yaml` | Sidecar authorization policy |

## Zero-Trust Policy Architecture

The sidecar implements a **Run Time Assurance (RTA)** execution proxy with default-deny posture.

### Policy Evaluation Flow

```
Agent Intent                    Sidecar Policy Engine
─────────────                   ─────────────────────
    │
    │  POST /v1/execute
    │  {
    │    "action": "fs.write",
    │    "resource": "/data/leads.csv",
    │    "principal": "agent:market-research"
    │  }
    │
    └─────────────────────────────────▶  ┌─────────────────────┐
                                         │ 1. DENY RULES       │
                                         │    - System files   │
                                         │    - Hidden files   │
                                         │    - Credentials    │
                                         └──────────┬──────────┘
                                                    │ No match
                                                    ▼
                                         ┌─────────────────────┐
                                         │ 2. ALLOW RULES      │
                                         │    - /data/leads.*  │ ◀── MATCH!
                                         └──────────┬──────────┘
                                                    │
                                                    ▼
                                         ┌─────────────────────┐
                                         │ 3. EXECUTE          │
                                         │    Write file       │
                                         │    Return result    │
                                         └─────────────────────┘
```

### Market Research Scenario Rules

| Rule | Effect | Action | Resources | Purpose |
|------|--------|--------|-----------|---------|
| `deny-system-files-read` | DENY | `fs.read` | `/etc/passwd`, `/proc/**`, `/root/**` | Block sensitive system files |
| `deny-hidden-files` | DENY | `fs.*` | `**/.*`, `**/.env`, `**/.ssh/**` | Block dotfiles and secrets |
| `deny-credential-files` | DENY | `fs.read` | `**/credentials*`, `**/*_rsa` | Block credential patterns |
| `deny-insecure-http` | DENY | `http.fetch` | `http://**` | Require HTTPS |
| `deny-internal-networks` | DENY | `http.fetch` | `https://localhost/**`, `https://10.*/**` | Block SSRF |
| `allow-google-sheets-api` | ALLOW | `http.fetch` | `https://sheets.googleapis.com/**` | Google Sheets integration |
| `allow-webhook-export` | ALLOW | `http.fetch` | `https://hooks.zapier.com/**` | Webhook data export |
| `allow-leads-csv-write` | ALLOW | `fs.write` | `/data/leads.csv` | Single output file |
| `allow-browser-launch` | ALLOW | `browser.launch` | `*` | Headless Playwright |
| `allow-browser-actions` | ALLOW | `browser.*` | `*` | Browser interactions |
| `default-deny-all` | DENY | `*` | `*` | Catch-all default deny |

## Network Configuration

- **Network Name:** `playground-net`
- **Driver:** bridge
- **DNS Resolution:** Container names resolve automatically
  - `predicate-sidecar` → sidecar container IP
  - `agent-runtime` → agent container IP

## Health Checks

### Sidecar Health Check
```yaml
healthcheck:
  test: ["CMD-SHELL", "curl -sf http://localhost:8000/health || exit 1"]
  interval: 2s
  timeout: 5s
  retries: 15
  start_period: 5s
```

### Agent Runtime Health Check
```yaml
healthcheck:
  test: ["CMD-SHELL", "node -e 'console.log(\"ok\")' || exit 1"]
  interval: 10s
  timeout: 5s
  retries: 3
```

## Security Considerations

1. **Non-root Execution**
   - Agent container runs as `agentuser` (UID 1000)
   - Prevents privilege escalation attacks
   - Required for `--dangerously-skip-permissions` in Claude Code

2. **Pre-execution Authorization**
   - All tool calls intercepted via PreToolUse hooks
   - Sidecar evaluates against policy before execution
   - Fail-closed mode blocks if sidecar unavailable

3. **Network Isolation**
   - Containers only accessible within playground-net
   - No direct host network access

4. **Volume Permissions**
   - `./data` and `./workspace` owned by agentuser
   - Read-only policy mount for sidecar

## Usage

### Quick Start

```bash
cd examples/real-openclaw-demo

# Create data directory
mkdir -p data workspace

# Start infrastructure
docker compose -f docker-compose.playground.yml up -d

# Run agent
docker compose -f docker-compose.playground.yml exec agent-runtime bash

# Inside container:
npx playwright test
# or
node examples/verification-demo.js
```

### Verify Sidecar

```bash
curl http://localhost:8000/health
# {"status":"ok"}

curl -X POST http://localhost:8000/authorize \
  -H "Content-Type: application/json" \
  -d '{"principal": "agent:playground", "action": "fs.read", "resource": "/workspace/test.txt"}'
```

## File Structure

```
real-openclaw-demo/
├── DESIGN-playground-infrastructure.md  # This document
├── Dockerfile.playground                 # Agent runtime container
├── Dockerfile.sidecar                    # Sidecar container (existing)
├── docker-compose.playground.yml         # Infrastructure orchestration
├── policy.yaml                           # Authorization policy (Zero-Trust)
├── run-playground.sh                     # Quick-start script
├── data/                                 # Agent output directory
│   └── leads.csv                         # Extracted HN leads
├── workspace/                            # Agent working directory
│   └── src/
├── src/
│   ├── market-research-agent.ts          # Main agent (Playwright + verification)
│   ├── predicate-sidecar-client.ts       # Pre-Execution Gate client
│   └── predicate-runtime.ts              # Post-Execution Verification SDK
└── secureclaw-hook.sh                    # PreToolUse hook (existing)
```

## Market Research Agent Demo

The `market-research-agent.ts` demonstrates both Pre-Execution and Post-Execution gates using `SentienceBrowser`:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MARKET RESEARCH AGENT FLOW                           │
│                    (Using SentienceBrowser SDK)                         │
│                                                                         │
│  Step 1: Launch Browser ──▶ PRE-EXEC GATE ──▶ SentienceBrowser.start() │
│                             (Sidecar check)   + Chrome Extension        │
│                                                                         │
│  Step 2: Navigate ─────────▶ PRE-EXEC GATE ──▶ SentienceBrowser.goto() │
│                             (URL allowed?)    + Extension ready wait    │
│                                                                         │
│  Step 3: Verify Page ──────▶ POST-EXEC GATE ─▶ verify_state()          │
│          (ML-enhanced)       ├─ url_contains("ycombinator")            │
│                              ├─ dom_contains("Show HN")                 │
│                              ├─ element_exists("titleline")             │
│                              └─ SentienceBrowser.snapshot()             │
│                                 (ML-enhanced compact prompts)           │
│                                                                         │
│  Step 4: Extract Data ─────▶ (DOM read after verification)             │
│                                                                         │
│  Step 5: Load CSV ─────────▶ PRE-EXEC GATE ──▶ fs.read /data/leads.csv │
│                                                                         │
│  Step 6: Save CSV ─────────▶ PRE-EXEC GATE ──▶ fs.write /data/leads.csv│
│          (Only this file!)                                              │
│                                                                         │
│  Step 7: Cleanup ──────────▶ SentienceBrowser.close()                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Running the Demo

```bash
cd examples/real-openclaw-demo

# Quick start (builds and runs everything)
./run-playground.sh

# Or step by step:
docker compose -f docker-compose.playground.yml up -d
docker compose -f docker-compose.playground.yml run --rm agent-runtime

# Interactive shell:
./run-playground.sh --shell
```

### What You'll See

1. **SentienceBrowser Launch** - Chrome extension loaded for ML-enhanced snapshots
2. **Pre-Execution Gates** - Every file/network operation shows ALLOWED or DENIED
3. **ML-Enhanced Snapshots** - Compact page perception via Chrome extension
4. **Post-Execution Verification** - Page state assertions before data extraction
5. **Policy Enforcement** - Attempts to write to `/etc/passwd` are BLOCKED

## Integration with SDK-TS

The agent-runtime container uses `SentienceBrowser` from `@predicatesystems/runtime` SDK:

```typescript
import {
  SentienceBrowser,
  urlContains,
  exists,
  allOf,
  AgentRuntime,
  type Snapshot,
} from "@predicatesystems/runtime";

// Launch SentienceBrowser with Chrome extension (ML-enhanced snapshots)
const browser = new SentienceBrowser(
  undefined, // apiKey - not needed for local demo
  undefined, // apiUrl
  true,      // headless mode (uses --headless=new for extension support)
);

await browser.start();
await browser.goto("https://example.com");

// Take ML-enhanced snapshot for compact LLM prompts
const snapshot: Snapshot = await browser.snapshot();
console.log(snapshot.text); // Compact, ML-processed page content

// Get Playwright page for DOM operations
const page = browser.getPage();

// Clean up
await browser.close();
```

### Key Features of SentienceBrowser

1. **Chrome Extension Integration** - Loads Sentience extension for ML-enhanced page perception
2. **Headless Mode with Extensions** - Uses `--headless=new` which supports Chrome extensions
3. **Anti-Detection** - Built-in stealth patches (webdriver hiding, plugins, etc.)
4. **Snapshot-Based Perception** - Produces compact LLM prompts from complex pages

## Integration with WebBench (Python)

For Python-based agents (planner_executor_agent.py):

```python
from webbench.agents import PlannerExecutorAgent
from predicate_authority import PredicateClient

# Connect to sidecar
client = PredicateClient(base_url="http://predicate-sidecar:8000")

# Authorize before action
result = await client.authorize(
    principal="agent:webbench",
    action="browser.click",
    resource="button#submit"
)
```

## Future Enhancements

1. **Browser Cache Volume** - Persist Playwright browsers across rebuilds
2. **Multi-agent Support** - Run multiple agent containers with different principals
3. **Tracing Integration** - Jaeger/OpenTelemetry for distributed tracing
4. **Control Plane Mode** - Connect to Predicate Vault for fleet management
