import { describe, expect, it } from "vitest";
import { HookEnvelope, OpenClawHooks } from "../src/openclaw-hooks.js";

describe("OpenClawHooks", () => {
  it("renders hook context shape", () => {
    const env = new HookEnvelope({
      toolName: "cmd.run",
      args: { command: "echo hi" },
      sessionId: "s1",
      source: "trusted_ui",
      tenantId: "t1",
      userId: "u1",
      traceId: "tr1",
    });

    expect(env.context()).toMatchObject({
      source: "trusted_ui",
      tenant_id: "t1",
    });
  });

  it("routes cmd hooks through the shell guard", async () => {
    const calls: string[] = [];
    const hooks = new OpenClawHooks({
      runShell: async ({ execute, args }) => {
        calls.push("shell");
        return execute(args);
      },
      readFile: async ({ execute, args }) => execute(args),
      httpRequest: async ({ execute, args }) => execute(args),
    });

    const result = await hooks.onCmdRun(
      new HookEnvelope({
        toolName: "cmd.run",
        args: { command: "echo hi" },
        sessionId: "s1",
        source: "trusted_ui",
      }),
      async (args) => args,
    );

    expect(result).toEqual({ command: "echo hi" });
    expect(calls).toEqual(["shell"]);
  });
});
