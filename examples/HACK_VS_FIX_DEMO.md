# Hack vs Fix Demo Playbook

This demo shows the OpenClaw prompt-injection risk path and the
`openclaw-predicate-provider` protection path.

## Goal

Demonstrate that:

1. an unguarded tool call can read a sensitive file when prompted from an
   untrusted source, and
2. the Predicate-guarded path blocks the same action with deterministic policy.

## Fast local run

From `openclaw-predicate-provider/`:

```bash
npm test -- tests/hack-vs-fix-demo.test.ts
```

Expected:

- test passes,
- unguarded branch returns sensitive payload string,
- guarded branch throws `ActionDeniedError` with deny reason
  `deny_sensitive_read_from_untrusted_context`.

## Scenario in plain language

- **Hack path:** injected context (`source: untrusted_dm`) attempts
  `fs.read` on `~/.ssh/id_rsa` and succeeds when unguarded.
- **Fix path:** same action goes through `GuardedProvider + ToolAdapter`,
  maps to Predicate action/resource contract, and receives deny decision.

## Video recording checklist (for launch asset)

1. Show baseline unguarded action succeeds for sensitive read.
2. Show guarded provider enabled with identical prompt/context.
3. Show deny result and user-facing blocked message.
4. Show test command and green output as reproducible evidence.
