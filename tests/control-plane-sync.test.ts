import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ControlPlaneSyncClient,
  syncControlPlaneState,
} from "../src/control-plane-sync.js";

describe("ControlPlaneSyncClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pulls policy and revocation snapshots", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/v1/policy/sync")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            version: "p-1",
            cursor: "pc-1",
            rules: [{ name: "allow-safe-read" }],
          }),
        };
      }
      if (input.includes("/v1/revocations/sync")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            version: "r-1",
            cursor: "rc-1",
            revoked: [{ type: "principal", id: "agent:deny" }],
          }),
        };
      }
      throw new Error(`Unexpected URL: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ControlPlaneSyncClient({
      baseUrl: "http://127.0.0.1:9000",
      tenantId: "tenant-a",
    });
    const result = await syncControlPlaneState(client, {
      policyCursor: "p0",
      revocationCursor: "r0",
    });

    expect(result.policy.version).toBe("p-1");
    expect(result.revocations.version).toBe("r-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on non-OK sync responses", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "unavailable" }),
    }));

    const client = new ControlPlaneSyncClient({
      baseUrl: "http://127.0.0.1:9000",
      tenantId: "tenant-a",
    });

    await expect(client.pullPolicySnapshot("c1")).rejects.toThrow(
      "policy sync failed",
    );
  });
});
