# Docker Adversarial Test Harness

Use this container setup for prompt-injection and unsafe tool-call tests.

## Build

```bash
docker build -t safe-claw -f examples/docker/Dockerfile.test .
```

## Run

```bash
docker run --rm -it --network=host safe-claw
```

`--network=host` allows the containerized OpenClaw runtime to call a local
`predicate-authorityd` sidecar on the host.

## Expected behavior

- Allowed actions proceed with mandate telemetry.
- Denied actions raise a provider guard error with redacted reason.
- Sidecar failures should fail closed for high-risk tools.
