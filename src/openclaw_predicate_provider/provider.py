"""Guard wrapper used to enforce Predicate checks around tool calls."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from .config import ProviderConfig
from .errors import ActionDeniedError, SidecarUnavailableError
from .models import AuthorizationRequest
from .sidecar import SidecarClient


class GuardedProvider:
    """Entry point for OpenClaw tool-guard integration."""

    def __init__(self, principal: str, config: ProviderConfig | None = None):
        self._principal = principal
        self._config = config or ProviderConfig()
        self._sidecar = SidecarClient(self._config)

    @staticmethod
    def _intent_hash(args: dict[str, Any]) -> str:
        encoded = json.dumps(args, separators=(",", ":"), sort_keys=True)
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    async def authorize(
        self,
        *,
        action: str,
        resource: str,
        args: dict[str, Any],
        context: dict[str, Any],
    ) -> str | None:
        """Authorize a tool call and return optional mandate id."""
        request = AuthorizationRequest(
            principal=self._principal,
            action=action,
            resource=resource,
            intent_hash=self._intent_hash(args),
            context=context,
        )
        decision = await self._sidecar.authorize(request)

        if decision.allow:
            return decision.mandate_id
        raise ActionDeniedError(decision.reason or "denied_by_policy")

    async def guard_or_raise(
        self,
        *,
        action: str,
        resource: str,
        args: dict[str, Any],
        context: dict[str, Any],
    ) -> str | None:
        """Fail-closed wrapper used by sensitive tool adapters."""
        try:
            return await self.authorize(
                action=action,
                resource=resource,
                args=args,
                context=context,
            )
        except SidecarUnavailableError:
            if self._config.fail_closed:
                raise
            return None
