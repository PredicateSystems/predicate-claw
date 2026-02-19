"""Optional AgentIdentity SDK-backed authorization backend."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .config import ProviderConfig
from .errors import SidecarUnavailableError
from .models import AuthorizationDecision, AuthorizationRequest

if TYPE_CHECKING:
    from predicate_authority.client import AuthorityClient


class AgentIdentityLocalClient:
    """Adapter that uses AgentIdentity local SDK authorization primitives."""

    def __init__(self, config: ProviderConfig):
        self._client = self._build_client(config)

    @staticmethod
    def _build_client(config: ProviderConfig) -> "AuthorityClient":
        try:
            from predicate_authority.client import AuthorityClient
        except ImportError as exc:  # pragma: no cover - environment-dependent
            raise SidecarUnavailableError(
                "AgentIdentity SDK unavailable. Install predicate-authority package."
            ) from exc

        if config.agentidentity_policy_file and config.agentidentity_signing_key:
            local_ctx = AuthorityClient.from_policy_file(
                policy_file=config.agentidentity_policy_file,
                secret_key=config.agentidentity_signing_key,
                ttl_seconds=config.agentidentity_ttl_seconds,
            )
            return local_ctx.client
        local_ctx = AuthorityClient.from_env()
        return local_ctx.client

    def authorize(self, request: AuthorizationRequest) -> AuthorizationDecision:
        try:
            from predicate_authority.integrations.sdk_python import (
                SdkStepEvidence,
                to_action_request,
            )
        except ImportError as exc:  # pragma: no cover - environment-dependent
            raise SidecarUnavailableError(
                "AgentIdentity sdk_python integration module unavailable."
            ) from exc

        state_hash = str(request.context.get("state_hash", request.intent_hash))
        step = SdkStepEvidence(
            principal_id=request.principal,
            action=request.action,
            resource=request.resource,
            intent=request.intent_hash,
            state_hash=state_hash,
            tenant_id=_string_or_none(request.context.get("tenant_id")),
            session_id=_string_or_none(request.context.get("session_id")),
        )
        decision = self._client.authorize(to_action_request(step))
        mandate_id = decision.mandate.claims.mandate_id if decision.mandate else None
        reason = (
            decision.reason.value
            if hasattr(decision.reason, "value")
            else str(decision.reason)
        )
        return AuthorizationDecision(
            allow=decision.allowed,
            reason=reason,
            mandate_id=mandate_id,
        )


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None
