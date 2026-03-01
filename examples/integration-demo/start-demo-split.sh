#!/bin/bash
#
# SecureClaw Integration Demo - Split-Pane Mode
#
# Launches a tmux session with:
#   - Left pane:  Sidecar dashboard (live authorization events)
#   - Right pane: Integration demo (real SDK usage)
#
# Requirements:
#   - tmux installed (brew install tmux / apt install tmux)
#   - predicate-authorityd binary (in current dir, PATH, or specify with --sidecar-path)
#   - Node.js / npx installed
#
# Usage:
#   ./start-demo-split.sh                              # Default settings
#   ./start-demo-split.sh --slow                       # Slower typing for recording
#   ./start-demo-split.sh --record demo.cast           # Record with asciinema
#   ./start-demo-split.sh --sidecar-path /path/to/bin  # Custom sidecar path
#

set -e

cd "$(dirname "$0")"
DEMO_DIR="$(pwd)"
SDK_ROOT="$(cd ../.. && pwd)"

# Configuration
SESSION_NAME="secureclaw-integration-demo"
SIDECAR_PATH="${SIDECAR_PATH:-./predicate-authorityd}"
POLICY_FILE="$(pwd)/policy.json"
TYPING_SPEED="${DEMO_TYPING_SPEED:-30}"
SIDECAR_PORT="${SIDECAR_PORT:-8787}"
RECORD_FILE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --slow)
      TYPING_SPEED=80
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
if ! command -v tmux &> /dev/null; then
  echo "Error: tmux is required but not installed."
  echo "Install with: brew install tmux (macOS) or apt install tmux (Linux)"
  exit 1
fi

if ! command -v npx &> /dev/null; then
  echo "Error: npx/Node.js is required but not installed."
  exit 1
fi

# Check asciinema if recording requested
if [ -n "$RECORD_FILE" ] && ! command -v asciinema &> /dev/null; then
  echo "Error: asciinema is required for recording but not installed."
  echo "Install with: brew install asciinema (macOS) or pip install asciinema (Linux)"
  exit 1
fi

# Check if sidecar binary exists
if ! command -v "$SIDECAR_PATH" &> /dev/null && [ ! -f "$SIDECAR_PATH" ]; then
  echo "Error: predicate-authorityd not found at '$SIDECAR_PATH'"
  echo ""
  echo "Options:"
  echo "  1. Download from GitHub releases:"
  echo "     curl -fsSL -o predicate-authorityd.tar.gz \\"
  echo "       https://github.com/PredicateSystems/predicate-authority-sidecar/releases/latest/download/predicate-authorityd-darwin-arm64.tar.gz"
  echo "     tar -xzf predicate-authorityd.tar.gz"
  echo "     ./start-demo-split.sh --sidecar-path ./predicate-authorityd"
  exit 1
fi

# Build predicate-claw SDK from source (not published to npm yet)
echo "Building predicate-claw SDK from source..."
cd "$SDK_ROOT"
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run build
cd "$DEMO_DIR"

# Kill existing session if it exists
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Kill any existing sidecar on the port
lsof -ti :$SIDECAR_PORT | xargs kill -9 2>/dev/null || true
sleep 1

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         SecureClaw Integration Demo (Split-Pane)               ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  Left pane:  Sidecar Dashboard (live auth decisions)          ║"
echo "║  Right pane: Integration Demo (real SDK usage)                ║"
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

# Export for use in tmux panes
export LOCAL_IDP_SIGNING_KEY="${LOCAL_IDP_SIGNING_KEY:-demo-secret-key-replace-in-production-minimum-32-chars}"
export SIDECAR_PATH
export POLICY_FILE
export TYPING_SPEED
export SIDECAR_PORT
export SDK_ROOT

# Create and setup the tmux session
setup_tmux_session() {
  # Create tmux session with bash
  tmux new-session -d -s "$SESSION_NAME" -x 160 -y 40 "bash --norc --noprofile"

  # Disable tmux status bar
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

  # Right pane: Integration demo
  # Run demo.ts with the local SDK build (uses relative import ../../dist/src/index.js)
  tmux send-keys -t "$SESSION_NAME" "PS1='$ '" Enter
  tmux send-keys -t "$SESSION_NAME" "clear && echo 'Waiting for sidecar to start...'" Enter
  tmux send-keys -t "$SESSION_NAME" "sleep 3" Enter
  tmux send-keys -t "$SESSION_NAME" "echo 'Running integration demo with local SDK build...'" Enter
  tmux send-keys -t "$SESSION_NAME" "cd '$DEMO_DIR'" Enter
  tmux send-keys -t "$SESSION_NAME" "PREDICATE_SIDECAR_URL=http://127.0.0.1:$SIDECAR_PORT DEMO_TYPING_SPEED=$TYPING_SPEED npx tsx demo.ts; echo ''; echo 'Demo complete. Press Q in left pane to quit dashboard, then Ctrl+D here to exit.'; read" Enter

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
