/**
 * ============================================================================
 * Predicate Sidecar Client - Pre-Execution Authorization Gate
 * ============================================================================
 *
 * ARCHITECTURE: Zero-Trust Execution Proxy (Option A)
 *
 * The agent has ZERO ambient OS privileges. All tool calls are:
 * 1. Intercepted by this client
 * 2. Sent to the Predicate Sidecar as JSON intents
 * 3. Evaluated against policy BEFORE any execution
 * 4. Executed by the sidecar (if allowed) on behalf of the agent
 *
 *   ┌─────────────┐     JSON Intent      ┌─────────────────┐
 *   │   Agent     │ ─────────────────────▶│ Predicate       │
 *   │  (No OS     │  POST /v1/execute    │ Sidecar         │
 *   │  Privileges)│ ◀─────────────────────│ (RTA Proxy)     │
 *   └─────────────┘   Result / Denial     └────────┬────────┘
 *                                                  │ Execute
 *                                                  ▼ (if allowed)
 *                                         ┌─────────────────┐
 *                                         │  OS / Network   │
 *                                         └─────────────────┘
 *
 * CRITICAL: The agent NEVER uses native fs, fetch, or child_process directly.
 * All operations go through this Pre-Execution Gate.
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ExecuteIntent {
  /** Action type: fs.read, fs.write, http.fetch, browser.*, shell.exec */
  action: string;
  /** Target resource: file path, URL, command */
  resource: string;
  /** Agent identity for policy evaluation */
  principal: string;
  /** Additional parameters for the action */
  params?: Record<string, unknown>;
  /** Execution context (step ID, trace ID, etc.) */
  context?: Record<string, unknown>;
}

export interface ExecuteResult {
  /** Whether the action was allowed and executed */
  allowed: boolean;
  /** Result data if action was executed */
  data?: unknown;
  /** Error or denial reason */
  error?: string;
  /** Policy rule that matched (for audit) */
  matched_rule?: string;
  /** Execution duration in ms */
  duration_ms?: number;
}

export interface AuthorizeResult {
  allowed: boolean;
  reason?: string;
  violated_rule?: string;
  mandate_id?: string;
}

// ============================================================================
// Predicate Sidecar Client
// ============================================================================

export class PredicateSidecarClient {
  private readonly sidecarUrl: string;
  private readonly principal: string;
  private readonly verbose: boolean;
  private readonly failClosed: boolean;

  constructor(options: {
    sidecarUrl?: string;
    principal?: string;
    verbose?: boolean;
    failClosed?: boolean;
  } = {}) {
    this.sidecarUrl = options.sidecarUrl || process.env.PREDICATE_SIDECAR_URL || "http://predicate-sidecar:8000";
    this.principal = options.principal || process.env.SECURECLAW_PRINCIPAL || "agent:market-research";
    this.verbose = options.verbose ?? (process.env.SECURECLAW_VERBOSE === "true");
    this.failClosed = options.failClosed ?? true;
  }

  // --------------------------------------------------------------------------
  // Core Methods: Pre-Execution Authorization
  // --------------------------------------------------------------------------

  /**
   * Check if an action is allowed WITHOUT executing it.
   * Use this for policy preview / dry-run scenarios.
   */
  async authorize(intent: Omit<ExecuteIntent, "principal">): Promise<AuthorizeResult> {
    const fullIntent: ExecuteIntent = {
      ...intent,
      principal: this.principal,
    };

    this.log(`[PRE-EXEC] Authorizing: ${intent.action} on ${intent.resource}`);

    try {
      const response = await fetch(`${this.sidecarUrl}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullIntent),
      });

      if (!response.ok) {
        throw new Error(`Sidecar returned ${response.status}: ${await response.text()}`);
      }

      const result = await response.json() as AuthorizeResult;

      if (result.allowed) {
        this.log(`[PRE-EXEC] ✓ ALLOWED: ${intent.action}`);
      } else {
        this.log(`[PRE-EXEC] ✗ DENIED: ${intent.action} - ${result.reason || result.violated_rule}`);
      }

      return result;
    } catch (error) {
      this.log(`[PRE-EXEC] ⚠ ERROR: ${(error as Error).message}`);

      if (this.failClosed) {
        return { allowed: false, reason: `sidecar_unavailable: ${(error as Error).message}` };
      }

      // Fail-open (dangerous, not recommended)
      return { allowed: true, reason: "sidecar_unavailable_fail_open" };
    }
  }

  /**
   * Execute an action through the sidecar's execution proxy.
   * The sidecar checks policy AND executes the action on our behalf.
   *
   * This is the PRIMARY method agents should use - it combines authorization
   * and execution into a single atomic operation.
   */
  async execute(intent: Omit<ExecuteIntent, "principal">): Promise<ExecuteResult> {
    const fullIntent: ExecuteIntent = {
      ...intent,
      principal: this.principal,
      context: {
        ...intent.context,
        timestamp: new Date().toISOString(),
      },
    };

    this.log(`\n${"=".repeat(60)}`);
    this.log(`[PRE-EXECUTION GATE] Action Request`);
    this.log(`${"=".repeat(60)}`);
    this.log(`  Action:    ${intent.action}`);
    this.log(`  Resource:  ${intent.resource}`);
    this.log(`  Principal: ${this.principal}`);
    this.log(`${"=".repeat(60)}\n`);

    const startTime = Date.now();

    try {
      // ======================================================================
      // CRITICAL: All execution goes through the sidecar's /v1/execute endpoint
      // The agent NEVER has direct OS access.
      // ======================================================================
      const response = await fetch(`${this.sidecarUrl}/v1/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullIntent),
      });

