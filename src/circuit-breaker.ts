/**
 * Circuit breaker for sidecar outage resilience.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests fail fast without calling sidecar
 * - HALF_OPEN: Testing if sidecar has recovered
 */

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms before attempting recovery (half-open state) */
  resetTimeoutMs: number;
  /** Number of successful calls in half-open to close circuit */
  successThreshold: number;
  /** Optional callback when state changes */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export const defaultCircuitBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 2,
};

export interface CircuitBreakerMetrics {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  totalFailures: number;
  totalSuccesses: number;
  totalRejections: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private totalRejections = 0;

  constructor(private readonly config: CircuitBreakerConfig) {}

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      totalRejections: this.totalRejections,
    };
  }

  getState(): CircuitState {
    return this.state;
  }

  /**
   * Check if request should be allowed through.
   * Returns true if allowed, false if circuit is open.
   */
  allowRequest(): boolean {
    if (this.state === "closed") {
      return true;
    }

    if (this.state === "open") {
      const now = Date.now();
      if (
        this.lastFailureTime !== null &&
        now - this.lastFailureTime >= this.config.resetTimeoutMs
      ) {
        this.transitionTo("half_open");
        return true;
      }
      this.totalRejections++;
      return false;
    }

    // half_open: allow limited requests to test recovery
    return true;
  }

  /**
   * Record a successful call.
   */
  recordSuccess(): void {
    this.totalSuccesses++;

    if (this.state === "half_open") {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo("closed");
      }
    } else if (this.state === "closed") {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed call.
   */
  recordFailure(): void {
    this.totalFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === "half_open") {
      // Any failure in half-open reopens the circuit
      this.transitionTo("open");
      return;
    }

    if (this.state === "closed") {
      this.failureCount++;
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo("open");
      }
    }
  }

  /**
   * Force reset to closed state (e.g., for testing or manual recovery).
   */
  reset(): void {
    this.transitionTo("closed");
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    // Reset counters on state change
    if (newState === "closed") {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === "half_open") {
      this.successCount = 0;
    } else if (newState === "open") {
      this.successCount = 0;
    }

    this.config.onStateChange?.(oldState, newState);
  }
}

/**
 * Exponential backoff calculator with jitter.
 */
export interface BackoffConfig {
  initialMs: number;
  maxMs: number;
  multiplier: number;
  jitterFactor: number;
}

export const defaultBackoffConfig: BackoffConfig = {
  initialMs: 100,
  maxMs: 10_000,
  multiplier: 2,
  jitterFactor: 0.1,
};

export function calculateBackoff(
  attempt: number,
  config: BackoffConfig = defaultBackoffConfig,
): number {
  const base = Math.min(
    config.initialMs * Math.pow(config.multiplier, attempt),
    config.maxMs,
  );
  const jitter = base * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap an async function with circuit breaker and retry logic.
 */
export async function withCircuitBreaker<T>(
  breaker: CircuitBreaker,
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    backoffConfig?: BackoffConfig;
    isFailure?: (error: unknown) => boolean;
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 0;
  const backoffConfig = options?.backoffConfig ?? defaultBackoffConfig;
  const isFailure = options?.isFailure ?? (() => true);

  if (!breaker.allowRequest()) {
    throw new CircuitOpenError("Circuit breaker is open");
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      breaker.recordSuccess();
      return result;
    } catch (error) {
      lastError = error;

      if (!isFailure(error)) {
        // Not a circuit-breaker-relevant failure (e.g., business logic error)
        throw error;
      }

      breaker.recordFailure();

      if (attempt < maxRetries && breaker.allowRequest()) {
        const delay = calculateBackoff(attempt, backoffConfig);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CircuitOpenError";
  }
}
