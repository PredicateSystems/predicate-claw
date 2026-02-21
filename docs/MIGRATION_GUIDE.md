# Migration Guide

This guide covers migration paths to Predicate Authority from common existing
security approaches.

## Table of Contents

- [From OpenClaw Sandbox](#from-openclaw-sandbox)
- [From HITL-Only](#from-hitl-only)
- [From Custom Guardrails](#from-custom-guardrails)
- [Gradual Rollout Strategy](#gradual-rollout-strategy)

---

## From OpenClaw Sandbox

If you're currently using OpenClaw's built-in sandbox for isolation.

### Current State

```
┌─────────────────┐    ┌─────────────────┐
│  OpenClaw Agent │───▶│   Docker/VM     │
│                 │    │   Sandbox       │
│  (all actions)  │    │   (isolated)    │
└─────────────────┘    └─────────────────┘
```

**Pros of sandbox:**
- Host machine is protected
- Simple to set up

**Cons of sandbox:**
- Agent can still exfiltrate via network
- Agent can access sandbox credentials
- No per-action authorization
- No audit trail of decisions

### Migration Target

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  OpenClaw Agent │───▶│ GuardedProvider │───▶│   Sandbox       │
│                 │    │ (pre-execution  │    │   (defense in   │
│  (all actions)  │    │  authorization) │    │    depth)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Migration Steps

#### Step 1: Install Predicate Provider

```bash
npm install openclaw-predicate-provider
```

#### Step 2: Start in Audit Mode

Run Predicate in audit-only mode first to understand what would be blocked:

```typescript
const provider = new GuardedProvider({
  principal: "agent:my-agent",
  auditOnly: true,  // Log decisions but don't enforce
});
```

Review logs to identify:
- What actions are common
- What sources requests come from
- Any false positives from default policy

#### Step 3: Build Initial Policy

Based on audit data, create a policy that matches your sandbox boundaries:

```yaml
# Match your existing sandbox allowed paths
rules:
  - id: allow_sandbox_workspace
    effect: allow
    action: fs.*
    resource: /sandbox/workspace/**

  - id: allow_sandbox_network
    effect: allow
    action: net.http
    resource:
      - "http://localhost:*"
      - "https://api.internal.example.com/*"
```

#### Step 4: Enable Enforcement

Switch from audit-only to enforcing mode:

```typescript
const provider = new GuardedProvider({
  principal: "agent:my-agent",
  auditOnly: false,  // Now enforcing
});
```

#### Step 5: Keep Sandbox as Defense in Depth

Don't remove the sandbox - it provides blast-radius reduction if policy has gaps.

---

## From HITL-Only

If you're currently using human-in-the-loop approval for all sensitive actions.

### Current State

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  OpenClaw Agent │───▶│   HITL Queue    │───▶│    Execution    │
│                 │    │                 │    │                 │
│  "run command"  │    │  [APPROVE?]     │    │  (after human)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**Pros of HITL:**
- Maximum control
- Human judgment for edge cases

**Cons of HITL:**
- Slow (latency in minutes)
- Doesn't scale
- Human fatigue leads to rubber-stamping
- Blocks agent autonomy

### Migration Target

```
                                ┌─────────────────┐
                           ┌───▶│ Fast Auto-Allow │ (common patterns)
                           │    └─────────────────┘
┌─────────────────┐    ┌───┴───────────────┐
│  OpenClaw Agent │───▶│ GuardedProvider   │
│                 │    │ (policy-based)    │
└─────────────────┘    └───┬───────────────┘
                           │    ┌─────────────────┐
                           └───▶│ HITL for Edge   │ (exceptional cases)
                                └─────────────────┘
```

### Migration Steps

#### Step 1: Analyze HITL Logs

Export your HITL approval logs and categorize:

| Category | Volume | Outcome |
|----------|--------|---------|
| Read workspace files | 85% | Always approved |
| Run git/npm commands | 10% | Always approved |
| External HTTP | 3% | Sometimes denied |
| Shell with flags | 2% | Careful review |

#### Step 2: Automate the 95%

Create policy rules for actions that are always approved:

```yaml
rules:
  # These were always approved - automate them
  - id: auto_approve_workspace_reads
    effect: allow
    action: fs.read
    resource: ./workspace/**

  - id: auto_approve_git
    effect: allow
    action: shell.execute
    resource: "git *"

  - id: auto_approve_npm
    effect: allow
    action: shell.execute
    resource: "npm *"
```

#### Step 3: Keep HITL for Exceptions

Configure escalation for uncertain cases:

```typescript
const provider = new GuardedProvider({
  principal: "agent:my-agent",
  escalation: {
    onDeny: async (request, reason) => {
      // Route to HITL queue for manual review
      if (reason === "requires_review") {
        return await hitlQueue.enqueue(request);
      }
      throw new ActionDeniedError(reason);
    },
  },
});
```

#### Step 4: Measure and Iterate

Track metrics:
- HITL queue reduction (target: 90%+ auto-handled)
- False positive rate (auto-denied that should have been allowed)
- False negative rate (auto-allowed that should have been denied)

Adjust policy based on data.

---

## From Custom Guardrails

If you've built custom authorization logic (regex checks, allowlists, etc.).

### Current State

```typescript
// Typical custom guardrail code
async function guardedExecute(command: string) {
  // Check against blocklist
  if (DANGEROUS_PATTERNS.some(p => command.match(p))) {
    throw new Error("Blocked by guardrail");
  }

  // Check against allowlist
  if (!ALLOWED_COMMANDS.some(c => command.startsWith(c))) {
    throw new Error("Not in allowlist");
  }

  return execute(command);
}
```

**Problems with custom guardrails:**
- Regex is error-prone (bypasses are common)
- Hard to audit and maintain
- No centralized policy management
- No telemetry or compliance trail

### Migration Steps

#### Step 1: Document Existing Rules

Extract your custom rules into a structured format:

| Rule Type | Pattern | Intent |
|-----------|---------|--------|
| Block | `rm -rf` | Prevent destructive ops |
| Block | `curl.*\|.*bash` | Prevent remote exec |
| Allow | `git *` | Version control |
| Allow | `npm *` | Package management |

#### Step 2: Convert to Policy YAML

```yaml
rules:
  # Converted from DANGEROUS_PATTERNS
  - id: deny_rm_rf
    effect: deny
    action: shell.execute
    resource: "rm -rf *"

  - id: deny_curl_bash
    effect: deny
    action: shell.execute
    resource: "curl * | bash*"

  # Converted from ALLOWED_COMMANDS
  - id: allow_git
    effect: allow
    action: shell.execute
    resource: "git *"

  - id: allow_npm
    effect: allow
    action: shell.execute
    resource: "npm *"
```

#### Step 3: Run Side-by-Side

Test Predicate policy against your existing guardrails:

```typescript
async function validateMigration(request) {
  const customResult = await customGuardrail(request);
  const predicateResult = await provider.authorize(request);

  if (customResult !== predicateResult) {
    console.warn("Mismatch:", { request, customResult, predicateResult });
  }
}
```

Fix any mismatches before switching over.

#### Step 4: Switch and Remove Custom Code

Once validated, remove custom guardrail code and rely on Predicate.

---

## Gradual Rollout Strategy

For production systems, use a phased approach.

### Phase 1: Shadow Mode (Week 1-2)

```typescript
const provider = new GuardedProvider({
  mode: "shadow",  // Log only, no enforcement
});
```

- Collect baseline data
- Identify common patterns
- Build initial policy

### Phase 2: Soft Enforcement (Week 3-4)

```typescript
const provider = new GuardedProvider({
  mode: "soft",  // Enforce but allow override
  onDeny: async (request) => {
    // Log and allow with warning
    console.warn("Would deny:", request);
    return { allow: true, warning: true };
  },
});
```

- Start enforcing but allow overrides
- Track would-be denials
- Tune policy to reduce false positives

### Phase 3: Full Enforcement (Week 5+)

```typescript
const provider = new GuardedProvider({
  mode: "enforce",  // Full enforcement
});
```

- Full enforcement
- HITL escalation for edge cases
- Continuous monitoring

### Rollback Plan

Keep ability to disable quickly:

```typescript
const provider = new GuardedProvider({
  enabled: process.env.PREDICATE_ENABLED !== "false",
});
```

```bash
# Emergency disable
export PREDICATE_ENABLED=false
systemctl restart openclaw-agent
```

---

## Common Migration Issues

### Issue: Too Many False Positives

**Symptom:** Legitimate actions being blocked

**Solution:**
1. Check audit logs for deny reasons
2. Add allow rules for legitimate patterns
3. Consider source-based trust levels

### Issue: Performance Impact

**Symptom:** Increased latency on tool calls

**Solution:**
1. Check sidecar is running locally (not remote)
2. Review p50/p95 latency metrics
3. Consider increasing timeout if network is slow

### Issue: Missing Context

**Symptom:** Decisions made without full context

**Solution:**
1. Ensure OpenClaw passes source labels
2. Add session_id and tenant_id propagation
3. Review context extraction in hooks

---

## Getting Help

- Check [docs/OPERATIONAL_RUNBOOK.md](OPERATIONAL_RUNBOOK.md) for troubleshooting
- Review [examples/policy/](../examples/policy/) for policy templates
- File issues at https://github.com/PredicateSystems/openclaw-predicate-provider
