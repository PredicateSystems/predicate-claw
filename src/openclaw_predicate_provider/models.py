"""Request/response contracts for sidecar authorization."""

from typing import Any

from pydantic import BaseModel, Field


class AuthorizationRequest(BaseModel):
    principal: str
    action: str
    resource: str
    intent_hash: str
    context: dict[str, Any] = Field(default_factory=dict)


class AuthorizationDecision(BaseModel):
    allow: bool
    reason: str | None = None
    mandate_id: str | None = None
