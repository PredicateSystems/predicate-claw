import { describe, expect, it, vi } from "vitest";
import type { AuthorizationRequest } from "@predicatesystems/authority";
import {
  type DecisionAuditExporter,
  type DecisionTelemetryEvent,
  GuardedProvider,
} from "../src/provider.js";

describe("multi-tenant isolation", () => {
  it("propagates tenant_id through authorization request", async () => {
    const capturedRequests: AuthorizationRequest[] = [];

    const mockClient = {
      authorize: vi.fn().mockImplementation((req: AuthorizationRequest) => {
        capturedRequests.push(req);
        return Promise.resolve({ allow: true, reason: "policy_pass" });
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:test-agent",
      authorityClient: mockClient,
    });

    await provider.authorize({
      action: "fs.read",
      resource: "/workspace/file.txt",
      args: { path: "/workspace/file.txt" },
      context: {
        tenant_id: "tenant-alpha",
        session_id: "session-123",
        source: "trusted_ui",
      },
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].labels).toContain("source:trusted_ui");
  });

  it("isolates decisions by tenant in telemetry events", async () => {
    const events: DecisionTelemetryEvent[] = [];

    const mockClient = {
      authorize: vi
        .fn()
        .mockResolvedValue({ allow: true, reason: "tenant_policy" }),
    };

    const telemetry = {
      onDecision: (event: DecisionTelemetryEvent) => events.push(event),
    };

    const provider = new GuardedProvider({
      principal: "agent:multi-tenant-agent",
      authorityClient: mockClient,
      telemetry,
    });

    // Authorize as tenant A
    await provider.authorize({
      action: "shell.execute",
      resource: "echo hello",
      args: { cmd: "echo hello" },
      context: { tenant_id: "tenant-a", user_id: "user-a1" },
    });

    // Authorize as tenant B
    await provider.authorize({
      action: "shell.execute",
      resource: "echo world",
      args: { cmd: "echo world" },
      context: { tenant_id: "tenant-b", user_id: "user-b1" },
    });

    expect(events).toHaveLength(2);
    expect(events[0].tenantId).toBe("tenant-a");
    expect(events[0].userId).toBe("user-a1");
    expect(events[1].tenantId).toBe("tenant-b");
    expect(events[1].userId).toBe("user-b1");
  });

  it("audit exports include tenant isolation context", async () => {
    const exportedEvents: DecisionTelemetryEvent[] = [];

    const mockClient = {
      authorize: vi.fn().mockResolvedValue({ allow: true }),
    };

    const auditExporter: DecisionAuditExporter = {
      exportDecision: async (event) => {
        exportedEvents.push(event);
      },
    };

    const provider = new GuardedProvider({
      principal: "agent:audited-agent",
      authorityClient: mockClient,
      auditExporter,
    });

    await provider.authorize({
      action: "net.http",
      resource: "https://api.example.com/data",
      args: { method: "GET", url: "https://api.example.com/data" },
      context: {
        tenant_id: "tenant-enterprise",
        session_id: "sess-456",
        trace_id: "trace-abc",
        source: "trusted_ui",
      },
    });

    expect(exportedEvents).toHaveLength(1);
    expect(exportedEvents[0].tenantId).toBe("tenant-enterprise");
    expect(exportedEvents[0].sessionId).toBe("sess-456");
    expect(exportedEvents[0].traceId).toBe("trace-abc");
    expect(exportedEvents[0].source).toBe("trusted_ui");
  });

  it("denials preserve tenant context in error events", async () => {
    const events: DecisionTelemetryEvent[] = [];

    const mockClient = {
      authorize: vi.fn().mockResolvedValue({
        allow: false,
        reason: "tenant_quota_exceeded",
      }),
    };

    const telemetry = {
      onDecision: (event: DecisionTelemetryEvent) => events.push(event),
    };

    const provider = new GuardedProvider({
      principal: "agent:quota-agent",
      authorityClient: mockClient,
      telemetry,
    });

    await expect(
      provider.authorize({
        action: "shell.execute",
        resource: "rm -rf /",
        args: { cmd: "rm -rf /" },
        context: { tenant_id: "tenant-restricted" },
      }),
    ).rejects.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("deny");
    expect(events[0].tenantId).toBe("tenant-restricted");
    expect(events[0].reason).toBe("tenant_quota_exceeded");
  });

  it("handles missing tenant context gracefully", async () => {
    const events: DecisionTelemetryEvent[] = [];

    const mockClient = {
      authorize: vi.fn().mockResolvedValue({ allow: true }),
    };

    const telemetry = {
      onDecision: (event: DecisionTelemetryEvent) => events.push(event),
    };

    const provider = new GuardedProvider({
      principal: "agent:no-tenant",
      authorityClient: mockClient,
      telemetry,
    });

    await provider.authorize({
      action: "fs.read",
      resource: "/tmp/file.txt",
      args: { path: "/tmp/file.txt" },
      // No context provided
    });

    expect(events).toHaveLength(1);
    expect(events[0].tenantId).toBeUndefined();
    expect(events[0].sessionId).toBeUndefined();
  });
});
