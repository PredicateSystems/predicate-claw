import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ControlPlaneSyncClient,
  ControlPlaneSyncStatusTracker,
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

  it("flags policy version mismatch against pinned version", () => {
    const statuses: Array<{ policyVersionMismatch: boolean; stale: boolean }> = [];
    const tracker = new ControlPlaneSyncStatusTracker({
      pinnedPolicyVersion: "p-expected",
      staleAfterMs: 300000,
      onStatus: (status) => {
        statuses.push({
          policyVersionMismatch: status.policyVersionMismatch,
          stale: status.stale,
        });
      },
    });

    const status = tracker.recordSync(
      {
        policy: { version: "p-actual", cursor: "pc-1", rules: [] },
        revocations: { version: "r-1", cursor: "rc-1", revoked: [] },
      },
      1000,
    );

    expect(status.policyVersionMismatch).toBe(true);
    expect(status.stale).toBe(false);
    expect(statuses).toEqual([{ policyVersionMismatch: true, stale: false }]);
  });

  it("reports stale sync state when sync age exceeds threshold", () => {
    const tracker = new ControlPlaneSyncStatusTracker({
      staleAfterMs: 5000,
    });
    tracker.recordSync(
      {
        policy: { version: "p-1", cursor: "pc-1", rules: [] },
        revocations: { version: "r-1", cursor: "rc-1", revoked: [] },
      },
      1000,
    );

    const status = tracker.snapshot(7001);
    expect(status.stale).toBe(true);
    expect(status.syncAgeMs).toBe(6001);
  });
});
