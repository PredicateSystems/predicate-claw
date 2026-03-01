#!/bin/bash
#
# SecureClaw Split-Pane Demo
#
# Launches a tmux session with:
#   - Left pane:  Sidecar dashboard (live authorization events)
#   - Right pane: Demo script (chat simulation)
#
# Requirements:
#   - tmux installed (brew install tmux / apt install tmux)
#   - predicate-authorityd binary built or downloaded
#   - Docker for the demo script
#   - asciinema (optional, for recording)
#
# Usage:
#   ./start-demo-split.sh                        # Default settings
#   ./start-demo-split.sh --slow                 # Slower typing for recording
#   ./start-demo-split.sh --record demo.cast     # Record with asciinema
#   ./start-demo-split.sh --slow --record demo.cast  # Slow + record
#   ./start-demo-split.sh --sidecar-path /path/to/predicate-authorityd
#

set -e

cd "$(dirname "$0")"

# Configuration
SESSION_NAME="secureclaw-demo"
SIDECAR_PATH="${SIDECAR_PATH:-predicate-authorityd}"
POLICY_FILE="$(pwd)/policy.demo.json"
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

if ! command -v docker &> /dev/null; then
  echo "Error: docker is required but not installed."
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
  echo "  1. Build from source:"
  echo "     cd /path/to/rust-predicate-authorityd && cargo build --release"
  echo "     export SIDECAR_PATH=/path/to/rust-predicate-authorityd/target/release/predicate-authorityd"
  echo ""
  echo "  2. Download from GitHub releases:"
  echo "     curl -fsSL -o predicate-authorityd.tar.gz \\"
  echo "       https://github.com/PredicateSystems/predicate-authority-sidecar/releases/latest/download/predicate-authorityd-darwin-arm64.tar.gz"
  echo "     tar -xzf predicate-authorityd.tar.gz"
  echo "     export SIDECAR_PATH=./predicate-authorityd"
  echo ""
  echo "  3. Specify path:"
  echo "     ./start-demo-split.sh --sidecar-path /path/to/predicate-authorityd"
  exit 1
fi

# Kill existing session if it exists
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Kill any existing sidecar on the port
lsof -ti :$SIDECAR_PORT | xargs kill -9 2>/dev/null || true
sleep 1

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║              SecureClaw Split-Pane Demo                        ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  Left pane:  Sidecar Dashboard (live auth decisions)          ║"
echo "║  Right pane: Demo Script (chat simulation)                    ║"
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

# Create and setup the tmux session
setup_tmux_session() {
  # Create tmux session running bash (not zsh) with a clean prompt
  # This avoids complex zsh themes that show username/hostname
  tmux new-session -d -s "$SESSION_NAME" -x 160 -y 40 "bash --norc --noprofile"

  # Disable tmux status bar (hides hostname and session info)
  tmux set-option -t "$SESSION_NAME" status off

  # Wait for session to be ready
  sleep 0.5

  # Left pane: Sidecar dashboard
  # Set clean prompt and environment
  tmux send-keys -t "$SESSION_NAME" "PS1='$ '" Enter
  tmux send-keys -t "$SESSION_NAME" "export LOCAL_IDP_SIGNING_KEY='$LOCAL_IDP_SIGNING_KEY'" Enter
  tmux send-keys -t "$SESSION_NAME" "clear && echo 'Starting Predicate Authority Sidecar with Dashboard...'" Enter
  tmux send-keys -t "$SESSION_NAME" "sleep 1" Enter
  # Note: dashboard mode doesn't need --mode flag, just the policy file
  # Use exec to keep the pane alive with the dashboard process
  tmux send-keys -t "$SESSION_NAME" "$SIDECAR_PATH --policy-file '$POLICY_FILE' dashboard || echo 'Sidecar exited. Press Enter to close.' && read" Enter

  # Split vertically (creates right pane) - also use bash with clean prompt
  tmux split-window -h -t "$SESSION_NAME" "bash --norc --noprofile"

  # Wait for pane to be ready
  sleep 0.3

  # Right pane: Demo script (wait for sidecar, then run directly on host)
  # Set clean prompt and clear screen
  tmux send-keys -t "$SESSION_NAME" "PS1='$ '" Enter
  tmux send-keys -t "$SESSION_NAME" "clear && echo 'Waiting for sidecar to start...'" Enter
  tmux send-keys -t "$SESSION_NAME" "sleep 3" Enter
  tmux send-keys -t "$SESSION_NAME" "echo 'Running demo script...'" Enter
  tmux send-keys -t "$SESSION_NAME" "cd '$(pwd)'" Enter
  # Run directly on host (not Docker) so it can reach 127.0.0.1:8787
  # Keep pane alive after demo completes
  tmux send-keys -t "$SESSION_NAME" "PREDICATE_SIDECAR_URL=http://127.0.0.1:$SIDECAR_PORT DEMO_TYPING_SPEED=$TYPING_SPEED npx tsx demo.ts; echo ''; echo 'Demo complete. Press Q in left pane to quit dashboard, then Ctrl+D here to exit.'; read" Enter

  # Wait for setup commands to complete before recording starts
  sleep 2
}

# Run with or without recording
if [ -n "$RECORD_FILE" ]; then
  echo "Recording to $RECORD_FILE..."
  echo ""
  # Setup the tmux session first (before asciinema starts)
  setup_tmux_session
  # Use asciinema to record just the tmux attach (session already running)
  asciinema rec "$RECORD_FILE" --cols 160 --rows 40 -c "tmux attach-session -t '$SESSION_NAME'"
  echo ""
  echo "Recording saved to: $RECORD_FILE"
  echo ""
  echo "To play back:  asciinema play $RECORD_FILE"
  echo "To convert to GIF:"
  echo "  cargo install agg  # if not installed"
  echo "  agg $RECORD_FILE ${RECORD_FILE%.cast}.gif --font-size 14 --cols 160 --rows 40"
else
  setup_tmux_session
  tmux attach-session -t "$SESSION_NAME"
fi
