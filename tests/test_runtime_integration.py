import asyncio

from openclaw_predicate_provider.integrations import OpenClawRuntimeIntegrator
from openclaw_predicate_provider.openclaw_hooks import HookEnvelope


class _Registry:
    def __init__(self) -> None:
        self._handlers = {
            "cmd.run": self._cmd,
            "fs.readFile": self._fs,
            "http.request": self._http,
        }

    async def _cmd(self, args):
        return {"tool": "cmd.run", "args": args}

    async def _fs(self, args):
        return {"tool": "fs.readFile", "args": args}

    async def _http(self, args):
        return {"tool": "http.request", "args": args}

    def get(self, tool_name):
        return self._handlers[tool_name]

    def set(self, tool_name, handler):
        self._handlers[tool_name] = handler

    async def invoke(self, tool_name, args):
        return await self._handlers[tool_name](args)


class _HooksStub:
    def __init__(self) -> None:
        self.seen = []

    async def on_cmd_run(self, envelope, execute):
        self.seen.append(("cmd", envelope.tool_name, envelope.source))
        return await execute(envelope.args)

    async def on_fs_read(self, envelope, execute):
        self.seen.append(("fs", envelope.tool_name, envelope.source))
        return await execute(envelope.args)

    async def on_http_request(self, envelope, execute):
        self.seen.append(("http", envelope.tool_name, envelope.source))
        return await execute(envelope.args)


def _context_builder(tool_name: str, args: dict) -> HookEnvelope:
    return HookEnvelope(
        tool_name=tool_name,
        args=args,
        session_id="s1",
        source="trusted_ui",
        tenant_id="t1",
    )


def test_runtime_integrator_wraps_and_routes_handlers() -> None:
    registry = _Registry()
    hooks = _HooksStub()
    integrator = OpenClawRuntimeIntegrator(
        hooks=hooks,  # type: ignore[arg-type]
        context_builder=_context_builder,
    )
    integrator.register(registry)

    cmd = asyncio.run(registry.invoke("cmd.run", {"command": "echo hi"}))
    fs = asyncio.run(registry.invoke("fs.readFile", {"path": "/tmp/demo"}))
    http = asyncio.run(registry.invoke("http.request", {"url": "https://e.com"}))

    assert cmd["tool"] == "cmd.run"
    assert fs["tool"] == "fs.readFile"
    assert http["tool"] == "http.request"
    assert [x[0] for x in hooks.seen] == ["cmd", "fs", "http"]
