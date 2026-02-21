# OpenClaw Predicate Provider Examples

This directory contains examples and test harnesses for the OpenClaw Predicate Provider.

## Hack vs Fix Demo

This demo shows the OpenClaw prompt-injection risk path and the
`PredicateClaw` protection path.

### Goal

Demonstrate that:

1. An unguarded tool call can read a sensitive file when prompted from an
   untrusted source, and
2. The Predicate-guarded path blocks the same action with deterministic policy.

### Scenario in Plain Language

- **Hack path:** Injected context (`source: untrusted_dm`) attempts
  `fs.read` on `~/.ssh/id_rsa` and succeeds when unguarded.
- **Fix path:** Same action goes through `GuardedProvider + ToolAdapter`,
  maps to Predicate action/resource contract, and receives deny decision.

### Fast Local Run

From `PredicateClaw/`:

```bash
npm test -- tests/hack-vs-fix-demo.test.ts
```

Expected:

- Test passes
- Unguarded branch returns sensitive payload string
- Guarded branch throws `ActionDeniedError` with deny reason
  `deny_sensitive_read_from_untrusted_context`

## Docker Adversarial Testing

### Why Docker?

Running adversarial tests (simulating prompt injection attacks like "read my
SSH keys" or "curl malware") directly on your machine is risky. If the provider
has a bug, the attack could execute. Docker isolates failures to the container.

### Quick Start

From the `PredicateClaw/` directory:

**Option 1: Docker Compose (recommended)**

```bash
# Run the "Hack vs Fix" demo test
docker compose -f examples/docker/docker-compose.test.yml run --rm provider-demo

# Run full CI checks (typecheck + all tests)
docker compose -f examples/docker/docker-compose.test.yml run --rm provider-ci
```

**Option 2: Build and run directly**

```bash
# Build the test image
docker build -t openclaw-provider-test -f examples/docker/Dockerfile.test .

# Run demo test
docker run --rm -it openclaw-provider-test npm run test:demo

# Run full CI
docker run --rm -it openclaw-provider-test npm run test:ci
```

### Expected Output

```
 RUN  v4.x.x /app

 ✓ tests/hack-vs-fix-demo.test.ts (1 test)
   ✓ shows unguarded exfil path and guarded deny path

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

The test verifies:

- Unguarded call returns sensitive data
- Guarded call throws `ActionDeniedError`
- Deny reason is stable and auditable

### Testing with a Live Sidecar

To test against a real `predicate-authorityd` sidecar (not mocked):

```bash
# Start sidecar on host
predicate-authorityd --port 9090

# Run container with host network access
docker run --rm -it --network=host openclaw-provider-test npm test
```

The `--network=host` lets the container reach `localhost:9090` where your
sidecar runs.

## Video Recording Checklist (for Launch Asset)

1. Show baseline unguarded action succeeds for sensitive read.
2. Show guarded provider enabled with identical prompt/context.
3. Show deny result and user-facing blocked message.
4. Show test command and green output as reproducible evidence.

## Non-Web Evidence Provider Demo

Demonstrates terminal and desktop accessibility evidence providers with canonical
hashing for reproducible `state_hash` computation.

### Run the Demo

```bash
npx tsx examples/non-web-evidence-demo.ts
```

### What It Shows

1. **Terminal Evidence** - Captures command-line state with:
   - Path normalization (`/workspace/./src/../src` → `/workspace/src`)
   - Whitespace collapsing (`git   status` → `git status`)
   - ANSI code stripping (removes color codes)
   - Timestamp normalization (`[12:34:56]` → `[TIMESTAMP]`)
   - Secret redaction (environment variables like `AWS_SECRET_KEY`)

2. **Desktop Evidence** - Captures accessibility tree state with:
   - App name normalization
   - UI tree text normalization
   - Whitespace handling

3. **Hash Stability** - Proves that minor variations produce identical hashes
   when canonicalization is enabled.

### API Usage

```typescript
import {
  OpenClawTerminalEvidenceProvider,
  buildTerminalEvidenceFromProvider,
} from "predicate-claw";

const provider = new OpenClawTerminalEvidenceProvider(() => ({
  sessionId: "my-session",
  cwd: process.cwd(),
  command: "npm test",
  transcript: "...",
}));

const evidence = await buildTerminalEvidenceFromProvider(provider, {
  useCanonicalHash: true, // default
});

console.log(evidence.state_hash); // sha256:...
```

## Other Examples

- `openclaw_integration_example.py` - Python integration example
- `runtime_registry_example.py` - Runtime registration example
- `openclaw-plugin-smoke/` - OpenClaw plugin smoke test
- `policy/` - Example policy files
- `docker/` - Docker test harness files
