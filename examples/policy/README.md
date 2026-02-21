# Policy Starter Pack

Ready-to-use policy templates for common OpenClaw security scenarios.

## Quick Start

1. Copy the relevant policy file to your sidecar config directory
2. Customize paths and hosts for your environment
3. Restart the sidecar to load the new policy

```bash
cp examples/policy/workspace-isolation.yaml ~/.predicate/policies/
predicate-authorityd --policy-dir ~/.predicate/policies/
```

## Available Policies

### 1. Workspace Isolation (`workspace-isolation.yaml`)

Restricts file operations to a specific project directory. Ideal for:
- Development agents working on a single project
- CI/CD agents with bounded scope
- Sandboxed coding assistants

### 2. Sensitive Path Blocking (`sensitive-paths.yaml`)

Blocks access to common sensitive paths:
- SSH keys (`~/.ssh/*`)
- Cloud credentials (`~/.aws/*`, `~/.gcloud/*`, `~/.azure/*`)
- System configs (`/etc/*`)
- Environment files (`.env`, `.env.*`)

### 3. Source-Based Trust (`source-trust.yaml`)

Different rules based on request source:
- `trusted_ui` - Direct user interaction, more permissive
- `untrusted_dm` - External messages, restrictive
- `web_content` - Web page content, very restrictive

### 4. Approved Hosts (`approved-hosts.yaml`)

Allowlist for outbound HTTP requests:
- Internal APIs
- Known SaaS endpoints
- Package registries

### 5. Development Workflow (`dev-workflow.yaml`)

Balanced policy for development agents:
- Allow git, npm, cargo, etc.
- Allow localhost HTTP
- Block production endpoints
- Block destructive commands

### 6. Production Strict (`production-strict.yaml`)

Maximum security for production agents:
- Explicit allowlist only
- No shell execution
- Audit all decisions

## Policy Syntax

Policies use YAML format with the following structure:

```yaml
version: 1

# Global defaults
defaults:
  effect: deny  # deny-by-default recommended

# Rule definitions (evaluated in order)
rules:
  - id: unique_rule_id
    effect: allow | deny
    action: action.type | action.*
    resource: path/pattern | [list, of, patterns]
    when:                    # Optional conditions
      source: trusted_ui
      tenant_id: tenant-123

# Metadata
metadata:
  name: Policy Name
  description: What this policy does
  version: 1.0.0
```

## Condition Reference

### Source Labels

| Source | Description | Trust Level |
|--------|-------------|-------------|
| `trusted_ui` | Direct user input from trusted UI | High |
| `trusted_api` | Authenticated API request | High |
| `untrusted_dm` | External message (DM, email) | Low |
| `web_content` | Content from web pages | Very Low |
| `system` | Internal system call | High |

### Actions

| Action | Description |
|--------|-------------|
| `shell.execute` | Run shell command |
| `fs.read` | Read file |
| `fs.write` | Write file |
| `net.http` | HTTP request |

### Resource Patterns

- Exact match: `/path/to/file`
- Glob: `/workspace/**/*.ts`
- Home expansion: `~/.ssh/*`
- List: `["/etc/*", "/var/*"]`

## Combining Policies

Policies can be split across multiple files. The sidecar merges them:

```bash
~/.predicate/policies/
├── base.yaml           # Global defaults
├── workspace.yaml      # Project-specific rules
└── team-overrides.yaml # Team customizations
```

Rules are evaluated in filename order. Later files can override earlier ones.

## Testing Policies

Use the policy tester to validate rules before deployment:

```bash
# Test a specific authorization request
predicate-authorityd policy test \
  --policy examples/policy/workspace-isolation.yaml \
  --principal "agent:test" \
  --action "fs.read" \
  --resource "/workspace/src/main.ts" \
  --context '{"source": "trusted_ui"}'

# Expected output:
# Decision: ALLOW
# Matched rule: allow_workspace_reads
```

## Migration from Other Systems

### From OpenClaw Sandbox

If currently using OpenClaw's built-in sandbox:

1. Start with `workspace-isolation.yaml`
2. Add your existing sandbox paths to the allow list
3. Run in audit mode first to catch missing rules

### From HITL-only

If currently using human-in-the-loop for all sensitive actions:

1. Start with `production-strict.yaml`
2. Gradually add allow rules for common patterns
3. Keep HITL for truly exceptional cases
