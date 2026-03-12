# Zero-Trust File Processor Agent

A demonstration of **true zero-trust AI agent execution** using the sidecar's `/v1/execute` endpoint. Unlike authorize-only mode, the agent has **zero ambient filesystem privileges** - ALL file operations are executed by the sidecar.

## Architecture: Execute Mode vs Authorize-Only Mode

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    EXECUTE MODE (This Demo)                             │
│                                                                         │
│  ┌───────────────┐    ┌─────────────────────────────────────────────┐  │
│  │   Agent       │───▶│ Sidecar /v1/execute                         │  │
│  │  (No FS       │    │                                             │  │
│  │  Privileges)  │    │  1. Validate mandate                        │  │
│  │               │◀───│  2. Check resource matches authorized       │  │
│  │  Only sends   │    │  3. EXECUTE the operation                   │  │
│  │  intents      │    │  4. Return result with evidence hash        │  │
│  └───────────────┘    └─────────────────────────────────────────────┘  │
│                                                                         │
│  TRUST BOUNDARY: Agent cannot access filesystem directly               │
│  GUARANTEE: Sidecar ensures authorized resource = executed resource    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    AUTHORIZE-ONLY MODE (market-research-agent)          │
│                                                                         │
│  ┌───────────────┐    ┌─────────────────┐    ┌───────────────────────┐  │
│  │   Agent       │───▶│ /authorize      │    │ Local Execution       │  │
│  │  (Has FS      │    │ (policy check)  │    │ fs.writeFileSync()    │  │
│  │  Privileges)  │    └────────┬────────┘    └───────────┬───────────┘  │
│  │               │             │                         │              │
│  │               │      ALLOW/DENY              Agent executes         │
│  │               │             │               (must be trusted)       │
│  └───────────────┴─────────────┴─────────────────────────┘              │
│                                                                         │
│  TRUST BOUNDARY: Agent must be trusted to respect policy decisions     │
│  GAP: No proof agent executed only what was authorized                 │
└─────────────────────────────────────────────────────────────────────────┘
```

## What This Demo Does

The File Processor Agent demonstrates a realistic data pipeline:

1. **List input directory** - Find files to process
2. **Read each file** - Load JSON data
3. **Transform data** - Aggregate, filter, enrich (using LLM)
4. **Write output** - Save processed results
5. **Archive originals** - Move processed files to archive
6. **Generate report** - Create summary with shell command
7. **Attempt unauthorized access** - Demonstrate policy denial

### Demo Scenario: Sales Data Aggregator

```
/workspace/input/           →  Read JSON sales records
      │
      ▼
  [LLM Processing]          →  Aggregate by region, compute totals
      │
      ▼
/workspace/output/          →  Write aggregated results
      │
      ▼
/workspace/archive/         →  Archive processed files
      │
      ▼
/workspace/output/report.txt →  Shell: Generate summary report
```

## Quick Start

```bash
# 1. Set environment variables (choose ONE LLM provider)

# Option A: Anthropic Claude (recommended)
export ANTHROPIC_API_KEY="sk-ant-..."

# Option B: OpenAI
export OPENAI_API_KEY="sk-..."

# Option C: Local LLM (Ollama or LM Studio)
export LOCAL_LLM_BASE_URL="http://localhost:11434/v1"
export LOCAL_LLM_MODEL="llama3.2"

# Optional: Cloud tracing
export PREDICATE_API_KEY="sk_pro_..."

# 2. Run the demo
./run-demo.sh
```

## LLM Provider Support

The agent supports multiple LLM providers with automatic detection:

| Provider | Required Environment Variables | Notes |
|----------|-------------------------------|-------|
| **Anthropic** | `ANTHROPIC_API_KEY` | Default: claude-sonnet-4-20250514 |
| **OpenAI** | `OPENAI_API_KEY` | Default: gpt-4o |
| **Local (Ollama)** | `LOCAL_LLM_BASE_URL` | Default: http://localhost:11434/v1 |
| **Local (LM Studio)** | `LOCAL_LLM_BASE_URL` | Set to http://localhost:1234/v1 |

### Explicit Provider Selection

You can force a specific provider using `LLM_PROVIDER`:

```bash
# Force Anthropic even if OpenAI key is also set
export LLM_PROVIDER=anthropic

