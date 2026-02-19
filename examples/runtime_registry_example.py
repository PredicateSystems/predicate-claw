"""Example wiring for OpenClawRuntimeIntegrator with a mock registry."""

from __future__ import annotations

import asyncio
from typing import Any

from openclaw_predicate_provider.integrations import OpenClawRuntimeIntegrator
from openclaw_predicate_provider.openclaw_hooks import HookEnvelope, OpenClawHooks


class MockRegistry:
    def __init__(self) -> None:
        self._handlers = {
            "cmd.run": self._cmd_run,
            "fs.readFile": self._fs_read,
            "http.request": self._http_request,
        }

    async def _cmd_run(self, args: dict[str, Any]) -> dict[str, Any]:
        return {"tool": "cmd.run", "args": args}

    async def _fs_read(self, args: dict[str, Any]) -> dict[str, Any]:
        return {"tool": "fs.readFile", "args": args}

    async def _http_request(self, args: dict[str, Any]) -> dict[str, Any]:
        return {"tool": "http.request", "args": args}

    def get(self, tool_name: str):
        return self._handlers[tool_name]

    def set(self, tool_name: str, handler) -> None:
        self._handlers[tool_name] = handler

    async def invoke(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        return await self._handlers[tool_name](args)


def build_context(tool_name: str, args: dict[str, Any]) -> HookEnvelope:
    return HookEnvelope(
        tool_name=tool_name,
        args=args,
        session_id="demo-session",
        source="trusted_ui",
        tenant_id="demo-tenant",
    )


async def main() -> None:
    # In real OpenClaw integration this uses GuardedProvider+ToolAdapter hooks.
    class PassThroughHooks:
        async def on_cmd_run(self, envelope, execute):
            return await execute(envelope.args)

        async def on_fs_read(self, envelope, execute):
            return await execute(envelope.args)

        async def on_http_request(self, envelope, execute):
            return await execute(envelope.args)

    hooks = PassThroughHooks()
    integrator = OpenClawRuntimeIntegrator(
        hooks=hooks,  # type: ignore[arg-type]
        context_builder=build_context,
    )
    registry = MockRegistry()
    integrator.register(registry)

    print(await registry.invoke("cmd.run", {"command": "echo hello"}))
    print(await registry.invoke("fs.readFile", {"path": "./README.md"}))
    print(await registry.invoke("http.request", {"url": "https://example.com"}))


if __name__ == "__main__":
    asyncio.run(main())
