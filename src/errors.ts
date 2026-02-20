export class GuardError extends Error {}

export class ActionDeniedError extends GuardError {}

export class SidecarUnavailableError extends GuardError {}
