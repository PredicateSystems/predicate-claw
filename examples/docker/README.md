# Docker Adversarial Test Harness

Use this TypeScript-first container setup for isolated provider demo/testing.

## Option 1: Run with Docker Compose (recommended)

From `openclaw-predicate-provider/`:

```bash
docker compose -f examples/docker/docker-compose.test.yml run --rm provider-demo
```

This runs the reproducible Hack-vs-Fix demo test (`npm run test:demo`) in an
isolated container.

Run full CI-equivalent checks in container:

```bash
docker compose -f examples/docker/docker-compose.test.yml run --rm provider-ci
```

This runs `npm run test:ci` (`typecheck` + full test suite).

## Option 2: Build and run image directly

Build:

```bash
docker build -t openclaw-provider-test -f examples/docker/Dockerfile.test .
```

Run demo test:

```bash
docker run --rm -it openclaw-provider-test npm run test:demo
```

Run full checks:

```bash
docker run --rm -it openclaw-provider-test npm run test:ci
```

## Expected behavior

- Demo test reproduces "Hack vs Fix" flow and passes.
- Denied actions surface stable reason codes.
- Sensitive resource values are redacted in audit export telemetry.