      const duration_ms = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();

        // Check if this is a policy denial (4xx) vs server error (5xx)
        if (response.status === 403) {
          const errorJson = JSON.parse(errorText) as { reason?: string; violated_rule?: string };
          this.logDenied(intent.action, errorJson.reason || errorJson.violated_rule || "policy_denied");
          return {
            allowed: false,
            error: errorJson.reason || "Action denied by policy",
            matched_rule: errorJson.violated_rule,
            duration_ms,
          };
        }

        throw new Error(`Sidecar error ${response.status}: ${errorText}`);
      }

      const result = await response.json() as ExecuteResult;
      result.duration_ms = duration_ms;

      if (result.allowed) {
        this.logAllowed(intent.action, duration_ms);
      } else {
        this.logDenied(intent.action, result.error || "unknown");
      }

      return result;
    } catch (error) {
      const duration_ms = Date.now() - startTime;
      this.log(`[PRE-EXEC] ⚠ SIDECAR ERROR: ${(error as Error).message}`);

      if (this.failClosed) {
        return {
          allowed: false,
          error: `sidecar_unavailable: ${(error as Error).message}`,
          duration_ms,
        };
      }

      // This should never happen in production - we fail closed
      throw new Error(`Sidecar unavailable and fail_closed=false is not safe`);
    }
  }

  // --------------------------------------------------------------------------
  // Convenience Methods: Common Actions
  // --------------------------------------------------------------------------

  /**
   * Read a file through the sidecar.
   * Maps to action: fs.read
   */
  async readFile(path: string): Promise<ExecuteResult> {
    return this.execute({
      action: "fs.read",
      resource: path,
      params: { path },
    });
  }

  /**
   * Write content to a file through the sidecar.
   * Maps to action: fs.write
   */
  async writeFile(path: string, content: string): Promise<ExecuteResult> {
    return this.execute({
      action: "fs.write",
      resource: path,
      params: { path, content },
    });
  }

  /**
   * Append content to a file through the sidecar.
   * Maps to action: fs.write with append mode
   */
  async appendFile(path: string, content: string): Promise<ExecuteResult> {
    return this.execute({
      action: "fs.write",
      resource: path,
      params: { path, content, mode: "append" },
    });
  }

  /**
   * Make an HTTP request through the sidecar.
   * Maps to action: http.fetch
   */
  async fetch(url: string, options: RequestInit = {}): Promise<ExecuteResult> {
    return this.execute({
      action: "http.fetch",
      resource: url,
      params: {
        url,
        method: options.method || "GET",
        headers: options.headers,
        body: options.body,
      },
    });
  }

  /**
   * Launch a headless browser through the sidecar.
   * Maps to action: browser.launch
   */
  async launchBrowser(options: { headless?: boolean; browserType?: string } = {}): Promise<ExecuteResult> {
    return this.execute({
      action: "browser.launch",
      resource: "*",
      params: {
        headless: options.headless ?? true,
        browser_type: options.browserType || "chromium",
      },
    });
  }

  /**
   * Navigate browser to URL through the sidecar.
   * Maps to action: browser.navigate
   */
  async navigateTo(url: string): Promise<ExecuteResult> {
    return this.execute({
      action: "browser.navigate",
      resource: url,
      params: { url },
    });
  }

  // --------------------------------------------------------------------------
  // Logging
  // --------------------------------------------------------------------------

  private log(message: string): void {
    if (this.verbose) {
      console.log(`[PredicateSidecar] ${message}`);
    }
  }

  private logAllowed(action: string, durationMs: number): void {
    console.log(`\n┌${"─".repeat(58)}┐`);
    console.log(`│ ${"\x1b[42m\x1b[30m"} PRE-EXECUTION: ALLOWED ${"\x1b[0m"}                               │`);
    console.log(`├${"─".repeat(58)}┤`);
    console.log(`│ Action:   ${action.padEnd(46)} │`);
    console.log(`│ Duration: ${(durationMs + "ms").padEnd(46)} │`);
    console.log(`└${"─".repeat(58)}┘\n`);
  }

  private logDenied(action: string, reason: string): void {
    console.log(`\n┌${"─".repeat(58)}┐`);
    console.log(`│ ${"\x1b[41m\x1b[37m"} PRE-EXECUTION: DENIED ${"\x1b[0m"}                                │`);
    console.log(`├${"─".repeat(58)}┤`);
    console.log(`│ Action:   ${action.padEnd(46)} │`);
    console.log(`│ Reason:   ${reason.slice(0, 46).padEnd(46)} │`);
    console.log(`└${"─".repeat(58)}┘\n`);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a configured Predicate Sidecar Client.
 *
 * @example
 * ```typescript
 * const client = createPredicateClient({
 *   sidecarUrl: "http://predicate-sidecar:8000",
 *   principal: "agent:market-research",
 * });
 *
 * // All actions go through pre-execution authorization
 * const result = await client.writeFile("/data/leads.csv", csvContent);
 * if (!result.allowed) {
 *   console.error("Action blocked:", result.error);
 * }
 * ```
 */
export function createPredicateClient(options?: ConstructorParameters<typeof PredicateSidecarClient>[0]): PredicateSidecarClient {
  return new PredicateSidecarClient(options);
}
