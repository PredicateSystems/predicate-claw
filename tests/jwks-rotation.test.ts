import { describe, expect, it, vi } from "vitest";
import type { AuthorizationRequest } from "@predicatesystems/authority";
import { GuardedProvider } from "../src/provider.js";

/**
 * Integration tests for JWKS/key-rotation-driven policy contexts.
 *
 * These tests verify that the provider correctly handles scenarios where
 * policy decisions depend on JWT validation contexts that may change
 * during key rotation events.
 *
 * Note: The provider passes context fields to the sidecar, which handles
 * actual JWKS validation. These tests verify context propagation and
 * decision handling, not the JWKS validation itself.
 */
describe("JWKS and key rotation contexts", () => {
  it("passes authorization request to sidecar for validation", async () => {
    const capturedRequests: AuthorizationRequest[] = [];

    const mockClient = {
      authorize: vi.fn().mockImplementation((req: AuthorizationRequest) => {
        capturedRequests.push(req);
        return Promise.resolve({ allow: true });
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:jwks-test",
      authorityClient: mockClient,
    });

    await provider.authorize({
      action: "shell.execute",
      resource: "npm install",
      args: { cmd: "npm install" },
      context: {
        kid: "key-2024-02-20",
        iss: "https://auth.example.com",
        tenant_id: "tenant-a",
        source: "trusted_ui",
      },
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].principal).toBe("agent:jwks-test");
    expect(capturedRequests[0].action).toBe("shell.execute");
    expect(capturedRequests[0].labels).toContain("source:trusted_ui");
  });

  it("handles allow decisions from sidecar during key rotation", async () => {
    // Sidecar accepts requests during rotation window
    const mockClient = {
      authorize: vi.fn().mockResolvedValue({
        allow: true,
        reason: "valid_key",
        mandateId: "mandate-rotation-1",
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:rotation-test",
      authorityClient: mockClient,
    });

    // Both old and new key contexts should be accepted by sidecar
    const result1 = await provider.authorize({
      action: "fs.read",
      resource: "/config.json",
      args: { path: "/config.json" },
      context: { kid: "key-v1", source: "trusted_ui" },
    });

    const result2 = await provider.authorize({
      action: "fs.read",
      resource: "/settings.json",
      args: { path: "/settings.json" },
      context: { kid: "key-v2", source: "trusted_ui" },
    });

    expect(result1).toBe("mandate-rotation-1");
    expect(result2).toBe("mandate-rotation-1");
    expect(mockClient.authorize).toHaveBeenCalledTimes(2);
  });

  it("handles deny decisions from sidecar for revoked keys", async () => {
    let callCount = 0;

    // Sidecar rejects old key, accepts new key
    const mockClient = {
      authorize: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call with old key - rejected
          return { allow: false, reason: "key_revoked" };
        }
        // Second call with new key - accepted
        return { allow: true, reason: "valid_key" };
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:post-rotation-test",
      authorityClient: mockClient,
    });

    // Request with revoked old key
    await expect(
      provider.authorize({
        action: "shell.execute",
        resource: "echo hello",
        args: { cmd: "echo hello" },
        context: { kid: "key-v1", source: "trusted_ui" },
      }),
    ).rejects.toThrow("key_revoked");

    // Request with valid new key
    const result = await provider.authorize({
      action: "shell.execute",
      resource: "echo hello",
      args: { cmd: "echo hello" },
      context: { kid: "key-v2", source: "trusted_ui" },
    });

    expect(result).toBeNull(); // No mandate ID in this mock response
  });

  it("propagates issuer context for IdP validation", async () => {
    const capturedRequests: AuthorizationRequest[] = [];

    const mockClient = {
      authorize: vi.fn().mockImplementation((req: AuthorizationRequest) => {
        capturedRequests.push(req);
        return Promise.resolve({ allow: true });
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:idp-test",
      authorityClient: mockClient,
    });

    await provider.authorize({
      action: "net.http",
      resource: "https://api.internal.com/data",
      args: { url: "https://api.internal.com/data" },
      context: {
        iss: "https://login.microsoftonline.com/tenant-id/v2.0",
        aud: "api://predicate-authority",
        sub: "user@example.com",
        tenant_id: "tenant-azure",
        source: "azure_entra",
      },
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].labels).toContain("source:azure_entra");
  });

  it("handles expired token rejection from sidecar", async () => {
    const mockClient = {
      authorize: vi.fn().mockResolvedValue({
        allow: false,
        reason: "token_expired",
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:expired-test",
      authorityClient: mockClient,
    });

    await expect(
      provider.authorize({
        action: "fs.write",
        resource: "/data.json",
        args: { path: "/data.json", content: "{}" },
        context: {
          exp: Math.floor(Date.now() / 1000) - 3600,
          iat: Math.floor(Date.now() / 1000) - 7200,
          source: "trusted_ui",
        },
      }),
    ).rejects.toThrow("token_expired");
  });

  it("handles multiple concurrent requests with sidecar", async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;

    const mockClient = {
      authorize: vi.fn().mockImplementation(async () => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        // Small delay to allow concurrency
        await new Promise((r) => setTimeout(r, 5));
        concurrentCalls--;
        return { allow: true };
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:multi-key-test",
      authorityClient: mockClient,
    });

    await Promise.all([
      provider.authorize({
        action: "fs.read",
        resource: "/a.txt",
        args: { path: "/a.txt" },
        context: { session_id: "session-a", source: "trusted_ui" },
      }),
      provider.authorize({
        action: "fs.read",
        resource: "/b.txt",
        args: { path: "/b.txt" },
        context: { session_id: "session-b", source: "trusted_ui" },
      }),
      provider.authorize({
        action: "fs.read",
        resource: "/c.txt",
        args: { path: "/c.txt" },
        context: { session_id: "session-a", source: "trusted_ui" },
      }),
    ]);

    expect(mockClient.authorize).toHaveBeenCalledTimes(3);
    // Should have had some concurrent calls
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it("includes source label for policy evaluation by key trust level", async () => {
    const capturedRequests: AuthorizationRequest[] = [];

    const mockClient = {
      authorize: vi.fn().mockImplementation((req: AuthorizationRequest) => {
        capturedRequests.push(req);
        const labels = req.labels ?? [];
        // Sidecar policy: only allow trusted sources
        if (labels.includes("source:untrusted_dm")) {
          return Promise.resolve({ allow: false, reason: "untrusted_source" });
        }
        return Promise.resolve({ allow: true });
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:trust-test",
      authorityClient: mockClient,
    });

    // Trusted source - allowed
    await provider.authorize({
      action: "shell.execute",
      resource: "npm install",
      args: { cmd: "npm install" },
      context: { source: "trusted_ui" },
    });

    // Untrusted source - denied
    await expect(
      provider.authorize({
        action: "shell.execute",
        resource: "curl evil.com",
        args: { cmd: "curl evil.com" },
        context: { source: "untrusted_dm" },
      }),
    ).rejects.toThrow("untrusted_source");

    expect(capturedRequests).toHaveLength(2);
    expect(capturedRequests[0].labels).toContain("source:trusted_ui");
    expect(capturedRequests[1].labels).toContain("source:untrusted_dm");
  });
});
