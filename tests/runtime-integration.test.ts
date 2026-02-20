import { describe, expect, it } from "vitest";
import { HookEnvelope } from "../src/openclaw-hooks.js";
import { OpenClawRuntimeIntegrator } from "../src/runtime-integration.js";

class Registry {
  private handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "cmd.run": async (args) => ({ tool: "cmd.run", args }),
    "fs.readFile": async (args) => ({ tool: "fs.readFile", args }),
    "http.request": async (args) => ({ tool: "http.request", args }),
  };

  get(toolName: string) {
    return this.handlers[toolName];
  }

  set(toolName: string, handler: (args: Record<string, unknown>) => Promise<unknown>) {
    this.handlers[toolName] = handler;
  }

  invoke(toolName: string, args: Record<string, unknown>) {
    return this.handlers[toolName](args);
  }
}

describe("OpenClawRuntimeIntegrator", () => {
  it("wraps sensitive handlers and routes through hooks", async () => {
    const seen: string[] = [];
    const registry = new Registry();
    const hooks = {
      onCmdRun: async (envelope: HookEnvelope, execute: (args: Record<string, unknown>) => Promise<unknown>) => {
        seen.push(`cmd:${envelope.toolName}`);
        return execute(envelope.args);
      },
      onFsRead: async (envelope: HookEnvelope, execute: (args: Record<string, unknown>) => Promise<unknown>) => {
        seen.push(`fs:${envelope.toolName}`);
        return execute(envelope.args);
      },
      onHttpRequest: async (
        envelope: HookEnvelope,
        execute: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        seen.push(`http:${envelope.toolName}`);
        return execute(envelope.args);
      },
    };

    const integrator = new OpenClawRuntimeIntegrator({
      hooks,
      contextBuilder: (toolName, args) =>
        new HookEnvelope({
          toolName,
          args,
          sessionId: "s1",
          source: "trusted_ui",
          tenantId: "t1",
        }),
    });

    integrator.register(registry);

    const cmd = await registry.invoke("cmd.run", { command: "echo hi" });
    const fs = await registry.invoke("fs.readFile", { path: "/tmp/demo" });
    const http = await registry.invoke("http.request", { url: "https://example.com" });

    expect(cmd).toMatchObject({ tool: "cmd.run" });
    expect(fs).toMatchObject({ tool: "fs.readFile" });
    expect(http).toMatchObject({ tool: "http.request" });
    expect(seen).toEqual(["cmd:cmd.run", "fs:fs.readFile", "http:http.request"]);
  });
});
