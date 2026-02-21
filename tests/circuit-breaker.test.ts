import { describe, expect, it, vi } from "vitest";
import {
  calculateBackoff,
  CircuitBreaker,
  CircuitOpenError,
  defaultBackoffConfig,
  defaultCircuitBreakerConfig,
  withCircuitBreaker,
  type CircuitState,
} from "../src/circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const breaker = new CircuitBreaker(defaultCircuitBreakerConfig);
    expect(breaker.getState()).toBe("closed");
    expect(breaker.allowRequest()).toBe(true);
  });

  it("opens after reaching failure threshold", () => {
    const breaker = new CircuitBreaker({
      ...defaultCircuitBreakerConfig,
      failureThreshold: 3,
    });

    breaker.recordFailure();
    expect(breaker.getState()).toBe("closed");

    breaker.recordFailure();
    expect(breaker.getState()).toBe("closed");

    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
    expect(breaker.allowRequest()).toBe(false);
  });

  it("transitions to half-open after reset timeout", async () => {
    const breaker = new CircuitBreaker({
      ...defaultCircuitBreakerConfig,
      failureThreshold: 1,
      resetTimeoutMs: 50,
    });

    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
    expect(breaker.allowRequest()).toBe(false);

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    expect(breaker.allowRequest()).toBe(true);
    expect(breaker.getState()).toBe("half_open");
  });

  it("closes after success threshold in half-open", async () => {
    const breaker = new CircuitBreaker({
      ...defaultCircuitBreakerConfig,
      failureThreshold: 1,
      resetTimeoutMs: 10,
      successThreshold: 2,
    });

    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");

    await new Promise((r) => setTimeout(r, 15));
    breaker.allowRequest(); // Triggers half-open

    expect(breaker.getState()).toBe("half_open");

    breaker.recordSuccess();
    expect(breaker.getState()).toBe("half_open");

    breaker.recordSuccess();
    expect(breaker.getState()).toBe("closed");
  });

  it("reopens on failure in half-open state", async () => {
    const breaker = new CircuitBreaker({
      ...defaultCircuitBreakerConfig,
      failureThreshold: 1,
      resetTimeoutMs: 10,
    });

    breaker.recordFailure();
    await new Promise((r) => setTimeout(r, 15));
    breaker.allowRequest();

    expect(breaker.getState()).toBe("half_open");

    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
  });

  it("resets failure count on success in closed state", () => {
    const breaker = new CircuitBreaker({
      ...defaultCircuitBreakerConfig,
      failureThreshold: 3,
    });

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();

    // Should still be closed because success reset the count
    expect(breaker.getState()).toBe("closed");
  });

  it("tracks metrics correctly", () => {
    const breaker = new CircuitBreaker({
      ...defaultCircuitBreakerConfig,
      failureThreshold: 2,
    });

    breaker.recordSuccess();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.allowRequest(); // Should be rejected

    const metrics = breaker.getMetrics();
    expect(metrics.totalSuccesses).toBe(2);
    expect(metrics.totalFailures).toBe(2);
    expect(metrics.totalRejections).toBe(1);
    expect(metrics.state).toBe("open");
  });

  it("calls onStateChange callback", () => {
    const stateChanges: Array<{ from: CircuitState; to: CircuitState }> = [];

    const breaker = new CircuitBreaker({
      ...defaultCircuitBreakerConfig,
      failureThreshold: 1,
      onStateChange: (from, to) => stateChanges.push({ from, to }),
    });

    breaker.recordFailure();
    expect(stateChanges).toHaveLength(1);
    expect(stateChanges[0]).toEqual({ from: "closed", to: "open" });
  });

  it("can be manually reset", () => {
    const breaker = new CircuitBreaker({
      ...defaultCircuitBreakerConfig,
      failureThreshold: 1,
    });

    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");

    breaker.reset();
    expect(breaker.getState()).toBe("closed");
    expect(breaker.allowRequest()).toBe(true);
  });
});

describe("calculateBackoff", () => {
  it("calculates exponential backoff", () => {
    const config = { ...defaultBackoffConfig, jitterFactor: 0 };

    expect(calculateBackoff(0, config)).toBe(100);
    expect(calculateBackoff(1, config)).toBe(200);
    expect(calculateBackoff(2, config)).toBe(400);
    expect(calculateBackoff(3, config)).toBe(800);
  });

  it("respects max backoff", () => {
    const config = { ...defaultBackoffConfig, jitterFactor: 0, maxMs: 500 };

    expect(calculateBackoff(0, config)).toBe(100);
    expect(calculateBackoff(1, config)).toBe(200);
    expect(calculateBackoff(2, config)).toBe(400);
    expect(calculateBackoff(3, config)).toBe(500); // Capped at max
    expect(calculateBackoff(10, config)).toBe(500);
  });

  it("adds jitter within bounds", () => {
    const config = { ...defaultBackoffConfig, jitterFactor: 0.5 };
    const results = new Set<number>();

    for (let i = 0; i < 20; i++) {
      results.add(calculateBackoff(0, config));
    }

    // With jitter, we should get varied results
    expect(results.size).toBeGreaterThan(1);

    // All results should be within expected range (100 +/- 50)
    for (const result of results) {
      expect(result).toBeGreaterThanOrEqual(50);
      expect(result).toBeLessThanOrEqual(150);
    }
  });
});

describe("withCircuitBreaker", () => {
  it("executes function and records success", async () => {
    const breaker = new CircuitBreaker(defaultCircuitBreakerConfig);
    const fn = vi.fn().mockResolvedValue("result");

    const result = await withCircuitBreaker(breaker, fn);

    expect(result).toBe("result");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(breaker.getMetrics().totalSuccesses).toBe(1);
  });

  it("throws CircuitOpenError when circuit is open", async () => {
    const breaker = new CircuitBreaker({
      ...defaultCircuitBreakerConfig,
      failureThreshold: 1,
    });

    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");

    const fn = vi.fn().mockResolvedValue("result");

    await expect(withCircuitBreaker(breaker, fn)).rejects.toThrow(
      CircuitOpenError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it("retries with backoff on failure", async () => {
    const breaker = new CircuitBreaker({
      ...defaultCircuitBreakerConfig,
      failureThreshold: 10,
    });

    let attempts = 0;
    const fn = vi.fn().mockImplementation(() => {
      attempts++;
      if (attempts < 3) {
        return Promise.reject(new Error("fail"));
      }
      return Promise.resolve("success");
    });

    const result = await withCircuitBreaker(breaker, fn, {
      maxRetries: 3,
      backoffConfig: { ...defaultBackoffConfig, initialMs: 10, jitterFactor: 0 },
    });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects isFailure predicate", async () => {
    const breaker = new CircuitBreaker(defaultCircuitBreakerConfig);

    const businessError = new Error("business_error");
    const fn = vi.fn().mockRejectedValue(businessError);

    // Business errors should not trigger circuit breaker
    await expect(
      withCircuitBreaker(breaker, fn, {
        isFailure: (e) => !(e instanceof Error && e.message === "business_error"),
      }),
    ).rejects.toThrow("business_error");

    // No failures recorded
    expect(breaker.getMetrics().totalFailures).toBe(0);
  });
});
