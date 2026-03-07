/**
 * ============================================================================
 * Predicate Runtime - Post-Execution Verification Layer
 * ============================================================================
 *
 * ARCHITECTURE: Mathematical State Verification
 *
 * After browser actions execute, we use the Predicate Runtime SDK to
 * VERIFY that the world state matches our expectations before proceeding.
 *
 * This provides defense-in-depth:
 * - Pre-Execution:  Policy check (did we have permission?)
 * - Post-Execution: State verification (did the action achieve its goal?)
 *
 *   ┌─────────────┐
 *   │   Agent     │
 *   │ (OpenClaw)  │
 *   └──────┬──────┘
 *          │ 1. Execute browser action
 *          ▼
 *   ┌─────────────┐
 *   │ Playwright  │ ───▶ DOM changes
 *   └──────┬──────┘
 *          │ 2. Take snapshot
 *          ▼
 *   ┌─────────────────────────────────────────────┐
 *   │           PREDICATE RUNTIME                  │
 *   │  ┌───────────────────────────────────────┐  │
 *   │  │         verify_state()                │  │
 *   │  ├───────────────────────────────────────┤  │
 *   │  │ • url_contains("news.ycombinator")    │  │
 *   │  │ • dom_contains("Show HN")             │  │
 *   │  │ • element_exists("span.titleline")   │  │
 *   │  │ • ML snapshot confidence > 0.8        │  │
 *   │  └───────────────────────────────────────┘  │
 *   │                    │                        │
 *   │         ┌──────────┴──────────┐             │
 *   │         ▼                     ▼             │
 *   │    ┌─────────┐          ┌──────────┐        │
 *   │    │ PASS ✓  │          │ FAIL ✗   │        │
 *   │    │ Continue│          │ Halt/Retry│       │
 *   │    └─────────┘          └──────────┘        │
 *   └─────────────────────────────────────────────┘
 *
 * CRITICAL: The agent MUST pass verification before extracting data.
 * This prevents operating on incorrect/malicious page states.
 */

import type { Page } from "playwright";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface Snapshot {
  /** Current page URL */
  url: string;
  /** Page title */
  title: string;
  /** Simplified DOM tree for element queries */
  elements: SnapshotElement[];
  /** Screenshot as base64 (for ML verification) */
  screenshot_base64?: string;
  /** ML-computed confidence score (0-1) */
  confidence?: number;
  /** Timestamp of snapshot */
  timestamp: string;
  /** Diagnostic info */
  diagnostics?: {
    element_count: number;
    load_time_ms: number;
    captcha_detected?: boolean;
  };
}

export interface SnapshotElement {
  id: number;
  role: string;
  name?: string;
  text?: string;
  selector?: string;
  attributes?: Record<string, string>;
}

export interface VerificationResult {
  /** Overall verification passed */
  passed: boolean;
  /** Individual assertion results */
  assertions: AssertionResult[];
  /** Snapshot used for verification */
  snapshot: Snapshot;
  /** Summary reason for pass/fail */
  reason: string;
}

export interface AssertionResult {
  /** Assertion label */
  label: string;
  /** Whether this assertion passed */
  passed: boolean;
  /** Why it passed/failed */
  reason: string;
  /** Is this assertion required for overall pass? */
  required: boolean;
  /** Additional details */
  details?: Record<string, unknown>;
}

export type Predicate = (snapshot: Snapshot) => AssertionResult;

// ============================================================================
// Predicate Functions (Verification Primitives)
// ============================================================================

/**
 * Verify that the current URL contains a substring.
 */
export function url_contains(substring: string, options: { required?: boolean } = {}): Predicate {
  return (snapshot: Snapshot): AssertionResult => {
    const passed = snapshot.url.includes(substring);
    return {
      label: `url_contains("${substring}")`,
      passed,
      reason: passed
        ? `URL "${snapshot.url}" contains "${substring}"`
        : `URL "${snapshot.url}" does NOT contain "${substring}"`,
      required: options.required ?? true,
      details: { url: snapshot.url, expected: substring },
    };
  };
}

/**
 * Verify that the DOM contains specific text content.
 */
export function dom_contains(text: string, options: { required?: boolean; caseSensitive?: boolean } = {}): Predicate {
  return (snapshot: Snapshot): AssertionResult => {
    const caseSensitive = options.caseSensitive ?? false;
    const searchText = caseSensitive ? text : text.toLowerCase();

    const found = snapshot.elements.some((el) => {
      const elText = el.text || el.name || "";
      const compareText = caseSensitive ? elText : elText.toLowerCase();
      return compareText.includes(searchText);
    });

    return {
      label: `dom_contains("${text}")`,
      passed: found,
      reason: found
        ? `DOM contains text "${text}"`
        : `DOM does NOT contain text "${text}"`,
      required: options.required ?? true,
      details: { searched_text: text, element_count: snapshot.elements.length },
    };
  };
}