# Force local LLM
export LLM_PROVIDER=local
# or
export LLM_PROVIDER=ollama
```

### Running Without LLM

The agent works without an LLM - it will skip the AI-enhanced analysis and use simple aggregation only:

```bash
# No LLM keys set - agent still processes files
./run-demo.sh
```

## Running with Local LLM (Ollama)

For fully offline operation, you can run the demo with a local LLM using Ollama:

### Step 1: Install and Start Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama service
ollama serve
```

### Step 2: Pull a Model

```bash
# Recommended: Llama 3.2 (smaller, faster)
ollama pull llama3.2

# Alternative: Mistral (good for analysis tasks)
ollama pull mistral

# Alternative: Qwen 2.5 (multilingual)
ollama pull qwen2.5
```

### Step 3: Run the Demo

```bash
# Set local LLM configuration
export LOCAL_LLM_BASE_URL="http://host.docker.internal:11434/v1"
export LOCAL_LLM_MODEL="llama3.2"
export LLM_PROVIDER="local"

# Run the demo
./run-demo.sh
```

> **Note**: Use `host.docker.internal` instead of `localhost` because the agent runs inside Docker and needs to reach Ollama on the host machine.

### Using LM Studio Instead

If you prefer LM Studio:

```bash
# 1. Download and install LM Studio from https://lmstudio.ai
# 2. Download a model (e.g., Llama 3.2, Mistral)
# 3. Start the local server in LM Studio (default port 1234)

export LOCAL_LLM_BASE_URL="http://host.docker.internal:1234/v1"
export LOCAL_LLM_MODEL="local-model"  # LM Studio uses generic model name
export LLM_PROVIDER="local"

./run-demo.sh
```

### Troubleshooting Local LLM

| Issue | Solution |
|-------|----------|
| Connection refused | Ensure Ollama is running: `ollama serve` |
| Model not found | Pull the model first: `ollama pull llama3.2` |
| Slow responses | Use a smaller model or increase resources |
| Docker can't reach host | Use `host.docker.internal` (macOS/Windows) or `172.17.0.1` (Linux) |

## Sample Output

```
══════════════════════════════════════════════════════════════════════
║ FILE PROCESSOR AGENT - Zero-Trust Execute Mode Demo
══════════════════════════════════════════════════════════════════════

[Step 1] Listing input directory
┌──────────────────────────────────────────────────────────────┐
│ EXECUTE: fs.list                                              │
│ Resource: /workspace/input                                    │
│ Mode: /v1/execute (sidecar executes)                         │
└──────────────────────────────────────────────────────────────┘
  ✓ Found 3 files: sales_north.json, sales_south.json, sales_west.json

[Step 2] Reading input files
┌──────────────────────────────────────────────────────────────┐
│ EXECUTE: fs.read                                              │
│ Resource: /workspace/input/sales_north.json                   │
│ Mode: /v1/execute (sidecar executes)                         │
└──────────────────────────────────────────────────────────────┘
  ✓ Read 1,234 bytes (hash: a1b2c3...)

[Step 3] Processing with LLM
  → Aggregating sales by region...
  ✓ Computed: North=$45,230, South=$38,100, West=$52,890

[Step 4] Writing output
┌──────────────────────────────────────────────────────────────┐
│ EXECUTE: fs.write                                             │
│ Resource: /workspace/output/aggregated_sales.json             │
│ Mode: /v1/execute (sidecar executes)                         │
└──────────────────────────────────────────────────────────────┘
  ✓ Wrote 456 bytes (hash: d4e5f6...)

[Step 5] Archiving processed files
┌──────────────────────────────────────────────────────────────┐
│ EXECUTE: fs.write                                             │
│ Resource: /workspace/archive/sales_north.json                 │
│ Mode: /v1/execute (sidecar executes)                         │
└──────────────────────────────────────────────────────────────┘
  ✓ Archived 3 files

[Step 6] Generating report
┌──────────────────────────────────────────────────────────────┐
│ EXECUTE: cli.exec                                             │
│ Resource: wc -l /workspace/output/*.json                      │
│ Mode: /v1/execute (sidecar executes)                         │
└──────────────────────────────────────────────────────────────┘
  ✓ Report generated: 42 lines total

[Step 7] Attempting unauthorized access
┌──────────────────────────────────────────────────────────────┐
│ EXECUTE: fs.read                                              │
│ Resource: /etc/passwd                                         │
│ Mode: /v1/execute (sidecar executes)                         │
│                                                               │
│ ✗ DENIED: resource_mismatch                                  │
│   Mandate authorized: /workspace/input/*                      │
│   Requested resource: /etc/passwd                             │
└──────────────────────────────────────────────────────────────┘
  ✓ BLOCKED: Zero-trust enforcement working correctly

══════════════════════════════════════════════════════════════════════
║ AGENT COMPLETED - All operations executed via sidecar
══════════════════════════════════════════════════════════════════════
```

