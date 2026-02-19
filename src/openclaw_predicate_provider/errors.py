"""Error types surfaced by provider guard logic."""


class GuardError(RuntimeError):
    """Base guard error."""


class ActionDeniedError(GuardError):
    """Raised when policy denies a tool action."""


class SidecarUnavailableError(GuardError):
    """Raised when sidecar cannot be reached in fail-closed mode."""
