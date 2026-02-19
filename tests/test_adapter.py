import asyncio

from openclaw_predicate_provider.adapter import ToolAdapter
from openclaw_predicate_provider.errors import ActionDeniedError


class _AllowGuard:
    async def guard_or_raise(self, **_: object) -> str:
        return "mnd_test"


class _DenyGuard:
    async def guard_or_raise(self, **_: object) -> str:
        raise ActionDeniedError("denied_by_policy")


async def _echo(args: dict[str, object]) -> dict[str, object]:
    return args


def test_run_shell_uses_expected_action_and_resource() -> None:
    adapter = ToolAdapter(_AllowGuard())  # type: ignore[arg-type]
    result = asyncio.run(
        adapter.run_shell(
            args={"command": "echo hi"},
            context={"source": "trusted_ui"},
            execute=_echo,
        )
    )
    assert result["command"] == "echo hi"


def test_denied_guard_bubbles_exception() -> None:
    adapter = ToolAdapter(_DenyGuard())  # type: ignore[arg-type]
    try:
        asyncio.run(
            adapter.read_file(
                args={"path": "/etc/passwd"},
                context={"source": "untrusted_dm"},
                execute=_echo,
            )
        )
    except ActionDeniedError as exc:
        assert "denied" in str(exc)
        return
    raise AssertionError("Expected ActionDeniedError")
