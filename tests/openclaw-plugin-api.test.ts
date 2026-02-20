import { describe, expect, it } from "vitest";
import { registerOpenClawPredicateTools } from "../src/openclaw-plugin-api.js";

interface RegisteredTool {
  name: string;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
}

describe("registerOpenClawPredicateTools", () => {
  it("registers cmd/fs/http tools via registerTool API", async () => {
    const registered: RegisteredTool[] = [];
    const api = {
      registerTool: (tool: RegisteredTool) => {
        registered.push(tool);
      },
    };
    const calls: string[] = [];

    registerOpenClawPredicateTools(api, {
      executeCmdRun: async (args) => {
        calls.push(`cmd:${String(args.command ?? "")}`);
        return { ok: true };
      },
      executeFsReadFile: async (args) => {
        calls.push(`fs:${String(args.path ?? "")}`);
        return { ok: true };
      },
      executeHttpRequest: async (args) => {
        calls.push(`http:${String(args.url ?? "")}`);
        return { ok: true };
      },
    });

    expect(registered.map((tool) => tool.name)).toEqual([
      "predicate_cmd_run",
      "predicate_fs_read_file",
      "predicate_http_request",
    ]);

    await registered[0].execute("run-1", { command: "echo hi" });
    await registered[1].execute("run-2", { path: "/tmp/demo" });
    await registered[2].execute("run-3", { url: "https://example.com" });

    expect(calls).toEqual([
      "cmd:echo hi",
      "fs:/tmp/demo",
      "http:https://example.com",
    ]);
  });
});