/**
 * Verify that an element matching a selector exists.
 */
export function element_exists(selector: string, options: { required?: boolean; minCount?: number } = {}): Predicate {
  return (snapshot: Snapshot): AssertionResult => {
    const minCount = options.minCount ?? 1;

    // Simplified selector matching (in real SDK, this would use CSS/XPath parsing)
    const matches = snapshot.elements.filter((el) => {
      if (selector.startsWith("role=")) {
        return el.role === selector.replace("role=", "");
      }
      if (selector.startsWith(".")) {
        return el.selector?.includes(selector);
      }
      if (selector.startsWith("#")) {
        return el.attributes?.id === selector.replace("#", "");
      }
      // Generic text/name match
      return el.text?.includes(selector) || el.name?.includes(selector) || el.selector?.includes(selector);
    });

    const passed = matches.length >= minCount;

    return {
      label: `element_exists("${selector}")`,
      passed,
      reason: passed
        ? `Found ${matches.length} element(s) matching "${selector}" (required: ${minCount})`
        : `Found ${matches.length} element(s) matching "${selector}" but required ${minCount}`,
      required: options.required ?? true,
      details: { selector, found_count: matches.length, min_count: minCount },
    };
  };
}

/**
 * Verify ML snapshot confidence is above threshold.
 * This uses simulated ML analysis in the demo.
 */
export function confidence_above(threshold: number, options: { required?: boolean } = {}): Predicate {
  return (snapshot: Snapshot): AssertionResult => {
    const confidence = snapshot.confidence ?? 0;
    const passed = confidence >= threshold;

    return {
      label: `confidence_above(${threshold})`,
      passed,
      reason: passed
        ? `ML confidence ${confidence.toFixed(3)} >= ${threshold}`
        : `ML confidence ${confidence.toFixed(3)} < ${threshold} threshold`,
      required: options.required ?? false, // Usually soft assertion
      details: { confidence, threshold },
    };
  };
}

/**
 * Verify page title matches pattern.
 */
export function title_matches(pattern: string | RegExp, options: { required?: boolean } = {}): Predicate {
  return (snapshot: Snapshot): AssertionResult => {
    const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
    const passed = regex.test(snapshot.title);

    return {
      label: `title_matches(${pattern})`,
      passed,
      reason: passed
        ? `Title "${snapshot.title}" matches pattern`
        : `Title "${snapshot.title}" does NOT match pattern`,
      required: options.required ?? true,
      details: { title: snapshot.title, pattern: pattern.toString() },
    };
  };
}

// ============================================================================
// Predicate Runtime Class
// ============================================================================

export class PredicateRuntime {
  private page: Page | null = null;
  private lastSnapshot: Snapshot | null = null;
  private verbose: boolean;

  constructor(options: { verbose?: boolean } = {}) {
    this.verbose = options.verbose ?? true;
  }

  /**
   * Attach runtime to a Playwright page.
   */
  attach(page: Page): void {
    this.page = page;
    this.log("[RUNTIME] Attached to Playwright page");
  }

  /**
   * Take a snapshot of the current page state.
   * In production, this calls the Sentience API for ML-enhanced snapshots.
   * In this demo, we simulate the snapshot locally.
   */
  async snapshot(options: { includeScreenshot?: boolean } = {}): Promise<Snapshot> {
    if (!this.page) {
      throw new Error("PredicateRuntime not attached to a page. Call attach(page) first.");
    }

    this.log("[RUNTIME] Taking snapshot...");

    const url = this.page.url();
    const title = await this.page.title();

    // Extract elements from DOM (simplified)
    const elements = await this.page.evaluate(() => {
      const results: SnapshotElement[] = [];
      let id = 0;

      // Get all visible text elements
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        null,
      );

      while (walker.nextNode()) {
        const el = walker.currentNode as HTMLElement;
        const text = el.textContent?.trim().slice(0, 100) || "";
        const role = el.getAttribute("role") || el.tagName.toLowerCase();

        if (text && el.offsetParent !== null) { // Only visible elements
          results.push({
            id: id++,
            role,
            text,
            name: el.getAttribute("aria-label") || el.getAttribute("title") || undefined,
            selector: el.className ? `.${el.className.split(" ")[0]}` : el.tagName.toLowerCase(),
            attributes: {
              id: el.id || undefined,
              class: el.className || undefined,
              href: (el as HTMLAnchorElement).href || undefined,
            } as Record<string, string>,
          });
        }

        if (results.length >= 200) break; // Limit for performance
      }

      return results;
    });

    // Simulate ML confidence (in production, this comes from Sentience API)
    const confidence = this.simulateMLConfidence(url, elements);

