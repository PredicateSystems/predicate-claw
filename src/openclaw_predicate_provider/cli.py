"""CLI utilities for provider configuration and sidecar smoke checks."""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from .config import ProviderConfig
from .errors import ActionDeniedError, SidecarUnavailableError
from .provider import GuardedProvider


def _parse_json_arg(raw: str, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON for {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def _build_config(args: argparse.Namespace) -> ProviderConfig:
    return ProviderConfig(
        sidecar_authorize_url=args.sidecar_url,
        request_timeout_ms=args.timeout_ms,
        fail_closed=not args.fail_open,
        authorization_backend=args.authorization_backend,
        agentidentity_policy_file=args.agentidentity_policy_file,
        agentidentity_signing_key=args.agentidentity_signing_key,
        agentidentity_ttl_seconds=args.agentidentity_ttl_seconds,
    )


def _cmd_validate_config(args: argparse.Namespace) -> int:
    config = _build_config(args)
    print("Configuration valid")
    print(f"sidecar_authorize_url={config.sidecar_authorize_url}")
    print(f"request_timeout_ms={config.request_timeout_ms}")
    print(f"fail_closed={config.fail_closed}")
    print(f"authorization_backend={config.authorization_backend}")
    return 0


async def _cmd_smoke_authorize_async(args: argparse.Namespace) -> int:
    config = _build_config(args)
    provider = GuardedProvider(principal=args.principal, config=config)
    context = _parse_json_arg(args.context_json, "context")
    payload = _parse_json_arg(args.args_json, "args")
    try:
        mandate_id = await provider.guard_or_raise(
            action=args.action,
            resource=args.resource,
            args=payload,
            context=context,
        )
    except ActionDeniedError as exc:
        print(f"DENY: {exc}")
        return 2
    except SidecarUnavailableError as exc:
        print(f"ERROR: {exc}")
        return 3

    print("ALLOW")
    print(f"mandate_id={mandate_id}")
    return 0


def _cmd_smoke_authorize(args: argparse.Namespace) -> int:
    return asyncio.run(_cmd_smoke_authorize_async(args))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="openclaw-predicate-provider",
        description="CLI for OpenClaw Predicate provider scaffolding.",
    )
    parser.add_argument(
        "--sidecar-url",
        default="http://127.0.0.1:4000/v1/authorize",
        help="Predicate sidecar authorize URL.",
    )
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=300,
        help="Request timeout in milliseconds.",
    )
    parser.add_argument(
        "--fail-open",
        action="store_true",
        help="Disable fail-closed mode (for debugging only).",
    )
    parser.add_argument(
        "--authorization-backend",
        choices=["http_sidecar", "agentidentity_local"],
        default="http_sidecar",
        help="Authorization backend implementation.",
    )
    parser.add_argument(
        "--agentidentity-policy-file",
        default=None,
        help="Policy file path for agentidentity_local backend.",
    )
    parser.add_argument(
        "--agentidentity-signing-key",
        default=None,
        help="Signing key for agentidentity_local backend.",
    )
    parser.add_argument(
        "--agentidentity-ttl-seconds",
        type=int,
        default=300,
        help="Mandate TTL for agentidentity_local backend bootstrap.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser(
        "validate-config",
        help="Validate and print effective configuration.",
    )
    validate.set_defaults(handler=_cmd_validate_config)

    smoke = subparsers.add_parser(
        "smoke-authorize",
        help="Run one authorization check against sidecar.",
    )
    smoke.add_argument("--principal", default="openclaw-agent-local")
    smoke.add_argument("--action", default="shell.execute")
    smoke.add_argument("--resource", default="echo hello")
    smoke.add_argument(
        "--args-json",
        default='{"command":"echo hello"}',
        help="JSON object for action arguments.",
    )
    smoke.add_argument(
        "--context-json",
        default='{"source":"trusted_ui","session_id":"smoke"}',
        help="JSON object for context values.",
    )
    smoke.set_defaults(handler=_cmd_smoke_authorize)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.handler(args))
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