## Key Differences from Authorize-Only Demo

| Aspect | This Demo (Execute) | market-research (Authorize-Only) |
|--------|---------------------|----------------------------------|
| Endpoint | `/v1/execute` | `/authorize` |
| Who executes | Sidecar | Agent (local) |
| Agent FS access | None | Full |
| Resource verification | Cryptographic | Trust-based |
| Evidence hash | ✓ Returned by sidecar | Must compute locally |
| Confused deputy attack | Prevented | Possible |

## Policy Configuration

```yaml
rules:
  # Allow reading from input directory
  - name: allow-input-read
    effect: allow
    principals: ["agent:file-processor"]
    actions: ["fs.read", "fs.list"]
    resources: ["/workspace/input/*"]

  # Allow writing to output directory
  - name: allow-output-write
    effect: allow
    principals: ["agent:file-processor"]
    actions: ["fs.write"]
    resources: ["/workspace/output/*"]

  # Allow archiving (write to archive)
  - name: allow-archive-write
    effect: allow
    principals: ["agent:file-processor"]
    actions: ["fs.write"]
    resources: ["/workspace/archive/*"]

  # Allow safe shell commands
  - name: allow-safe-shell
    effect: allow
    principals: ["agent:file-processor"]
    actions: ["cli.exec"]
    resources:
      - "wc *"
      - "ls *"
      - "date"
      - "cat /workspace/output/*"

  # Default deny
  - name: default-deny
    effect: deny
    principals: ["*"]
    actions: ["*"]
    resources: ["*"]
```

## File Structure

```
file-processor-demo/
├── README.md                    # This file
├── run-demo.sh                  # Entry point
├── docker-compose.yml           # Container orchestration
├── Dockerfile                   # Agent container
├── policy.yaml                  # Authorization rules
├── src/
│   └── file-processor-agent.ts  # Main agent (uses /v1/execute)
└── workspace/
    ├── input/                   # Source files
    │   ├── sales_north.json
    │   ├── sales_south.json
    │   └── sales_west.json
    ├── output/                  # Processed results
    └── archive/                 # Archived originals
```

## Security Properties

1. **No Ambient Authority**: Agent process cannot access filesystem directly
2. **Resource Binding**: Sidecar verifies requested resource matches mandate
3. **Cryptographic Evidence**: Every operation returns content hash
4. **Audit Trail**: All executions logged with mandate ID
5. **Fail Closed**: If sidecar unavailable, operations fail (not bypass)

## Requirements

- Docker and Docker Compose
- LLM API Key (one of the following - all optional, agent works without LLM):
  - `ANTHROPIC_API_KEY` - Claude API key
  - `OPENAI_API_KEY` - OpenAI API key
  - `LOCAL_LLM_BASE_URL` - Ollama/LM Studio endpoint
- `PREDICATE_API_KEY` - Cloud tracing key (optional)

---

*Built with OpenClaw + Predicate Authority for Zero-Trust AI Agent execution.*
