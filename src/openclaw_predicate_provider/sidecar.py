"""HTTP client wrapper for Predicate sidecar authorization."""

from __future__ import annotations

import httpx

from .agentidentity_backend import AgentIdentityLocalClient
from .config import ProviderConfig
from .errors import SidecarUnavailableError
from .models import AuthorizationDecision, AuthorizationRequest


class SidecarClient:
    """Small client used by provider guard checks."""

    def __init__(self, config: ProviderConfig):
        self._config = config
        self._local_backend = (
            AgentIdentityLocalClient(config)
            if config.authorization_backend == "agentidentity_local"
            else None
        )

    async def authorize(self, request: AuthorizationRequest) -> AuthorizationDecision:
        if self._local_backend is not None:
            return self._local_backend.authorize(request)
        return await self._authorize_http(request)

    async def _authorize_http(self, request: AuthorizationRequest) -> AuthorizationDecision:
        timeout_s = self._config.request_timeout_ms / 1000.0
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.post(
                    self._config.sidecar_authorize_url,
                    json=request.model_dump(),
                )
        except httpx.HTTPError as exc:
            raise SidecarUnavailableError("Predicate sidecar unavailable") from exc

        if resp.status_code == 200:
            body = resp.json() if resp.content else {}
            return AuthorizationDecision(
                allow=True,
                reason=body.get("reason"),
                mandate_id=body.get("mandate_id"),
            )
        if resp.status_code == 403:
            body = resp.json()
            return AuthorizationDecision(
                allow=False,
                reason=body.get("reason", "denied_by_policy"),
                mandate_id=body.get("mandate_id"),
            )

        if self._config.fail_closed:
            raise SidecarUnavailableError(
                f"Unexpected sidecar response status: {resp.status_code}"
            )
        return AuthorizationDecision(allow=True, reason="fail_open_override")
