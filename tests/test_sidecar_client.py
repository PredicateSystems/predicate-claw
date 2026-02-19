import asyncio
from unittest.mock import patch

import httpx

from openclaw_predicate_provider.config import ProviderConfig
from openclaw_predicate_provider.errors import SidecarUnavailableError
from openclaw_predicate_provider.models import AuthorizationRequest
from openclaw_predicate_provider.sidecar import SidecarClient


class _DeniedResponseClient:
    def __init__(self, timeout: float):  # noqa: ARG002
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):  # noqa: ANN001
        return False

    async def post(self, url: str, json: dict):  # noqa: ARG002
        return httpx.Response(
            status_code=403,
            json={"reason": "explicit_deny", "mandate_id": "mnd123"},
            request=httpx.Request("POST", url),
        )


class _AllowedResponseClient:
    def __init__(self, timeout: float):  # noqa: ARG002
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):  # noqa: ANN001
        return False

    async def post(self, url: str, json: dict):  # noqa: ARG002
        return httpx.Response(
            status_code=200,
            json={"reason": "allowed", "mandate_id": "mnd_ok"},
            request=httpx.Request("POST", url),
        )


class _UnexpectedStatusClient:
    def __init__(self, timeout: float):  # noqa: ARG002
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):  # noqa: ANN001
        return False

    async def post(self, url: str, json: dict):  # noqa: ARG002
        return httpx.Response(
            status_code=502,
            json={"error": "bad_gateway"},
            request=httpx.Request("POST", url),
        )


class _DeniedEmptyPayloadClient:
    def __init__(self, timeout: float):  # noqa: ARG002
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):  # noqa: ANN001
        return False

    async def post(self, url: str, json: dict):  # noqa: ARG002
        return httpx.Response(
            status_code=403,
            json={},
            request=httpx.Request("POST", url),
        )


def _request() -> AuthorizationRequest:
    return AuthorizationRequest(
        principal="openclaw-agent-local",
        action="shell.execute",
        resource="echo hi",
        intent_hash="abc123",
        context={"source": "untrusted_dm"},
    )


def test_sidecar_403_propagates_reason_and_mandate_id() -> None:
    request = _request()
    client = SidecarClient(ProviderConfig())

    with patch(
        "openclaw_predicate_provider.sidecar.httpx.AsyncClient",
        _DeniedResponseClient,
    ):
        decision = asyncio.run(client.authorize(request))

    assert decision.allow is False
    assert decision.reason == "explicit_deny"
    assert decision.mandate_id == "mnd123"


def test_sidecar_200_propagates_allow_and_mandate_id() -> None:
    request = _request()
    client = SidecarClient(ProviderConfig())

    with patch(
        "openclaw_predicate_provider.sidecar.httpx.AsyncClient",
        _AllowedResponseClient,
    ):
        decision = asyncio.run(client.authorize(request))

    assert decision.allow is True
    assert decision.reason == "allowed"
    assert decision.mandate_id == "mnd_ok"


def test_unexpected_status_fails_closed_by_default() -> None:
    request = _request()
    client = SidecarClient(ProviderConfig(fail_closed=True))

    with patch(
        "openclaw_predicate_provider.sidecar.httpx.AsyncClient",
        _UnexpectedStatusClient,
    ):
        try:
            asyncio.run(client.authorize(request))
        except SidecarUnavailableError:
            return
    raise AssertionError("Expected SidecarUnavailableError for fail-closed mode")


def test_unexpected_status_can_fail_open_when_enabled() -> None:
    request = _request()
    client = SidecarClient(ProviderConfig(fail_closed=False))

    with patch(
        "openclaw_predicate_provider.sidecar.httpx.AsyncClient",
        _UnexpectedStatusClient,
    ):
        decision = asyncio.run(client.authorize(request))

    assert decision.allow is True
    assert decision.reason == "fail_open_override"


def test_403_empty_payload_uses_default_deny_reason() -> None:
    request = _request()
    client = SidecarClient(ProviderConfig())

    with patch(
        "openclaw_predicate_provider.sidecar.httpx.AsyncClient",
        _DeniedEmptyPayloadClient,
    ):
        decision = asyncio.run(client.authorize(request))

    assert decision.allow is False
    assert decision.reason == "denied_by_policy"
    assert decision.mandate_id is None


class _LocalBackendStub:
    def __init__(self, config: ProviderConfig):  # noqa: ARG002
        self.called = False

    def authorize(self, request: AuthorizationRequest):
        self.called = True
        return type(
            "D",
            (),
            {"allow": False, "reason": "explicit_deny", "mandate_id": "mnd_local"},
        )()


def test_agentidentity_local_backend_is_selected() -> None:
    request = AuthorizationRequest(
        principal="openclaw-agent-local",
        action="shell.execute",
        resource="echo hi",
        intent_hash="abc123",
        context={"source": "untrusted_dm"},
    )
    with patch(
        "openclaw_predicate_provider.sidecar.AgentIdentityLocalClient",
        _LocalBackendStub,
    ):
        client = SidecarClient(ProviderConfig(authorization_backend="agentidentity_local"))
        decision = asyncio.run(client.authorize(request))

    assert decision.allow is False
    assert decision.reason == "explicit_deny"
    assert decision.mandate_id == "mnd_local"
