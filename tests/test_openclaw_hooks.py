import asyncio

from openclaw_predicate_provider.openclaw_hooks import HookEnvelope, OpenClawHooks


class _AdapterStub:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict, dict]] = []

    async def run_shell(self, *, args, context, execute):  # noqa: ANN001
        self.calls.append(("shell", args, context))
        return await execute(args)

    async def read_file(self, *, args, context, execute):  # noqa: ANN001
        self.calls.append(("fs.read", args, context))
        return await execute(args)

    async def http_request(self, *, args, context, execute):  # noqa: ANN001
        self.calls.append(("net.http", args, context))
        return await execute(args)


async def _echo(args):
    return args


def test_hook_envelope_context_shape() -> None:
    env = HookEnvelope(
        tool_name="cmd.run",
        args={"command": "echo hi"},
        session_id="s1",
        source="trusted_ui",
        tenant_id="t1",
        user_id="u1",
        trace_id="tr1",
    )
    ctx = env.context()
    assert ctx["source"] == "trusted_ui"
    assert ctx["tenant_id"] == "t1"


def test_on_cmd_run_routes_to_shell_guard() -> None:
    adapter = _AdapterStub()
    hooks = OpenClawHooks(adapter)  # type: ignore[arg-type]
    env = HookEnvelope(
        tool_name="cmd.run",
        args={"command": "echo hi"},
        session_id="s1",
        source="trusted_ui",
    )
    result = asyncio.run(hooks.on_cmd_run(env, _echo))
    assert result["command"] == "echo hi"
    assert adapter.calls[0][0] == "shell"
