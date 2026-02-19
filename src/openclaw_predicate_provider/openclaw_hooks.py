"""Thin OpenClaw hook interface for guarded tool execution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Protocol

from .adapter import ToolAdapter

ToolExecutor = Callable[[dict[str, Any]], Awaitable[Any]]


class OpenClawHookContext(Protocol):
    """Protocol for hook context expected from OpenClaw runtime."""

    session_id: str
    source: str
    tenant_id: str | None
    user_id: str | None
    trace_id: str | None


@dataclass(slots=True)
class HookEnvelope:
    """Normalized hook payload for adapter consumption."""

    tool_name: str
    args: dict[str, Any]
    session_id: str
    source: str
    tenant_id: str | None = None
    user_id: str | None = None
    trace_id: str | None = None

    def context(self) -> dict[str, Any]:
        """Render policy context claims sent to Predicate."""
        return {
            "session_id": self.session_id,
            "source": self.source,
            "tenant_id": self.tenant_id,
            "user_id": self.user_id,
            "trace_id": self.trace_id,
        }


class OpenClawHooks:
    """Hook surface matching likely OpenClaw tool callback wiring."""

    def __init__(self, adapter: ToolAdapter):
        self._adapter = adapter

    async def on_cmd_run(self, envelope: HookEnvelope, execute: ToolExecutor) -> Any:
        return await self._adapter.run_shell(
            args=envelope.args,
            context=envelope.context(),
            execute=execute,
        )

    async def on_fs_read(self, envelope: HookEnvelope, execute: ToolExecutor) -> Any:
        return await self._adapter.read_file(
            args=envelope.args,
            context=envelope.context(),
            execute=execute,
        )

    async def on_http_request(
        self,
        envelope: HookEnvelope,
        execute: ToolExecutor,
    ) -> Any:
        return await self._adapter.http_request(
            args=envelope.args,
            context=envelope.context(),
            execute=execute,
        )
