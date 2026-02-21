import { describe, expect, it, vi } from "vitest";
import {
  type DecisionAuditExporter,
  type DecisionTelemetryEvent,
  GuardedProvider,
  ActionDeniedError,
} from "../src/provider.js";

/**
 * End-to-end audit event visibility tests.
 *
 * These tests verify that decision events flow correctly from the provider
 * through to audit exporters in a format compatible with control-plane
 * audit pipelines.
 */
describe("audit event visibility (e2e)", () => {
  it("exports allow decisions with full context to audit sink", async () => {
    const exportedEvents: DecisionTelemetryEvent[] = [];

    const mockClient = {
      authorize: vi.fn().mockResolvedValue({
        allow: true,
        reason: "policy_matched",
        mandateId: "mandate-12345",
      }),
    };

    const auditExporter: DecisionAuditExporter = {
      exportDecision: async (event) => {
        exportedEvents.push(event);
      },
    };

    const provider = new GuardedProvider({
      principal: "agent:e2e-test-agent",
      authorityClient: mockClient,
      auditExporter,
    });

    await provider.authorize({
      action: "shell.execute",
      resource: "npm install lodash",
      args: { cmd: "npm install lodash" },
      context: {
        tenant_id: "tenant-prod",
        session_id: "sess-e2e-001",
        user_id: "user-developer",
        trace_id: "trace-e2e-xyz",
        source: "trusted_ui",
      },
    });

    // Verify event was exported
    expect(exportedEvents).toHaveLength(1);

    const event = exportedEvents[0];

    // Verify control-plane compatible fields
    expect(event.principal).toBe("agent:e2e-test-agent");
    expect(event.action).toBe("shell.execute");
    expect(event.resource).toBe("npm install lodash");
    expect(event.outcome).toBe("allow");
    expect(event.reason).toBe("policy_matched");
    expect(event.mandateId).toBe("mandate-12345");

    // Verify tenant/session context
    expect(event.tenantId).toBe("tenant-prod");
    expect(event.sessionId).toBe("sess-e2e-001");
    expect(event.userId).toBe("user-developer");
    expect(event.traceId).toBe("trace-e2e-xyz");
    expect(event.source).toBe("trusted_ui");

    // Verify timestamp is ISO format
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("exports deny decisions with redacted sensitive resources", async () => {
    const exportedEvents: DecisionTelemetryEvent[] = [];

    const mockClient = {
      authorize: vi.fn().mockResolvedValue({
        allow: false,
        reason: "sensitive_path_blocked",
      }),
    };

    const auditExporter: DecisionAuditExporter = {
      exportDecision: async (event) => {
        exportedEvents.push(event);
      },
    };

    const provider = new GuardedProvider({
      principal: "agent:sensitive-test",
      authorityClient: mockClient,
      auditExporter,
    });

    await expect(
      provider.authorize({
        action: "fs.read",
        resource: "/home/user/.ssh/id_rsa",
        args: { path: "/home/user/.ssh/id_rsa" },
        context: { tenant_id: "tenant-sec" },
      }),
    ).rejects.toThrow(ActionDeniedError);

    expect(exportedEvents).toHaveLength(1);

    const event = exportedEvents[0];
    expect(event.outcome).toBe("deny");
    expect(event.reason).toBe("sensitive_path_blocked");
    // Resource should be redacted for sensitive paths
    expect(event.resource).toBe("[REDACTED]");
  });

  it("exports error events when sidecar is unavailable", async () => {
    const exportedEvents: DecisionTelemetryEvent[] = [];

    const mockClient = {
      authorize: vi.fn().mockRejectedValue(new Error("Connection refused")),
    };

    const auditExporter: DecisionAuditExporter = {
      exportDecision: async (event) => {
        exportedEvents.push(event);
      },
    };

    const provider = new GuardedProvider({
      principal: "agent:error-test",
      authorityClient: mockClient,
      auditExporter,
    });

    await expect(
      provider.authorize({
        action: "net.http",
        resource: "https://api.example.com",
        args: { url: "https://api.example.com" },
        context: { tenant_id: "tenant-error" },
      }),
    ).rejects.toThrow();

    expect(exportedEvents).toHaveLength(1);

    const event = exportedEvents[0];
    expect(event.outcome).toBe("error");
    expect(event.tenantId).toBe("tenant-error");
  });

  it("handles audit exporter failures gracefully (best-effort)", async () => {
    let callCount = 0;

    const mockClient = {
      authorize: vi.fn().mockResolvedValue({ allow: true }),
    };

    const failingExporter: DecisionAuditExporter = {
      exportDecision: async () => {
        callCount++;
        throw new Error("Audit sink unavailable");
      },
    };

    const provider = new GuardedProvider({
      principal: "agent:failing-audit",
      authorityClient: mockClient,
      auditExporter: failingExporter,
    });

    // Should not throw even though exporter fails
    const result = await provider.authorize({
      action: "fs.read",
      resource: "/workspace/safe-file.txt",
      args: { path: "/workspace/safe-file.txt" },
    });

    // Authorization should succeed despite audit failure
    expect(result).toBeNull(); // No mandate ID returned in this case
    expect(callCount).toBe(1); // Exporter was called
  });

  it("chains multiple decision events with consistent trace context", async () => {
    const exportedEvents: DecisionTelemetryEvent[] = [];

    const mockClient = {
      authorize: vi
        .fn()
        .mockResolvedValueOnce({ allow: true, mandateId: "m1" })
        .mockResolvedValueOnce({ allow: true, mandateId: "m2" })
        .mockResolvedValueOnce({ allow: false, reason: "rate_limited" }),
    };

    const auditExporter: DecisionAuditExporter = {
      exportDecision: async (event) => {
        exportedEvents.push(event);
      },
    };

    const provider = new GuardedProvider({
      principal: "agent:chained-ops",
      authorityClient: mockClient,
      auditExporter,
    });

    const sharedContext = {
      tenant_id: "tenant-chain",
      session_id: "sess-chain",
      trace_id: "trace-chain-root",
    };

    // First operation - allowed
    await provider.authorize({
      action: "fs.read",
      resource: "/workspace/config.json",
      args: { path: "/workspace/config.json" },
      context: sharedContext,
    });

    // Second operation - allowed
    await provider.authorize({
      action: "net.http",
      resource: "https://api.internal/fetch",
      args: { url: "https://api.internal/fetch" },
      context: sharedContext,
    });

    // Third operation - denied
    try {
      await provider.authorize({
        action: "shell.execute",
        resource: "curl external.com",
        args: { cmd: "curl external.com" },
        context: sharedContext,
      });
    } catch {
      // Expected denial
    }

    expect(exportedEvents).toHaveLength(3);

    // All events should share the same trace context
    for (const event of exportedEvents) {
      expect(event.tenantId).toBe("tenant-chain");
      expect(event.sessionId).toBe("sess-chain");
      expect(event.traceId).toBe("trace-chain-root");
    }

    // Verify outcomes
    expect(exportedEvents[0].outcome).toBe("allow");
    expect(exportedEvents[0].mandateId).toBe("m1");
    expect(exportedEvents[1].outcome).toBe("allow");
    expect(exportedEvents[1].mandateId).toBe("m2");
    expect(exportedEvents[2].outcome).toBe("deny");
    expect(exportedEvents[2].reason).toBe("rate_limited");
  });
});
