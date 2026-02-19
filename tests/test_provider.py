import asyncio

from openclaw_predicate_provider.config import ProviderConfig
from openclaw_predicate_provider.errors import SidecarUnavailableError
from openclaw_predicate_provider.provider import GuardedProvider


def test_intent_hash_is_deterministic() -> None:
    payload_a = {"cmd": "ls", "flags": ["-la"]}
    payload_b = {"flags": ["-la"], "cmd": "ls"}

    first = GuardedProvider._intent_hash(payload_a)
    second = GuardedProvider._intent_hash(payload_b)

    assert first == second


class _UnavailableSidecar:
    async def authorize(self, request):  # noqa: ANN001
        raise SidecarUnavailableError("down")


def test_guard_or_raise_fails_closed_on_sidecar_unavailable() -> None:
    provider = GuardedProvider(
        principal="p1",
        config=ProviderConfig(fail_closed=True),
    )
    provider._sidecar = _UnavailableSidecar()  # type: ignore[assignment]

    try:
        asyncio.run(
            provider.guard_or_raise(
                action="shell.execute",
                resource="echo hi",
                args={"command": "echo hi"},
                context={"source": "trusted_ui"},
            )
        )
    except SidecarUnavailableError:
        return
    raise AssertionError("Expected SidecarUnavailableError in fail-closed mode")


def test_guard_or_raise_allows_none_on_fail_open() -> None:
    provider = GuardedProvider(
        principal="p1",
        config=ProviderConfig(fail_closed=False),
    )
    provider._sidecar = _UnavailableSidecar()  # type: ignore[assignment]

    result = asyncio.run(
        provider.guard_or_raise(
            action="shell.execute",
            resource="echo hi",
            args={"command": "echo hi"},
            context={"source": "trusted_ui"},
        )
    )
    assert result is None
