import type { ToolAdapter } from "./adapter.js";

export class HookEnvelope {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly sessionId: string;
  readonly source: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly traceId?: string;

  constructor(params: {
    toolName: string;
    args: Record<string, unknown>;
    sessionId: string;
    source: string;
    tenantId?: string;
    userId?: string;
    traceId?: string;
  }) {
    this.toolName = params.toolName;
    this.args = params.args;
    this.sessionId = params.sessionId;
    this.source = params.source;
    this.tenantId = params.tenantId;
    this.userId = params.userId;
    this.traceId = params.traceId;
  }

  context(): Record<string, unknown> {
    return {
      session_id: this.sessionId,
      source: this.source,
      tenant_id: this.tenantId,
      user_id: this.userId,
      trace_id: this.traceId,
    };
  }
}

export class OpenClawHooks {
  constructor(private readonly adapter: Pick<ToolAdapter, "runShell" | "readFile" | "httpRequest">) {}

  onCmdRun(
    envelope: HookEnvelope,
    execute: (args: Record<string, unknown>) => Promise<unknown>,
  ) {
    return this.adapter.runShell({
      args: envelope.args,
      context: envelope.context(),
      execute,
    });
  }

  onFsRead(
    envelope: HookEnvelope,
    execute: (args: Record<string, unknown>) => Promise<unknown>,
  ) {
    return this.adapter.readFile({
      args: envelope.args,
      context: envelope.context(),
      execute,
    });
  }

  onHttpRequest(
    envelope: HookEnvelope,
    execute: (args: Record<string, unknown>) => Promise<unknown>,
  ) {
    return this.adapter.httpRequest({
      args: envelope.args,
      context: envelope.context(),
      execute,
    });
  }
}
