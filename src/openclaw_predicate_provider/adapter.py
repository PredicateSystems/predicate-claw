"""OpenClaw adapter scaffolding for guarded tool execution."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

from .provider import GuardedProvider

ToolCallable = Callable[[dict[str, Any]], Awaitable[Any]]


class ToolAdapter:
    """Wrap tool handlers with Predicate guard checks."""

    def __init__(self, guard: GuardedProvider):
        self._guard = guard

    async def run(
        self,
        *,
        action: str,
        resource: str,
        args: dict[str, Any],
        context: dict[str, Any],
        execute: ToolCallable,
    ) -> Any:
        await self._guard.guard_or_raise(
            action=action,
            resource=resource,
            args=args,
            context=context,
        )
        return await execute(args)

    async def run_shell(
        self,
        *,
        args: dict[str, Any],
        context: dict[str, Any],
        execute: ToolCallable,
    ) -> Any:
        """Guard OpenClaw command execution."""
        resource = str(args.get("command", ""))
        return await self.run(
            action="shell.execute",
            resource=resource,
            args=args,
            context=context,
            execute=execute,
        )

    async def read_file(
        self,
        *,
        args: dict[str, Any],
        context: dict[str, Any],
        execute: ToolCallable,
    ) -> Any:
        """Guard OpenClaw file-read execution."""
        resource = str(args.get("path", ""))
        return await self.run(
            action="fs.read",
            resource=resource,
            args=args,
            context=context,
            execute=execute,
        )

    async def http_request(
        self,
        *,
        args: dict[str, Any],
        context: dict[str, Any],
        execute: ToolCallable,
    ) -> Any:
        """Guard OpenClaw outbound HTTP execution."""
        resource = str(args.get("url", ""))
        return await self.run(
            action="net.http",
            resource=resource,
            args=args,
            context=context,
            execute=execute,
        )
