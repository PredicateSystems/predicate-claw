import { describe, expect, it } from "vitest";
import { ToolAdapter } from "../src/adapter.js";
import { ActionDeniedError } from "../src/errors.js";

describe("ToolAdapter", () => {
  it("maps cmd.run to shell.execute", async () => {
    const seen: Array<{ action: string; resource: string }> = [];
    const adapter = new ToolAdapter({
      guardOrThrow: async ({ action, resource }) => {
        seen.push({ action, resource });
        return "mnd_test";
      },
    });

    const result = await adapter.runShell({
      args: { command: "echo hi" },
      context: { source: "trusted_ui" },
      execute: async (args) => args,
    });

    expect(result).toEqual({ command: "echo hi" });
    expect(seen).toEqual([{ action: "shell.execute", resource: "echo hi" }]);
  });

  it("bubbles deny errors", async () => {
    const adapter = new ToolAdapter({
      guardOrThrow: async () => {
        throw new ActionDeniedError("denied_by_policy");
      },
    });

    await expect(
      adapter.readFile({
        args: { path: "/etc/passwd" },
        context: { source: "untrusted_dm" },
        execute: async (args) => args,
      }),
    ).rejects.toBeInstanceOf(ActionDeniedError);
  });

  it("maps fs.readFile to fs.read", async () => {
    const seen: Array<{ action: string; resource: string }> = [];
    const adapter = new ToolAdapter({
      guardOrThrow: async ({ action, resource }) => {
        seen.push({ action, resource });
        return "mnd_test";
      },
    });

    await adapter.readFile({
      args: { path: "/tmp/demo.txt" },
      context: { source: "trusted_ui" },
      execute: async (args) => args,
    });

    expect(seen).toEqual([{ action: "fs.read", resource: "/tmp/demo.txt" }]);
  });

  it("maps http.request to net.http", async () => {
    const seen: Array<{ action: string; resource: string }> = [];
    const adapter = new ToolAdapter({
      guardOrThrow: async ({ action, resource }) => {
        seen.push({ action, resource });
        return "mnd_test";
      },
    });

    await adapter.httpRequest({
      args: { url: "https://example.com" },
      context: { source: "trusted_ui" },
      execute: async (args) => args,
    });

    expect(seen).toEqual([{ action: "net.http", resource: "https://example.com" }]);
  });
});
