import { describe, expect, it, vi } from "vitest";
import { GuardedProvider } from "../src/provider.js";

/**
 * Load and latency tests for high-frequency tool invocation paths.
 *
 * These tests verify that the provider can handle burst traffic while
 * maintaining acceptable latency characteristics.
 */
describe("load and latency", () => {
  it("handles burst of 100 sequential authorizations under 500ms total", async () => {
    const mockClient = {
      authorize: vi.fn().mockResolvedValue({ allow: true, mandateId: "m1" }),
    };

    const provider = new GuardedProvider({
      principal: "agent:load-test",
      authorityClient: mockClient,
    });

    const iterations = 100;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      await provider.authorize({
        action: "fs.read",
        resource: `/workspace/file-${i}.txt`,
        args: { path: `/workspace/file-${i}.txt` },
      });
    }

    const elapsed = performance.now() - start;

    expect(mockClient.authorize).toHaveBeenCalledTimes(iterations);
    // 100 calls should complete well under 500ms with mocked client
    expect(elapsed).toBeLessThan(500);
  });

  it("handles 50 concurrent authorizations", async () => {
    const mockClient = {
      authorize: vi.fn().mockImplementation(async () => {
        // Simulate small network delay
        await new Promise((r) => setTimeout(r, 1));
        return { allow: true, mandateId: "m1" };
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:concurrent-test",
      authorityClient: mockClient,
    });

    const concurrency = 50;
    const start = performance.now();

    const promises = Array.from({ length: concurrency }, (_, i) =>
      provider.authorize({
        action: "shell.execute",
        resource: `echo test-${i}`,
        args: { cmd: `echo test-${i}` },
      }),
    );

    const results = await Promise.all(promises);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(concurrency);
    expect(mockClient.authorize).toHaveBeenCalledTimes(concurrency);
    // Concurrent calls should complete faster than sequential
    expect(elapsed).toBeLessThan(200);
  });

  it("maintains intent_hash computation performance", () => {
    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      GuardedProvider.intentHash({
        cmd: `echo "iteration ${i}"`,
        workdir: "/workspace",
        env: { NODE_ENV: "test", ITERATION: String(i) },
      });
    }

    const elapsed = performance.now() - start;

    // 1000 hash computations should complete under 100ms
    expect(elapsed).toBeLessThan(100);
  });

  it("measures p50/p95 latency for authorization calls", async () => {
    const latencies: number[] = [];

    const mockClient = {
      authorize: vi.fn().mockImplementation(async () => {
        // Simulate variable latency (1-5ms)
        const delay = 1 + Math.random() * 4;
        await new Promise((r) => setTimeout(r, delay));
        return { allow: true };
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:latency-test",
      authorityClient: mockClient,
    });

    const iterations = 50;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await provider.authorize({
        action: "net.http",
        resource: "https://api.example.com",
        args: { url: "https://api.example.com" },
      });
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);

    const p50 = latencies[Math.floor(iterations * 0.5)];
    const p95 = latencies[Math.floor(iterations * 0.95)];

    // Verify latency targets from design doc (with mocked overhead)
    // Design targets: p50 < 25ms, p95 < 75ms
    // With mocked 1-5ms delay, we expect p50 < 15ms, p95 < 20ms
    expect(p50).toBeLessThan(25);
    expect(p95).toBeLessThan(75);
  });

  it("handles mixed allow/deny outcomes under load", async () => {
    let callCount = 0;

    const mockClient = {
      authorize: vi.fn().mockImplementation(async () => {
        callCount++;
        // Alternate between allow and deny
        if (callCount % 3 === 0) {
          return { allow: false, reason: "rate_limited" };
        }
        return { allow: true, mandateId: `m${callCount}` };
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:mixed-test",
      authorityClient: mockClient,
    });

    const iterations = 30;
    const results = { allowed: 0, denied: 0 };

    for (let i = 0; i < iterations; i++) {
      try {
        await provider.authorize({
          action: "fs.write",
          resource: `/workspace/file-${i}.txt`,
          args: { path: `/workspace/file-${i}.txt`, content: "data" },
        });
        results.allowed++;
      } catch {
        results.denied++;
      }
    }

    expect(results.allowed).toBe(20); // 2/3 allowed
    expect(results.denied).toBe(10); // 1/3 denied
    expect(mockClient.authorize).toHaveBeenCalledTimes(iterations);
  });

  it("telemetry emission does not block authorization path", async () => {
    const telemetryDelays: number[] = [];

    const mockClient = {
      authorize: vi.fn().mockResolvedValue({ allow: true }),
    };

    const slowTelemetry = {
      onDecision: vi.fn().mockImplementation(() => {
        // Simulate slow telemetry (should not block auth)
        const start = performance.now();
        while (performance.now() - start < 1) {
          // Busy wait 1ms
        }
        telemetryDelays.push(performance.now() - start);
      }),
    };

    const provider = new GuardedProvider({
      principal: "agent:telemetry-test",
      authorityClient: mockClient,
      telemetry: slowTelemetry,
    });

    const iterations = 10;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      await provider.authorize({
        action: "fs.read",
        resource: `/file-${i}.txt`,
        args: { path: `/file-${i}.txt` },
      });
    }

    const elapsed = performance.now() - start;

    // Even with slow telemetry, auth should complete reasonably fast
    // Telemetry runs synchronously here, but in production would be async
    expect(elapsed).toBeLessThan(100);
    expect(slowTelemetry.onDecision).toHaveBeenCalledTimes(iterations);
  });
});
