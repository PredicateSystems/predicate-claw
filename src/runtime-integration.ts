import { HookEnvelope, type OpenClawHooks } from "./openclaw-hooks.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface ToolRegistry {
  get(toolName: string): ToolHandler;
  set(toolName: string, handler: ToolHandler): void;
}

export interface RuntimeIntegratorOptions {
  hooks: Pick<OpenClawHooks, "onCmdRun" | "onFsRead" | "onHttpRequest">;
  contextBuilder?: (toolName: string, args: Record<string, unknown>) => HookEnvelope;
}

export class OpenClawRuntimeIntegrator {
  private readonly hooks: RuntimeIntegratorOptions["hooks"];
  private readonly contextBuilder: (
    toolName: string,
    args: Record<string, unknown>,
  ) => HookEnvelope;

  constructor(options: RuntimeIntegratorOptions) {
    this.hooks = options.hooks;
    this.contextBuilder = options.contextBuilder ?? defaultContextBuilder;
  }

  register(registry: ToolRegistry): void {
    this.wrapCmdRun(registry);
    this.wrapFsRead(registry);
    this.wrapHttpRequest(registry);
  }

  private wrapCmdRun(registry: ToolRegistry): void {
    const original = registry.get("cmd.run");
    registry.set("cmd.run", async (args: Record<string, unknown>) => {
      const envelope = this.contextBuilder("cmd.run", args);
      return this.hooks.onCmdRun(envelope, original);
    });
  }

  private wrapFsRead(registry: ToolRegistry): void {
    const original = registry.get("fs.readFile");
    registry.set("fs.readFile", async (args: Record<string, unknown>) => {
      const envelope = this.contextBuilder("fs.readFile", args);
      return this.hooks.onFsRead(envelope, original);
    });
  }

  private wrapHttpRequest(registry: ToolRegistry): void {
    const original = registry.get("http.request");
    registry.set("http.request", async (args: Record<string, unknown>) => {
      const envelope = this.contextBuilder("http.request", args);
      return this.hooks.onHttpRequest(envelope, original);
    });
  }
}

function defaultContextBuilder(
  toolName: string,
  args: Record<string, unknown>,
): HookEnvelope {
  return new HookEnvelope({
    toolName,
    args,
    sessionId: "unknown-session",
    source: "unknown-source",
  });
}
