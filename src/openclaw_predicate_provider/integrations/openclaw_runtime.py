"""Runtime registration scaffold for OpenClaw tool hook integration."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Protocol

from ..openclaw_hooks import HookEnvelope, OpenClawHooks

AsyncToolHandler = Callable[[dict[str, Any]], Awaitable[Any]]
ContextBuilder = Callable[[str, dict[str, Any]], HookEnvelope]


class ToolRegistryProtocol(Protocol):
    """Minimal tool registry protocol expected from OpenClaw runtime."""

    def get(self, tool_name: str) -> AsyncToolHandler:
        """Return the current handler for a tool name."""

    def set(self, tool_name: str, handler: AsyncToolHandler) -> None:
        """Replace a handler for a tool name."""


def _default_context_builder(tool_name: str, args: dict[str, Any]) -> HookEnvelope:
    return HookEnvelope(
        tool_name=tool_name,
        args=args,
        session_id="unknown-session",
        source="unknown-source",
    )


class OpenClawRuntimeIntegrator:
    """Registers guarded wrappers around OpenClaw runtime tool handlers."""

    def __init__(
        self,
        hooks: OpenClawHooks,
        context_builder: ContextBuilder | None = None,
    ):
        self._hooks = hooks
        self._context_builder = context_builder or _default_context_builder

    def register(self, registry: ToolRegistryProtocol) -> None:
        """Wrap runtime handlers for sensitive tools with Predicate checks."""
        self._wrap_cmd_run(registry)
        self._wrap_fs_read(registry)
        self._wrap_http_request(registry)

    def _wrap_cmd_run(self, registry: ToolRegistryProtocol) -> None:
        original = registry.get("cmd.run")

        async def guarded(args: dict[str, Any]) -> Any:
            envelope = self._context_builder("cmd.run", args)
            return await self._hooks.on_cmd_run(envelope, original)

        registry.set("cmd.run", guarded)

    def _wrap_fs_read(self, registry: ToolRegistryProtocol) -> None:
        original = registry.get("fs.readFile")

        async def guarded(args: dict[str, Any]) -> Any:
            envelope = self._context_builder("fs.readFile", args)
            return await self._hooks.on_fs_read(envelope, original)

        registry.set("fs.readFile", guarded)

    def _wrap_http_request(self, registry: ToolRegistryProtocol) -> None:
        original = registry.get("http.request")

        async def guarded(args: dict[str, Any]) -> Any:
            envelope = self._context_builder("http.request", args)
            return await self._hooks.on_http_request(envelope, original)

        registry.set("http.request", guarded)
