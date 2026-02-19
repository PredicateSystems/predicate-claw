"""Configuration models for OpenClaw Predicate provider."""

from typing import Literal

from pydantic import BaseModel, Field


class ProviderConfig(BaseModel):
    """Runtime settings for sidecar authorization checks."""

    sidecar_authorize_url: str = Field(
        default="http://127.0.0.1:4000/v1/authorize",
        description="Predicate sidecar authorize endpoint.",
    )
    request_timeout_ms: int = Field(
        default=300,
        ge=50,
        le=10000,
        description="Authorization request timeout in milliseconds.",
    )
    fail_closed: bool = Field(
        default=True,
        description="Block action if sidecar check fails unexpectedly.",
    )
    authorization_backend: Literal["http_sidecar", "agentidentity_local"] = Field(
        default="http_sidecar",
        description="Authorization execution backend.",
    )
    agentidentity_policy_file: str | None = Field(
        default=None,
        description="Optional policy file for AgentIdentity local client bootstrap.",
    )
    agentidentity_signing_key: str | None = Field(
        default=None,
        description="Optional signing key for AgentIdentity local client bootstrap.",
    )
    agentidentity_ttl_seconds: int = Field(
        default=300,
        ge=30,
        le=86400,
        description="TTL used when bootstrapping AgentIdentity local client.",
    )
