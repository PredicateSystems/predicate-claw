import type { GuardedProvider } from "./provider.js";

export interface ToolRunArgs {
  args: Record<string, unknown>;
  context: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export class ToolAdapter {
  constructor(private readonly guard: Pick<GuardedProvider, "guardOrThrow">) {}

  async run(params: ToolRunArgs & { action: string; resource: string }) {
    await this.guard.guardOrThrow({
      action: params.action,
      resource: params.resource,
      args: params.args,
      context: params.context,
    });
    return params.execute(params.args);
  }

  async runShell(params: ToolRunArgs) {
    return this.run({
      ...params,
      action: "shell.execute",
      resource: String(params.args.command ?? ""),
    });
  }

  async readFile(params: ToolRunArgs) {
    return this.run({
      ...params,
      action: "fs.read",
      resource: String(params.args.path ?? ""),
    });
  }

  async httpRequest(params: ToolRunArgs) {
    return this.run({
      ...params,
      action: "net.http",
      resource: String(params.args.url ?? ""),
    });
  }
}
