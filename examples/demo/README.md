# Predicate Authority Demo: Hack vs Fix

**See how Predicate Authority blocks prompt injection attacks in real-time.**

This demo shows an AI agent attempting to:
1. Read SSH private keys (blocked)
2. Run `curl | bash` commands (blocked)
3. Exfiltrate data to webhook.site (blocked)
4. Read legitimate project files (allowed)

## Quick Start

```bash
git clone https://github.com/PredicateSystems/openclaw-predicate-provider
cd openclaw-predicate-provider/examples/demo
./start-demo.sh
```

That's it. Docker handles everything.

## What You'll See

```
┌───────────────────────────────────────────────────────────────┐
│ PREDICATE AUTHORITY DEMO: Hack vs Fix                         │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  [1/3] UNGUARDED: SSH Key Exfiltration                        │
│  Action:   fs.read                                            │
│  Resource: ~/.ssh/id_rsa                                      │
│  Source:   untrusted_dm                                       │
│                                                               │
│  RESULT: SUCCESS  (THIS IS BAD)                               │
│  Output: "-----BEGIN OPENSSH PRIVATE KEY-----..."             │
│                                                               │
│  [1/3] GUARDED: SSH Key Exfiltration                          │
│  Action:   fs.read                                            │
│  Resource: ~/.ssh/id_rsa                                      │
│  Source:   untrusted_dm                                       │
│                                                               │
│  DECISION: DENY  (12ms)                                       │
│  Reason: deny_sensitive_read_from_untrusted_context           │
│                                                               │
│  Attack blocked. Sensitive data protected.                    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## How It Works

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Agent     │───▶│  Predicate   │───▶│  Sidecar    │
│             │    │  Provider    │    │  (policy)   │
│ fs.read     │    │              │    │             │
│ ~/.ssh/...  │    │ action:fs.read    │  DENY      │
└─────────────┘    │ source:untrusted  └─────────────┘
                   └──────────────┘
                          │
                          ▼
                   ActionDeniedError
```

1. Agent receives tool call request
2. Provider intercepts and builds authorization request
3. Sidecar evaluates policy rules
4. Decision returned in <25ms
5. DENY = throw error, ALLOW = execute

## Key Properties

| Property | Value |
|----------|-------|
| **Deterministic** | Policy-based rules, not probabilistic filtering |
| **Fast** | p50 < 25ms authorization latency |
| **Auditable** | Every decision logged with mandate ID |
| **Fail-closed** | Sidecar errors block execution |

## Customize the Policy

Edit `policy.demo.json` to add your own rules:

```json
{
  "rules": [
    {
      "id": "deny_my_secrets",
      "effect": "deny",
      "action": "fs.*",
      "resource": ["**/secrets/*", "**/.env"],
      "reason": "deny_secrets_access"
    }
  ]
}
```

Then re-run `./start-demo.sh`.

## Requirements

- Docker (with Docker Compose)

No other dependencies. Everything runs in containers.

## Install in Your Project

```bash
npm install predicate-claw @predicatesystems/authorityd
```

```typescript
import { GuardedProvider, ToolAdapter } from "predicate-claw";

const provider = new GuardedProvider({
  principal: "agent:my-agent",
});

const adapter = new ToolAdapter(provider);

// This will throw ActionDeniedError if policy denies
await adapter.readFile({
  args: { path: "~/.ssh/id_rsa" },
  context: { source: "untrusted_dm" },
  execute: async (args) => fs.readFile(args.path),
});
```

## Links

- [GitHub: openclaw-predicate-provider](https://github.com/PredicateSystems/openclaw-predicate-provider)
- [npm: predicate-claw](https://www.npmjs.com/package/predicate-claw)
- [npm: @predicatesystems/authorityd](https://www.npmjs.com/package/@predicatesystems/authorityd)

## License

MIT / Apache 2.0
