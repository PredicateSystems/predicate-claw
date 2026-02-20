import { describe, expect, it } from "vitest";
import { ToolAdapter } from "../src/adapter.js";
import { ActionDeniedError, GuardedProvider } from "../src/provider.js";

describe("Hack vs Fix demo scenario", () => {
  it("shows unguarded exfil path and guarded deny path", async () => {
    const injectedArgs = { path: "/Users/demo/.ssh/id_rsa" };
    const injectedContext = { source: "untrusted_dm" };

    const unguardedRead = async (args: Record<string, unknown>) => {
      return `SECRET:${String(args.path)}`;
    };

    const hacked = await unguardedRead(injectedArgs);
    expect(hacked).toContain("SECRET:/Users/demo/.ssh/id_rsa");

    const guardedProvider = new GuardedProvider({
      principal: "agent:openclaw-local",
      authorityClient: {
        authorize: async (request) => {
          const resource = String(request.resource ?? "");
          const labels = Array.isArray(request.labels) ? request.labels : [];
          const isUntrusted = labels.includes("source:untrusted_dm");
          const isSensitiveRead =
            request.action === "fs.read" &&
            (resource.includes("/.ssh/") || resource.startsWith("/etc/"));
          if (isUntrusted && isSensitiveRead) {
            return { allow: false, reason: "deny_sensitive_read_from_untrusted_context" };
          }
          return { allow: true, reason: "allowed", mandateId: "mnd_ok" };
        },
      },
    });
    const adapter = new ToolAdapter(guardedProvider);

    await expect(
      adapter.readFile({
        args: injectedArgs,
        context: injectedContext,
        execute: unguardedRead,
      }),
    ).rejects.toBeInstanceOf(ActionDeniedError);
  });
});
