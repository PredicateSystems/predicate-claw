import { describe, expect, it } from "vitest";
import { GuardedProvider, SidecarUnavailableError } from "../src/provider.js";

describe("GuardedProvider", () => {
  it("builds deterministic intent hash", () => {
    const first = GuardedProvider.intentHash({ cmd: "ls", flags: ["-la"] });
    const second = GuardedProvider.intentHash({ flags: ["-la"], cmd: "ls" });

    expect(first).toBe(second);
  });

  it("fails closed when sidecar is unavailable", async () => {
    const provider = new GuardedProvider({
      principal: "p1",
      config: { failClosed: true },
      authorityClient: {
        authorize: async () => {
          throw new SidecarUnavailableError("down");
        },
      },
    });

    await expect(
      provider.guardOrThrow({
        action: "shell.execute",
        resource: "echo hi",
        args: { command: "echo hi" },
      }),
    ).rejects.toBeInstanceOf(SidecarUnavailableError);
  });

  it("returns null in fail-open mode when sidecar is unavailable", async () => {
    const provider = new GuardedProvider({
      principal: "p1",
      config: { failClosed: false },
      authorityClient: {
        authorize: async () => {
          throw new SidecarUnavailableError("down");
        },
      },
    });

    await expect(
      provider.guardOrThrow({
        action: "shell.execute",
        resource: "echo hi",
        args: { command: "echo hi" },
      }),
    ).resolves.toBeNull();
  });
});
