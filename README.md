# openclaw-predicate-provider

Python-first OpenClaw security provider that enforces deterministic,
pre-execution authorization using Predicate Authority from `AgentIdentity`.

## Status

Initial scaffold for Phase 1 from:
`docs/predicate_authority_docs/openclaw_predicate_integration_design.md`

## Goals

- Intercept high-risk OpenClaw tool calls (`cmd`, `fs`, `http`)
- Build canonical authorization requests
- Call local `predicate-authorityd` sidecar before execution
- Fail closed on guard errors for sensitive operations

## Package layout

- `src/openclaw_predicate_provider/`
  - provider and guard primitives
  - sidecar client and request/response models
  - OpenClaw hook shim (`openclaw_hooks.py`)
  - runtime registry wrapper (`integrations/openclaw_runtime.py`)
  - configuration and error types
- `tests/`
  - baseline model and contract tests
- `examples/docker/`
  - Docker harness for adversarial testing

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

## Pre-commit hooks

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

## Minimal integration example

```bash
python examples/openclaw_integration_example.py
python examples/runtime_registry_example.py
```

Hook-level shim is available via:

- `openclaw_predicate_provider.OpenClawHooks`
- `openclaw_predicate_provider.HookEnvelope`
- `openclaw_predicate_provider.OpenClawRuntimeIntegrator`

## CLI scaffold

```bash
python -m openclaw_predicate_provider validate-config
python -m openclaw_predicate_provider smoke-authorize
```

If the sidecar is unavailable, `smoke-authorize` exits non-zero by default
(fail-closed behavior).

Backend modes:

- `http_sidecar` (default): HTTP call to sidecar authorize endpoint.
- `agentidentity_local`: in-process AgentIdentity SDK authorization path
  (requires `predicate_authority` runtime package availability).

## Publishing target

Planned as a PyPI package: `openclaw-predicate-provider`
