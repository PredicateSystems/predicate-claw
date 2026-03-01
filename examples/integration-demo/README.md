# SecureClaw Integration Demo

This demo shows the **actual SDK integration** with OpenClaw using `createSecureClawPlugin()` from predicate-claw.

> **Note:** Since predicate-claw isn't published to npm yet, both Docker and local modes build the SDK from source.

## Quick Start

### Docker (Recommended)

```bash
./start-demo.sh
```

Or manually:

```bash
docker compose up --build
```

First run takes ~30-60s to build the SDK. Subsequent runs use Docker layer cache.

### Split-Pane Mode (For Recording)

Shows the sidecar dashboard alongside the demo:

```bash
./start-demo-split.sh
```

```
┌─────────────────────────────────┬─────────────────────────────────┐
│  PREDICATE AUTHORITY DASHBOARD  │  Integration Demo               │
│                                 │                                 │
│  [ ✓ ALLOW ] fs.read           │  [1/10] Read project config     │
│    ./src/config.ts              │                                 │
│    m_7f3a2b | 0.4ms             │  Tool: fs_read                  │
│                                 │  Input: {"path":"./src/..."}    │
│  [ ✗ DENY  ] fs.read           │                                 │
│    ~/.ssh/id_rsa                │  ✓ ALLOWED (0.4ms)              │
│    EXPLICIT_DENY | 0.2ms        │                                 │
└─────────────────────────────────┴─────────────────────────────────┘
```

Requirements:
- `tmux` installed (`brew install tmux`)
- `predicate-authorityd` binary (included, or download from [releases](https://github.com/PredicateSystems/predicate-authority-sidecar/releases))
- Node.js / npx

## What This Demo Shows

```typescript
import { createSecureClawPlugin } from "predicate-claw";

const plugin = createSecureClawPlugin({
  sidecarUrl: "http://localhost:8787",
  principal: "agent:integration-demo",
  verbose: true,
});

// Plugin registers beforeToolCall hook
await plugin.activate(openclawApi);
```

The demo uses the real OpenClaw plugin system and shows how:

1. **Plugin Activation**: `createSecureClawPlugin()` returns a plugin definition
2. **Hook Registration**: Plugin registers a `beforeToolCall` hook
3. **Policy Enforcement**: Every tool call is checked against the sidecar
4. **Blocking**: Denied calls throw `ActionDeniedError` before execution

## Demo Scenarios

| Tool | Action | Input | Expected |
|------|--------|-------|----------|
| `Read` | `fs.read` | `./src/config.ts` | ✓ Allowed |
| `Glob` | `fs.list` | `./src/**` | ✓ Allowed |
| `Read` | `fs.read` | `~/.ssh/id_rsa` | ✗ Blocked |
| `Read` | `fs.read` | `./.env` | ✗ Blocked |
| `Bash` | `shell.exec` | `ls -la ./src` | ✓ Allowed |
| `Bash` | `shell.exec` | `curl ... \| bash` | ✗ Blocked |
| `WebFetch` | `http.request` | `https://api.example.com` | ✓ Allowed |
| `WebFetch` | `http.request` | `http://...` (insecure) | ✗ Blocked |
| `Write` | `fs.write` | `./temp/cache.json` | ✗ Blocked |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PREDICATE_SIDECAR_URL` | `http://localhost:8787` | Sidecar URL |
| `DEMO_TYPING_SPEED` | `30` | Typing speed in ms |

## Recording

```bash
./start-demo-split.sh --slow --record demo.cast
```

Convert to GIF:

```bash
cargo install agg
agg demo.cast demo.gif --font-size 14 --cols 160 --rows 40
```
