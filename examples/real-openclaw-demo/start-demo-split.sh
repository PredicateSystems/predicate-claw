#!/bin/bash
#
# Real Predicate Authority Demo - Split-Pane Mode (Native)
#
# Launches a tmux session with:
#   - Left pane:  Sidecar dashboard (live authorization events)
#   - Right pane: Demo runner with real sidecar authorization
#
# No LLM API required - focuses on demonstrating real authorization flow.
#
# Requirements:
#   - tmux installed (brew install tmux)
#   - predicate-authorityd binary
#   - Node.js 22+ with dependencies installed
#
# Usage:
#   ./start-demo-split.sh                              # Default settings
#   ./start-demo-split.sh --slow                       # Slower for recording
#   ./start-demo-split.sh --record demo.cast           # Record with asciinema

set -e

cd "$(dirname "$0")"
DEMO_DIR="$(pwd)"
SDK_ROOT="$(cd ../.. && pwd)"

# Load .env file if it exists
if [ -f ".env" ]; then
  echo "Loading configuration from .env file..."
  set -a
  source .env
  set +a
fi

# Configuration
SESSION_NAME="predicate-authority-demo"
SIDECAR_PATH="${SIDECAR_PATH:-./predicate-authorityd}"
POLICY_FILE="$(pwd)/policy.json"
SIDECAR_PORT="${SIDECAR_PORT:-8787}"
RECORD_FILE=""
SLOW_MODE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --slow)
      SLOW_MODE="1"
      shift
      ;;
    --record)
      RECORD_FILE="$2"
      shift 2
      ;;
    --record=*)
      RECORD_FILE="${1#*=}"
      shift
      ;;
    --sidecar-path)
      SIDECAR_PATH="$2"
      shift 2
      ;;
    --sidecar-path=*)
      SIDECAR_PATH="${1#*=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Check dependencies
check_dependencies() {
  local missing=0

  if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is required. Install with: brew install tmux"
    missing=1
  fi

  if ! command -v npx &> /dev/null; then
    echo "Error: Node.js/npx is required."
    missing=1
  fi

  if [ -n "$RECORD_FILE" ] && ! command -v asciinema &> /dev/null; then
    echo "Error: asciinema is required for recording."
    echo "Install with: brew install asciinema"
    missing=1
  fi

  if ! command -v "$SIDECAR_PATH" &> /dev/null && [ ! -f "$SIDECAR_PATH" ]; then
    echo "Error: predicate-authorityd not found at '$SIDECAR_PATH'"
    echo ""
    echo "Download from GitHub releases:"
    echo "  curl -fsSL -o predicate-authorityd.tar.gz \\"
    echo "    https://github.com/PredicateSystems/predicate-authority-sidecar/releases/latest/download/predicate-authorityd-darwin-arm64.tar.gz"
    echo "  tar -xzf predicate-authorityd.tar.gz"
    echo "  chmod +x predicate-authorityd"
    missing=1
  fi

  if [ $missing -eq 1 ]; then
    exit 1
  fi
}

check_dependencies

# Build SDK from source
echo "Building predicate-claw SDK from source..."
cd "$SDK_ROOT"
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run build
cd "$DEMO_DIR"

# Install demo dependencies
if [ ! -d "src/node_modules" ]; then
  cd src
  npm install
  cd "$DEMO_DIR"
fi

# Export environment
export LOCAL_IDP_SIGNING_KEY="${LOCAL_IDP_SIGNING_KEY:-demo-secret-key-replace-in-production-minimum-32-chars}"
export PREDICATE_SIDECAR_URL="http://127.0.0.1:$SIDECAR_PORT"
export SECURECLAW_VERBOSE="true"
export DEMO_SLOW_MODE="$SLOW_MODE"

# Kill existing session
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
lsof -ti :$SIDECAR_PORT | xargs kill -9 2>/dev/null || true
sleep 1

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       Real Predicate Authority Demo - Split-Pane Mode          ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  Left pane:  Sidecar Dashboard (live auth decisions)          ║"
echo "║  Right pane: Demo Runner (real sidecar authorization)         ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  No LLM API required - demonstrates authorization flow        ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  Controls:                                                     ║"
echo "║    Ctrl+B, ←/→  Switch between panes                          ║"
echo "║    Ctrl+B, d    Detach from session                           ║"
echo "║    Q            Quit dashboard (left pane)                    ║"
if [ -n "$RECORD_FILE" ]; then
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  Recording to: $RECORD_FILE"
echo "║  Press Ctrl+D or type 'exit' when done to stop recording      ║"
fi
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Starting tmux session '$SESSION_NAME'..."
sleep 1

setup_tmux_session() {
  # Create tmux session
  tmux new-session -d -s "$SESSION_NAME" -x 160 -y 40 "bash --norc --noprofile"

  # Disable tmux status bar for clean recording
  tmux set-option -t "$SESSION_NAME" status off

  sleep 0.5

  # Left pane: Sidecar dashboard
  tmux send-keys -t "$SESSION_NAME" "PS1='$ '" Enter
  tmux send-keys -t "$SESSION_NAME" "export LOCAL_IDP_SIGNING_KEY='$LOCAL_IDP_SIGNING_KEY'" Enter
  tmux send-keys -t "$SESSION_NAME" "clear && echo 'Starting Predicate Authority Sidecar with Dashboard...'" Enter
  tmux send-keys -t "$SESSION_NAME" "sleep 1" Enter
  tmux send-keys -t "$SESSION_NAME" "$SIDECAR_PATH --policy-file '$POLICY_FILE' dashboard || echo 'Sidecar exited. Press Enter to close.' && read" Enter

  # Split vertically for right pane
  tmux split-window -h -t "$SESSION_NAME" "bash --norc --noprofile"

  sleep 0.3

  # Right pane: Demo runner
  tmux send-keys -t "$SESSION_NAME" "PS1='$ '" Enter
  tmux send-keys -t "$SESSION_NAME" "clear && echo 'Waiting for sidecar to start...'" Enter
  tmux send-keys -t "$SESSION_NAME" "sleep 3" Enter
  tmux send-keys -t "$SESSION_NAME" "echo 'Running Predicate Authority Demo...'" Enter
  tmux send-keys -t "$SESSION_NAME" "cd '$DEMO_DIR'" Enter
  tmux send-keys -t "$SESSION_NAME" "PREDICATE_SIDECAR_URL=$PREDICATE_SIDECAR_URL npx tsx src/index.ts; echo ''; echo 'Demo complete. Press Q in left pane to quit dashboard, then Ctrl+D here to exit.'; read" Enter

  sleep 2
}

# Run with or without recording
if [ -n "$RECORD_FILE" ]; then
  echo "Recording to $RECORD_FILE..."
  echo ""
  setup_tmux_session
  asciinema rec "$RECORD_FILE" --cols 160 --rows 40 -c "tmux attach-session -t '$SESSION_NAME'"
  echo ""
  echo "Recording saved to: $RECORD_FILE"
  echo ""
  echo "To convert to GIF:"
  echo "  cargo install agg  # if not installed"
  echo "  agg $RECORD_FILE ${RECORD_FILE%.cast}.gif --font-size 14 --cols 160 --rows 40"
else
  setup_tmux_session
  tmux attach-session -t "$SESSION_NAME"
fi
