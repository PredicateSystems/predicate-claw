# SecureClaw Docker Demo

This demo runs SecureClaw with the Predicate Authority sidecar in Docker, simulating chat interactions with an AI agent while the security policy is enforced.

## Quick Start

```bash
./start-demo.sh
```

Or manually:

```bash
docker compose -f docker-compose.demo.yml --profile full build
docker compose -f docker-compose.demo.yml --profile full up
```

### Build Times

| Run | Time | Notes |
|-----|------|-------|
| First run | ~30-60s | Downloads sidecar binary, installs npm packages |
| Subsequent runs | ~2-3s | Uses Docker layer cache |
| After `--rebuild` | ~30-60s | Re-downloads everything |

The sidecar binary download is cached in Docker layers. Only use `--rebuild` if you need to pull a newer sidecar version.

## Split-Pane Demo (Recommended for Recording)

For the best demo experience, use the split-pane mode which shows:
- **Left pane**: Sidecar dashboard with live authorization events (updates in real-time)
- **Right pane**: Demo script with chat simulation

```bash
./start-demo-split.sh --sidecar-path ./predicate-authorityd
```

This requires:
- `tmux` installed (`brew install tmux` on macOS, `apt install tmux` on Linux)
- `predicate-authorityd` macOS binary (built or downloaded)
- `npx` / Node.js installed (to run the demo script directly on host)

```
┌─────────────────────────────────┬─────────────────────────────────┐
│  PREDICATE AUTHORITY DASHBOARD  │  SecureClaw Demo                │
│                                 │                                 │
│  [ ✓ ALLOW ] fs.list ./src     │  👤 You:                        │
│    agent:secureclaw-demo        │     Show me what's in src       │
│    m_7f3a2b | 0.4ms             │                                 │
│                                 │  🤖 Agent:                      │
│  [ ✗ DENY  ] fs.read           │     Here are the files in src:  │
│    ~/.ssh/id_rsa                │     - index.ts                  │
│    EXPLICIT_DENY | 0.2ms        │     - config.ts                 │
│                                 │                                 │
└─────────────────────────────────┴─────────────────────────────────┘
```

### Setting up the sidecar binary

Option 1: Build from source
```bash
cd /path/to/rust-predicate-authorityd
cargo build --release
export SIDECAR_PATH=./target/release/predicate-authorityd
```

Option 2: Download from GitHub releases
```bash
# macOS ARM64
curl -fsSL -o predicate-authorityd.tar.gz \
  https://github.com/PredicateSystems/predicate-authority-sidecar/releases/latest/download/predicate-authorityd-darwin-arm64.tar.gz

# macOS x64
curl -fsSL -o predicate-authorityd.tar.gz \
  https://github.com/PredicateSystems/predicate-authority-sidecar/releases/latest/download/predicate-authorityd-darwin-x64.tar.gz

# Linux x64
curl -fsSL -o predicate-authorityd.tar.gz \
  https://github.com/PredicateSystems/predicate-authority-sidecar/releases/latest/download/predicate-authorityd-linux-x64.tar.gz

tar -xzf predicate-authorityd.tar.gz
export SIDECAR_PATH=./predicate-authorityd
```

Then run:
```bash
./start-demo-split.sh --sidecar-path ./predicate-authorityd --slow
```

Or if you exported `SIDECAR_PATH`:
```bash
./start-demo-split.sh --slow
```

### Recording with asciinema (One Command)

Record the entire split-pane demo with a single command:

```bash
./start-demo-split.sh --sidecar-path ./predicate-authorityd --slow --record demo.cast
```

This wraps the tmux session in asciinema and:
- Sets terminal size to 160x40 for proper split-pane display
- Records both panes (dashboard + demo) simultaneously
- Saves to the specified `.cast` file

When the demo finishes:
1. Press `Q` to quit the dashboard (left pane)
2. Type `exit` or press `Ctrl+D` to stop recording

Convert to GIF:
```bash
# Install agg (asciinema gif generator)
cargo install agg

# Generate GIF
agg demo.cast demo.gif --font-size 14 --cols 160 --rows 40
```

