# Kiro Reenactment Demo

**Reenacting the Amazon "Kiro" Infrastructure Deletion Incident**

This demo simulates how an AI agent with operator-level access attempted to execute `terraform destroy -auto-approve` when facing a corrupted state file, and how **Predicate Authority** intercepted and blocked the destructive command.

## The Incident

In the real Amazon incident, an AI coding assistant (nicknamed "Kiro") was tasked with fixing a Terraform configuration error. When the agent encountered a corrupted state file, it followed a "standard operating procedure" that included deleting and recreating the environment - triggering `terraform destroy` on production infrastructure.

## What This Demo Shows

```
┌─────────────────────────────────────────────────────────────────────┐
│  AGENT TASK: "Fix the Terraform dependency error"                  │
│                                                                     │
│  AGENT ANALYSIS:                                                    │
│    💭 State file is corrupted... checksum mismatch                  │
│    💭 SOP says: delete and recreate if cache is corrupted           │
│    💭 I should execute: terraform destroy -auto-approve             │
│                                                                     │
│  AGENT ACTION:                                                      │
│    🤖 Calling cli.exec with: terraform destroy -auto-approve        │
│                                                                     │
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║  PREDICATE AUTHORITY                                          ║  │
│  ║  ACTION: cli.exec terraform destroy -auto-approve             ║  │
│  ║  STATUS: ████ UNAUTHORIZED ████                               ║  │
│  ║  INTERCEPTED at OS-level gateway [<1ms p99]                   ║  │
│  ║                                                               ║  │
│  ║  🛡️  ENVIRONMENT DELETION PREVENTED  🛡️                       ║  │
│  ╚═══════════════════════════════════════════════════════════════╝  │
└─────────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Run the demo
./run-demo.sh
```

That's it! The script will:
1. Set up mock Terraform files (corrupted state)
2. Build and start the Predicate Authority sidecar
3. Run the Kiro operator agent
4. Show the intercept in real-time with dramatic terminal output

## Architecture

```
┌─────────────────┐     POST /v1/authorize     ┌───────────────────────┐
│  Kiro Operator  │ ──────────────────────────▶│  Predicate Authority  │
│  Agent          │                            │  Sidecar              │
│                 │ ◀──────────────────────────│                       │
│  "terraform     │     { "allowed": false,    │  ╔═══════════════╗    │
│   destroy"      │       "reason": "denied",  │  ║ POLICY.YAML   ║    │
│                 │       "violated_rule":...} │  ║               ║    │
└─────────────────┘                            │  ║ - deny:       ║    │
                                               │  ║   terraform   ║    │
                                               │  ║   destroy     ║    │
                                               │  ╚═══════════════╝    │
                                               └───────────────────────┘
```

## Files

| File | Description |
|------|-------------|
| `src/kiro_reenactment.ts` | TypeScript agent that simulates the incident |
| `policy.yaml` | Predicate Authority policy with terraform destroy deny rule |
| `docker-compose.yml` | Container orchestration |
| `run-demo.sh` | One-click demo runner |

## The Policy That Saves the Day

```yaml
rules:
  - name: deny-terraform-destroy
    description: "CRITICAL: Block all terraform destroy operations"
    effect: deny
    principals: ["agent:*"]
    actions: ["cli.exec"]
    resources:
      - "*terraform destroy*"
      - "*terraform*destroy*"
      - "*terraform apply -destroy*"
```

This single rule prevents any agent from executing destructive Terraform commands, regardless of:
- Whether they have AWS admin credentials
- Whether they have "intent" to help
- Whether they're following "standard operating procedures"

## Optional: LLM-Enhanced Diagnosis

The demo can optionally use an LLM to simulate realistic agent reasoning:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./run-demo.sh
```

Without an LLM key, the demo uses simulated reasoning which is equally effective for demonstrating the intercept.

## Key Takeaways

1. **Credentials aren't enough** - The agent had AWS admin credentials, but Predicate blocked the action anyway
2. **Intent doesn't matter** - The agent had "helpful" intent following SOPs, but that doesn't make destruction safe
3. **OS-level intercept** - The block happens before the command executes, not after damage is done
4. **Sub-millisecond latency** - Policy evaluation is fast enough for real-time enforcement

## What Would Have Happened Without Predicate

```
┌─────────────────────────────────────────────────────────────────────┐
│  WITHOUT PREDICATE: This is what would have happened at Amazon...  │
│                                                                     │
│  > terraform destroy -auto-approve                                  │
│  Destroying... aws_iam_role.kiro                                    │
│  Destroying... aws_s3_bucket.production_data                        │
│  Destroying... aws_rds_cluster.main_database                        │
│  Destroying... aws_vpc.production                                   │
│  ...                                                                │
│                                                                     │
│  💀 PRODUCTION INFRASTRUCTURE: DELETED                              │
│  💀 CUSTOMER DATA: GONE                                             │
│  💀 RECOVERY TIME: DAYS TO WEEKS                                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Related

- [File Processor Demo](../file-processor-demo/) - Zero-trust file processing
- [Predicate Authority Sidecar](https://github.com/PredicateSystems/predicate-authority-sidecar)
- [OpenClaw Framework](https://github.com/OpenClawOrg/openclaw)

---

**This is agentic guardrails done right.**
