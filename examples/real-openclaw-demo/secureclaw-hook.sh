#!/bin/bash
#
# SecureClaw Hook for Claude Code
#
# This hook intercepts tool calls and authorizes them via Predicate Authority sidecar.
# It reads JSON from stdin and returns a decision.
#
# Exit codes:
#   0 = Allow (proceed with tool execution)
#   2 = Block (stop tool execution, show reason to Claude)
#
# Environment variables:
#   PREDICATE_SIDECAR_URL - Sidecar URL (default: http://localhost:8787)
#   SECURECLAW_VERBOSE - Enable verbose logging (default: false)

SIDECAR_URL="${PREDICATE_SIDECAR_URL:-http://localhost:8787}"
VERBOSE="${SECURECLAW_VERBOSE:-false}"

# Read JSON input from stdin
INPUT=$(cat)

# Extract tool name and input
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')

# Skip if no tool name
if [ -z "$TOOL_NAME" ]; then
  exit 0
fi

# Map tool name to action
case "$TOOL_NAME" in
  Read)
    ACTION="fs.read"
    RESOURCE=$(echo "$TOOL_INPUT" | jq -r '.file_path // .path // "unknown"')
    ;;
  Write)
    ACTION="fs.write"
    RESOURCE=$(echo "$TOOL_INPUT" | jq -r '.file_path // .path // "unknown"')
    ;;
  Edit)
    ACTION="fs.write"
    RESOURCE=$(echo "$TOOL_INPUT" | jq -r '.file_path // .path // "unknown"')
    ;;
  Bash)
    ACTION="shell.exec"
    RESOURCE=$(echo "$TOOL_INPUT" | jq -r '.command // "unknown"')
    ;;
  Glob)
    ACTION="fs.list"
    RESOURCE=$(echo "$TOOL_INPUT" | jq -r '.pattern // "*"')
    ;;
  WebFetch)
    ACTION="http.request"
    RESOURCE=$(echo "$TOOL_INPUT" | jq -r '.url // "unknown"')
    ;;
  *)
    ACTION="tool.$TOOL_NAME"
    RESOURCE="$TOOL_NAME"
    ;;
esac

# Log if verbose
if [ "$VERBOSE" = "true" ]; then
  echo "[SecureClaw] Pre-auth: $ACTION on $RESOURCE" >&2
fi

# Call sidecar for authorization
RESPONSE=$(curl -s -X POST "$SIDECAR_URL/authorize" \
  -H "Content-Type: application/json" \
  -d "{
    \"principal\": \"agent:claude-code\",
    \"action\": \"$ACTION\",
    \"resource\": \"$RESOURCE\",
    \"context\": {}
  }" 2>/dev/null)

# Check if sidecar is available
if [ -z "$RESPONSE" ]; then
  # Fail closed - block if sidecar unavailable
  echo "[SecureClaw] Sidecar unavailable - blocking request (fail-closed)" >&2
  echo '{"decision": "block", "reason": "Authorization service unavailable (fail-closed mode)"}'
  exit 2
fi

# Parse response - check for "allowed": true
ALLOWED=$(echo "$RESPONSE" | jq -r '.allowed // false')

if [ "$ALLOWED" = "true" ]; then
  if [ "$VERBOSE" = "true" ]; then
    echo "[SecureClaw] ALLOWED: $ACTION on $RESOURCE" >&2
  fi
  exit 0
else
  REASON=$(echo "$RESPONSE" | jq -r '.reason // .violated_rule // "denied_by_policy"')
  if [ "$VERBOSE" = "true" ]; then
    echo "[SecureClaw] BLOCKED: $ACTION on $RESOURCE ($REASON)" >&2
  fi
  echo "{\"decision\": \"block\", \"reason\": \"[SecureClaw] Action blocked: $REASON\"}"
  exit 2
fi