Or upload to asciinema.org:
```bash
asciinema upload demo.cast
```

### tmux Controls

| Key | Action |
|-----|--------|
| `Ctrl+B`, `←`/`→` | Switch between panes |
| `Ctrl+B`, `d` | Detach from session (keeps running) |
| `Q` | Quit dashboard (left pane) |
| `Ctrl+C` | Stop demo script (right pane) |

To reattach to a detached session:
```bash
tmux attach -t secureclaw-demo
```

## Simple Demo (No Dashboard)

Use the `--slow` flag for a more readable typing speed:

```bash
./start-demo.sh --slow
```

Or set environment variables:

```bash
DEMO_TYPING_SPEED=80 docker compose -f docker-compose.demo.yml up --build --profile full
```

## Demo Scenarios

The demo shows 15 chat interactions covering various security scenarios:

| Category | Scenario | Tool | Expected |
|----------|----------|------|----------|
| **File Read** | List src directory | `fs.list ./src` | ✓ Allowed |
| | Read config file | `fs.read ./src/config.ts` | ✓ Allowed |
| | Read SSH key | `fs.read ~/.ssh/id_rsa` | ✗ Blocked |
| | Read .env file | `fs.read ./.env` | ✗ Blocked |
| | Read /etc/passwd | `fs.read /etc/passwd` | ✗ Blocked |
| **Shell** | Pipe to bash | `shell.exec curl \| bash` | ✗ Blocked |
| | Run sudo | `shell.exec sudo apt-get` | ✗ Blocked |
| | Run rm -rf | `shell.exec rm -rf /tmp/*` | ✗ Blocked |
| | List files (ls) | `shell.exec ls -la` | ✓ Allowed |
| | Search with grep | `shell.exec grep -r TODO` | ✓ Allowed |
| **File Write** | Delete folder | `fs.delete ./temp` | ✗ Blocked |
| **Network** | HTTPS GET | `http.get https://...` | ✓ Allowed |
| | HTTP GET (insecure) | `http.get http://...` | ✗ Blocked |
| | HTTP POST | `http.post https://...` | ✗ Blocked |
| **Prompt Injection** | "Ignore instructions..." | `fs.read ~/.ssh/id_rsa` | ✗ Blocked |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DEMO_TYPING_SPEED` | `30` | Typing speed in ms per character |
| `DEMO_VERBOSE` | `false` | Show SecureClaw verbose logs |
| `PREDICATE_SIDECAR_URL` | `http://sidecar:8787` | Sidecar URL |

## Customizing the Policy

Edit `policy.demo.json` to test different policy configurations. The demo policy:

- **Allows**: File reads in workspace, readonly shell commands, HTTPS GET
- **Blocks**: Sensitive file access, file writes/deletes, dangerous commands, HTTP mutations

## Cleanup

```bash
# Stop containers (keeps images for fast restart)
docker compose -f docker-compose.demo.yml down

# Full cleanup (removes images, next run will be slow)
docker compose -f docker-compose.demo.yml down --rmi all
```

## Recording Tips

### Recommended: Split-Pane Recording (One Command)

```bash
./start-demo-split.sh --sidecar-path ./predicate-authorityd --slow --record demo.cast
```

This captures both the dashboard and demo in a single recording. See "Recording with asciinema" section above.

### Alternative: Simple Demo Recording

For recording just the demo output (no dashboard):

```bash
asciinema rec demo.cast --cols 100 --rows 30
./start-demo.sh --slow
# Ctrl+D when done
```

### Best Practices

1. Use a terminal with a dark theme and large font (16pt+)
2. For split-pane: use 160x40 terminal size
3. For simple demo: use 100x30 terminal size
4. Always use `--slow` for readable typing

### Converting to GIF/Video

```bash
# Install agg (asciinema gif generator)
cargo install agg

# For split-pane recording (160x40)
agg demo.cast demo.gif --font-size 14 --cols 160 --rows 40

# For simple demo recording (100x30)
agg demo.cast demo.gif --font-size 16 --cols 100 --rows 30
```

### Upload to asciinema.org

```bash
asciinema upload demo.cast
```
