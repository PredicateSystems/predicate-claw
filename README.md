# openclaw-predicate-provider

OpenClaw security provider that enforces deterministic, pre-execution
authorization using Predicate Authority.

## Status

TypeScript migration is in progress based on:
`docs/predicate_authority_docs/openclaw_predicate_integration_design.md`.

Current repo state:

- `src/*.ts` + `tests/*.test.ts`: active TypeScript implementation path.
- `src/openclaw_predicate_provider/*.py` + `tests/test_*.py`: legacy Python
  scaffold retained temporarily for migration reference.

## Goals

- Intercept high-risk OpenClaw tool calls (`cmd`, `fs`, `http`)
- Build canonical authorization requests
- Use `@predicatesystems/authority` (`ts-predicate-authority`) to call local
  `predicate-authorityd` before execution
- Fail closed on guard errors for sensitive operations

## Package layout

- `src/`
  - TypeScript provider and guard primitives
  - OpenClaw hook shim (`openclaw-hooks.ts`)
  - runtime registry wrapper (`runtime-integration.ts`)
  - Predicate SDK adapter (`authority-client.ts`)
- `src/openclaw_predicate_provider/`
  - legacy Python scaffold (migration reference)
- `tests/`
  - TypeScript tests (`*.test.ts`)
  - legacy Python tests (`test_*.py`)
- `examples/docker/`
  - Docker harness for adversarial testing

## Local development (TypeScript)

```bash
npm install
npm run typecheck
npm test
```

## Local development (legacy Python scaffold)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

## TypeScript hook surface

- `ToolAdapter`
- `HookEnvelope`
- `OpenClawHooks`
- `OpenClawRuntimeIntegrator`
- `GuardedProvider`

## Publishing target

Planned target: npm package `openclaw-predicate-provider`.
