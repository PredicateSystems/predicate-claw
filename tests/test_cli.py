from openclaw_predicate_provider.cli import build_parser


def test_validate_config_command_parses() -> None:
    parser = build_parser()
    args = parser.parse_args(["validate-config"])
    assert args.command == "validate-config"


def test_smoke_authorize_command_parses_defaults() -> None:
    parser = build_parser()
    args = parser.parse_args(["smoke-authorize"])
    assert args.command == "smoke-authorize"
    assert args.action == "shell.execute"


def test_validate_config_accepts_backend_switch() -> None:
    parser = build_parser()
    args = parser.parse_args(
        [
            "--authorization-backend",
            "agentidentity_local",
            "validate-config",
        ]
    )
    assert args.authorization_backend == "agentidentity_local"