    // Screenshot (optional)
    let screenshot_base64: string | undefined;
    if (options.includeScreenshot) {
      const buffer = await this.page.screenshot({ type: "jpeg", quality: 80 });
      screenshot_base64 = buffer.toString("base64");
    }

    const snapshot: Snapshot = {
      url,
      title,
      elements,
      screenshot_base64,
      confidence,
      timestamp: new Date().toISOString(),
      diagnostics: {
        element_count: elements.length,
        load_time_ms: 0, // Would be measured in production
        captcha_detected: false,
      },
    };

    this.lastSnapshot = snapshot;
    this.log(`[RUNTIME] Snapshot captured: ${elements.length} elements, confidence: ${confidence.toFixed(3)}`);

    return snapshot;
  }

  /**
   * Verify the current page state against a set of predicates.
   *
   * ============================================================
   * POST-EXECUTION VERIFICATION GATE
   * ============================================================
   *
   * This is the CRITICAL verification step that ensures the world
   * state matches our expectations before proceeding to data extraction.
   *
   * @throws Error if any required assertion fails
   */
  async verify_state(...predicates: Predicate[]): Promise<VerificationResult> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[POST-EXECUTION VERIFICATION]`);
    console.log(`${"=".repeat(60)}`);

    // Take fresh snapshot if needed
    const snapshot = this.lastSnapshot || await this.snapshot();

    // Run all predicates
    const assertions: AssertionResult[] = [];
    let allRequiredPassed = true;

    for (const predicate of predicates) {
      const result = predicate(snapshot);
      assertions.push(result);

      const icon = result.passed ? "✓" : "✗";
      const color = result.passed ? "\x1b[32m" : "\x1b[31m";
      const reset = "\x1b[0m";
      const requiredTag = result.required ? "[REQUIRED]" : "[OPTIONAL]";

      console.log(`  ${color}${icon}${reset} ${requiredTag} ${result.label}`);
      console.log(`      ${result.reason}`);

      if (result.required && !result.passed) {
        allRequiredPassed = false;
      }
    }

    const passed = allRequiredPassed;
    const reason = passed
      ? `All ${assertions.filter((a) => a.required).length} required assertions passed`
      : `${assertions.filter((a) => a.required && !a.passed).length} required assertion(s) failed`;

    console.log(`${"=".repeat(60)}`);
    if (passed) {
      console.log(`${"\x1b[42m\x1b[30m"} VERIFICATION PASSED ${"\x1b[0m"} ${reason}`);
    } else {
      console.log(`${"\x1b[41m\x1b[37m"} VERIFICATION FAILED ${"\x1b[0m"} ${reason}`);
    }
    console.log(`${"=".repeat(60)}\n`);

    const result: VerificationResult = {
      passed,
      assertions,
      snapshot,
      reason,
    };

    // CRITICAL: Throw if verification fails
    if (!passed) {
      throw new VerificationError(result);
    }

    return result;
  }

  /**
   * Get the last snapshot without taking a new one.
   */
  getLastSnapshot(): Snapshot | null {
    return this.lastSnapshot;
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Simulate ML confidence score based on page content.
   * In production, this would come from Sentience's ML models.
   */
  private simulateMLConfidence(url: string, elements: SnapshotElement[]): number {
    // Base confidence
    let confidence = 0.5;

    // URL-based heuristics
    if (url.includes("news.ycombinator.com")) {
      confidence += 0.25;
    }
    if (url.startsWith("https://")) {
      confidence += 0.1;
    }

    // Element-based heuristics
    if (elements.length > 10) {
      confidence += 0.1;
    }
    if (elements.some((el) => el.text?.includes("Show HN") || el.text?.includes("Hacker News"))) {
      confidence += 0.15;
    }

    // Clamp to [0, 1]
    return Math.min(1, Math.max(0, confidence));
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }
}

// ============================================================================
// Custom Error for Verification Failures
// ============================================================================

export class VerificationError extends Error {
  readonly result: VerificationResult;

  constructor(result: VerificationResult) {
    const failedAssertions = result.assertions
      .filter((a) => a.required && !a.passed)
      .map((a) => a.label)
      .join(", ");

    super(`Post-execution verification failed: ${failedAssertions}`);
    this.name = "VerificationError";
    this.result = result;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a configured Predicate Runtime instance.
 *
 * @example
 * ```typescript
 * const runtime = createPredicateRuntime({ verbose: true });
 * runtime.attach(page);
 *
 * // Navigate and verify
 * await page.goto("https://news.ycombinator.com/show");
 *
 * // Post-execution verification
 * await runtime.verify_state(
 *   url_contains("news.ycombinator.com"),
 *   dom_contains("Show HN"),
 *   element_exists("span.titleline", { minCount: 3 }),
 * );
 * ```
 */
export function createPredicateRuntime(options?: { verbose?: boolean }): PredicateRuntime {
  return new PredicateRuntime(options);
}
