import { describe, expect, it } from "vitest";
import {
  ActionDeniedError,
  GuardedProvider,
  SidecarUnavailableError,
} from "../src/provider.js";

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

  it("emits decision telemetry for allow and deny", async () => {
    const events: Array<{ outcome: string; reason?: string }> = [];
    const provider = new GuardedProvider({
      principal: "p1",
      telemetry: {
        onDecision: (event) => {
          events.push({ outcome: event.outcome, reason: event.reason });
        },
      },
      authorityClient: {
        authorize: async (request) => ({
          allow: request.action !== "fs.read",
          reason: request.action === "fs.read" ? "explicit_deny" : "allowed",
          mandateId: request.action === "fs.read" ? undefined : "mnd_ok",
        }),
      },
    });

    await expect(
      provider.guardOrThrow({
        action: "shell.execute",
        resource: "echo hi",
        args: { command: "echo hi" },
        context: { source: "trusted_ui" },
      }),
    ).resolves.toBe("mnd_ok");

    await expect(
      provider.guardOrThrow({
        action: "fs.read",
        resource: "/etc/passwd",
        args: { path: "/etc/passwd" },
        context: { source: "untrusted_dm" },
      }),
    ).rejects.toBeInstanceOf(ActionDeniedError);

    expect(events).toEqual([
      { outcome: "allow", reason: "allowed" },
      { outcome: "deny", reason: "explicit_deny" },
    ]);
  });

  it("sends canonical wire request fields to authority client", async () => {
    let captured: Record<string, unknown> | undefined;
    const provider = new GuardedProvider({
      principal: "agent:openclaw-local",
      authorityClient: {
        authorize: async (request) => {
          captured = request as unknown as Record<string, unknown>;
          return { allow: true, reason: "allowed", mandateId: "mnd_ok" };
        },
      },
    });

    await provider.guardOrThrow({
      action: "shell.execute",
      resource: "echo hi",
      args: { command: "echo hi", flags: ["-n"] },
      context: { source: "trusted_ui", session_id: "s1" },
    });

    expect(captured).toBeDefined();
    expect(captured?.principal).toBe("agent:openclaw-local");
    expect(captured?.action).toBe("shell.execute");
    expect(captured?.resource).toBe("echo hi");
    expect(captured?.intent_hash).toEqual(expect.any(String));
    expect(captured?.labels).toEqual(["source:trusted_ui"]);
  });

  it("exports decision audit events with correlation context", async () => {
    const exported: Array<Record<string, unknown>> = [];
    const provider = new GuardedProvider({
      principal: "agent:openclaw-local",
      auditExporter: {
        exportDecision: async (event) => {
          exported.push(event as unknown as Record<string, unknown>);
        },
      },
      authorityClient: {
        authorize: async () => ({
          allow: true,
          reason: "allowed",
          mandateId: "mnd_123",
        }),
      },
    });

    await provider.guardOrThrow({
      action: "shell.execute",
      resource: "echo hi",
      args: { command: "echo hi" },
      context: {
        source: "trusted_ui",
        session_id: "session-1",
        tenant_id: "tenant-1",
        trace_id: "trace-1",
      },
    });

    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      principal: "agent:openclaw-local",
      action: "shell.execute",
      outcome: "allow",
      mandateId: "mnd_123",
      sessionId: "session-1",
      tenantId: "tenant-1",
      traceId: "trace-1",
    });
  });

  it("does not block authorization if audit export fails", async () => {
    const provider = new GuardedProvider({
      principal: "agent:openclaw-local",
      auditExporter: {
        exportDecision: async () => {
          throw new Error("audit export unavailable");
        },
      },
      authorityClient: {
        authorize: async () => ({
          allow: true,
          reason: "allowed",
          mandateId: "mnd_456",
        }),
      },
    });

    await expect(
      provider.guardOrThrow({
        action: "shell.execute",
        resource: "echo ok",
        args: { command: "echo ok" },
        context: { source: "trusted_ui" },
      }),
    ).resolves.toBe("mnd_456");
  });
});
