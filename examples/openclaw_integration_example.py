"""Minimal OpenClaw integration sketch using ToolAdapter."""

from __future__ import annotations

import asyncio
from typing import Any

from openclaw_predicate_provider import GuardedProvider, ProviderConfig, ToolAdapter


async def fake_cmd_tool(args: dict[str, Any]) -> dict[str, Any]:
    """Represents the original OpenClaw cmd.run handler."""
    return {"ok": True, "ran": args.get("command", "")}


async def main() -> None:
    config = ProviderConfig(
        sidecar_authorize_url="http://127.0.0.1:4000/v1/authorize",
        request_timeout_ms=300,
        fail_closed=True,
    )
    provider = GuardedProvider(principal="openclaw-agent-local", config=config)
    adapter = ToolAdapter(provider)

    context = {
        "source": "trusted_ui",
        "session_id": "demo-session",
        "tenant_id": "local-dev",
    }
    args = {"command": "echo hello"}

    result = await adapter.run_shell(
        args=args,
        context=context,
        execute=fake_cmd_tool,
    )
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
