#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * Market Research Agent - OpenClaw Demo with LLM
 * ============================================================================
 *
 * This agent demonstrates the complete Predicate Authority architecture:
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                    ZERO-TRUST AI AGENT ARCHITECTURE                     │
 * │                                                                         │
 * │  ┌───────────────┐    ┌─────────────────┐    ┌───────────────────────┐  │
 * │  │   LLM/Agent   │───▶│ PRE-EXECUTION   │───▶│ POST-EXECUTION        │  │
 * │  │   (Claude)    │    │ GATE            │    │ VERIFICATION          │  │
 * │  └───────────────┘    │                 │    │                       │  │
 * │                       │ ┌─────────────┐ │    │ ┌───────────────────┐ │  │
 * │                       │ │ Predicate   │ │    │ │ Predicate Runtime │ │  │
 * │                       │ │ Sidecar     │ │    │ │ SDK               │ │  │
 * │                       │ │ Policy Check│ │    │ │ State Assertions  │ │  │
 * │                       │ └─────────────┘ │    │ └───────────────────┘ │  │
 * │                       │       ↓         │    │          ↓            │  │
 * │                       │  ALLOW / DENY   │    │    PASS / FAIL        │  │
 * │                       └─────────────────┘    └───────────────────────┘  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * GOAL: Navigate to Hacker News, extract top 3 posts, save to CSV
 *
 * FEATURES:
 * - Uses Claude (Anthropic) LLM for intelligent page understanding
 * - SentienceAgent for observe-think-act loop
 * - Pre-execution authorization via Predicate Sidecar
 * - Post-execution verification via Predicate Runtime
 * - ML-enhanced snapshots for compact LLM prompts
 *
 * @requires @predicatesystems/runtime (PredicateBrowser, SentienceAgent, AnthropicProvider)
 * @requires Predicate Sidecar running at http://predicate-sidecar:8000
 * @requires ANTHROPIC_API_KEY environment variable
 */

import type { Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  PredicateBrowser,
  SentienceAgent,
  AnthropicProvider,
  AgentRuntime,
  Tracer,
  createTracer,
  exists,
  urlContains,
  backends,
  type Snapshot,
  type LLMResponse,
  type SnapshotOptions,
} from "@predicatesystems/runtime";
import { PredicateSidecarClient, createPredicateClient } from "./predicate-sidecar-client.js";
import {
  PredicateRuntime,
  createPredicateRuntime,
  url_contains,
  dom_contains,
  element_exists,
  confidence_above,
  VerificationError,
} from "./predicate-runtime.js";

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Target URL
  targetUrl: "https://news.ycombinator.com/show",

  // Output file (ONLY this file is allowed by policy)
  leadsFile: "/data/leads.csv",

  // Sidecar configuration
  sidecarUrl: process.env.PREDICATE_SIDECAR_URL || "http://predicate-sidecar:8000",
  principal: process.env.SECURECLAW_PRINCIPAL || "agent:market-research",

  // Anthropic API Key
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",

  // Predicate API Key (for cloud tracing - uses local tracing if not set)
  predicateApiKey: process.env.PREDICATE_API_KEY || "",

  // LLM Model
  llmModel: process.env.LLM_MODEL || "claude-sonnet-4-20250514",

  // Verbose logging
  verbose: process.env.SECURECLAW_VERBOSE === "true" || true,

  // Number of posts to extract
  topN: 3,

  // Headless mode (always true for container execution)
  headless: true,
};

// ============================================================================
// Terminal Colors
// ============================================================================

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
  bgBlue: "\x1b[44m",
  bgYellow: "\x1b[43m",
};

function logSection(title: string): void {
  console.log("");
  console.log(`${colors.cyan}${"═".repeat(70)}${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset} ${colors.bright}${title}${colors.reset}`);
  console.log(`${colors.cyan}${"═".repeat(70)}${colors.reset}`);
  console.log("");
}

function logStep(step: number, title: string): void {
  console.log(`${colors.blue}[Step ${step}]${colors.reset} ${colors.bright}${title}${colors.reset}`);
}

function logSuccess(message: string): void {
  console.log(`${colors.green}  ✓ ${message}${colors.reset}`);
}

function logError(message: string): void {
  console.log(`${colors.red}  ✗ ${message}${colors.reset}`);
}

function logInfo(message: string): void {
  console.log(`${colors.dim}  → ${message}${colors.reset}`);
}

function logLLM(message: string): void {
  console.log(`${colors.magenta}  🤖 ${message}${colors.reset}`);
}

// ============================================================================
// Lead Data Type
// ============================================================================

interface Lead {
  rank: number;
  title: string;
  url: string;
  points: number;
  timestamp: string;
}

// Extended Snapshot type with text property for LLM use
// The promptBlock from PredicateContext is stored here
interface SnapshotWithText extends Snapshot {
  text?: string;
}

// ============================================================================
// Main Agent Class
// ============================================================================

// Browser-use compatible session wrapper for PredicateContext
// This wraps a Playwright page to provide the getOrCreateCdpSession method
function createBrowserUseSession(page: Page) {
  let cdpSession: any = null;

  return {
    async getOrCreateCdpSession() {
      if (!cdpSession) {
        const context = page.context();
        cdpSession = await context.newCDPSession(page);
      }

      // Create a proxy that matches browser-use's CDP client interface
      const cdpClient = {
        send: new Proxy(
          {},
          {
            get(_target: any, domain: string) {
              return new Proxy(
                {},
                {
                  get(_innerTarget: any, method: string) {
                    return async (options: { params?: unknown; session_id?: string }) => {
                      const fullMethod = `${domain}.${method}`;
                      const result = await cdpSession.send(fullMethod, options.params || {});
                      return result;
                    };
                  },
                }
              );
            },
          }
        ),
      };

      return { cdpClient, sessionId: `playwright-${Date.now()}` };
    },
  };
}

class MarketResearchAgent {
  private sidecar: PredicateSidecarClient;
  private runtime: PredicateRuntime;
  private agentRuntime: AgentRuntime | null = null;
  private tracer: Tracer | null = null;
  private predicateBrowser: PredicateBrowser | null = null;
  private predicateContext: backends.PredicateContext | null = null;
  private browserSession: ReturnType<typeof createBrowserUseSession> | null = null;
  private sentienceAgent: SentienceAgent | null = null;
  private llmProvider: AnthropicProvider | null = null;
  private page: Page | null = null;

  // Token usage tracking
  private tokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  constructor() {
    // Validate Anthropic API Key
    if (!CONFIG.anthropicApiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required.\n" +
        "Get your key from: https://console.anthropic.com/settings/keys"
      );
    }

    // Initialize Pre-Execution Gate (Sidecar Client)
    this.sidecar = createPredicateClient({
      sidecarUrl: CONFIG.sidecarUrl,
      principal: CONFIG.principal,
      verbose: CONFIG.verbose,
      failClosed: true,
    });

    // Initialize Post-Execution Verification (Runtime)
    this.runtime = createPredicateRuntime({
      verbose: CONFIG.verbose,
    });

    // Initialize Anthropic LLM Provider
    this.llmProvider = new AnthropicProvider(CONFIG.anthropicApiKey, CONFIG.llmModel);
    logInfo(`LLM Provider initialized: ${CONFIG.llmModel}`);
  }

  /**
   * Track token usage from LLM response
   */
  private trackTokenUsage(response: LLMResponse): void {
    if (response.promptTokens) {
      this.tokenUsage.promptTokens += response.promptTokens;
    }
    if (response.completionTokens) {
      this.tokenUsage.completionTokens += response.completionTokens;
    }
    if (response.totalTokens) {
      this.tokenUsage.totalTokens += response.totalTokens;
    }
  }

  /**
   * Take ML-enhanced snapshot using PredicateContext (predicate-snapshot skill pattern)
   * This uses CDP directly and doesn't require the Chrome extension
   *
   * @param options - SnapshotOptions for screenshot, use_api, etc.
   * @returns SnapshotWithText - Snapshot with text property for LLM use
   */
  private async takeMLSnapshot(options: SnapshotOptions = {}): Promise<SnapshotWithText> {
    // Default options for cloud tracing: include screenshot
    const snapshotOptions: SnapshotOptions = {
      screenshot: options.screenshot ?? { format: "jpeg", quality: 80 },
      use_api: options.use_api ?? true,
      limit: options.limit ?? 50,
      ...options,
    };

    if (this.predicateContext && this.browserSession) {
      try {
        const result = await this.predicateContext.build(this.browserSession);

        // SentienceContextState has: { url, snapshot, promptBlock }
        // The snapshot property contains the full Snapshot with elements
        const hasContent = result && (result.promptBlock || result.snapshot?.elements?.length);

        if (!hasContent) {
          logError("ML snapshot returned empty content, falling back to local");
          throw new Error("Empty ML snapshot");
        }

        // Return the snapshot from result, with text set to promptBlock for LLM use
        // Also take a screenshot using PredicateBrowser if requested
        let screenshotData: string | undefined;
        if (snapshotOptions.screenshot && this.predicateBrowser) {
          try {
            const browserSnap = await this.predicateBrowser.snapshot(snapshotOptions);
            screenshotData = browserSnap.screenshot;
          } catch {
            // Screenshot is optional - continue without it
          }
        }

        const snapshot: SnapshotWithText = {
          ...result.snapshot,
          text: result.promptBlock || "",
          screenshot: screenshotData,
          screenshot_format: screenshotData ? "jpeg" : undefined,
        };

        return snapshot;
      } catch (error) {
        logError(`ML snapshot failed: ${(error as Error).message}, falling back to local`);
      }
    }

    // Fallback to PredicateBrowser snapshot (local, no ML) with screenshot options
    if (this.predicateBrowser) {
      const snap = await this.predicateBrowser.snapshot(snapshotOptions);
      // Convert elements to text for LLM use
      const text = snap.elements?.map((el: { text?: string; aria_label?: string }) =>
        el.text || el.aria_label || ""
      ).filter(Boolean).join("\n") || "";
      return { ...snap, text };
    }

    throw new Error("No snapshot method available");
  }

  /**
   * Initialize tracer using SDK's createTracer factory
   * Automatically handles Cloud vs Local tracing based on PREDICATE_API_KEY
   */
  private async initializeTracer(): Promise<void> {
    // Use SDK's createTracer which handles cloud init, fallback, and run_start emission
    this.tracer = await createTracer({
      apiKey: CONFIG.predicateApiKey || undefined,
      goal: `Extract top ${CONFIG.topN} posts from Hacker News`,
      agentType: "MarketResearchAgent",
      llmModel: CONFIG.llmModel,
      startUrl: CONFIG.targetUrl,
      autoEmitRunStart: true, // SDK auto-emits run_start with metadata
    });

    logSuccess(`Tracer initialized (Run ID: ${this.tracer.runId})`);
  }

  // --------------------------------------------------------------------------
  // Main Execution Flow
  // --------------------------------------------------------------------------

  async run(): Promise<void> {
    logSection("MARKET RESEARCH AGENT - Zero-Trust Demo with LLM");

    console.log(`${colors.dim}Configuration:${colors.reset}`);
    console.log(`  Target:    ${CONFIG.targetUrl}`);
    console.log(`  Output:    ${CONFIG.leadsFile}`);
    console.log(`  Sidecar:   ${CONFIG.sidecarUrl}`);
    console.log(`  Principal: ${CONFIG.principal}`);
    console.log(`  LLM:       ${CONFIG.llmModel}`);
    console.log(`  Headless:  ${CONFIG.headless}`);
    console.log("");

    try {
      // ======================================================================
      // Initialize Tracer (Cloud if API key set, Local otherwise)
      // ======================================================================
      logInfo("Initializing tracer...");
      await this.initializeTracer();

      // ======================================================================
      // STEP 1: Launch Browser (Pre-Execution Gate)
      // ======================================================================
      logStep(1, "Launching headless browser with LLM agent");
      await this.launchBrowser();

      // ======================================================================
      // STEP 2: Navigate to Hacker News using LLM Agent
      // ======================================================================
      logStep(2, "Navigating to Hacker News Show HN (LLM-guided)");
      await this.navigateToTarget();

      // ======================================================================
      // STEP 3: Verify Page State (Post-Execution Verification)
      // ======================================================================
      logStep(3, "Verifying page state before extraction");
      await this.verifyPageState();

      // ======================================================================
      // STEP 4: Extract Top Posts using LLM
      // ======================================================================
      logStep(4, `Extracting top ${CONFIG.topN} posts (LLM-assisted)`);
      const leads = await this.extractLeadsWithLLM();

      // ======================================================================
      // STEP 5: Load Existing Leads (Pre-Execution Gate)
      // ======================================================================
      logStep(5, "Loading existing leads from CSV");
      const existingLeads = await this.loadExistingLeads();

      // ======================================================================
      // STEP 6: Check for New Leads
      // ======================================================================
      logStep(6, "Checking for new/changed leads");
      const newLeads = this.findNewLeads(leads, existingLeads);

      if (newLeads.length === 0) {
        logInfo("No new leads found - top 3 posts are the same as last run");
        logInfo("Skipping CSV update");
      } else {
        logSuccess(`Found ${newLeads.length} new lead(s)!`);

        // ==================================================================
        // STEP 7: Save to CSV (Pre-Execution Gate)
        // ==================================================================
        logStep(7, "Saving leads to CSV (Pre-Execution Gate)");
        // Pass current leads + existing leads for deduplication and merge
        await this.saveLeadsToCSV(leads, existingLeads);
      }

      // ======================================================================
      // STEP 8: Cleanup
      // ======================================================================
      logStep(8, "Cleanup");
      await this.cleanup();

      logSection("AGENT COMPLETED SUCCESSFULLY");

      // Print token usage stats
      console.log(`${colors.dim}Token Usage (LLM calls):${colors.reset}`);
      console.log(`  Prompt tokens:     ${this.tokenUsage.promptTokens}`);
      console.log(`  Completion tokens: ${this.tokenUsage.completionTokens}`);
      console.log(`  Total tokens:      ${this.tokenUsage.totalTokens}`);

      // Print tracer info
      if (this.tracer) {
        console.log(`${colors.dim}Tracer:${colors.reset}`);
        console.log(`  Run ID: ${this.tracer.runId}`);
        if (CONFIG.predicateApiKey) {
          console.log(`  Mode: Cloud (uploaded to Predicate Studio)`);
        } else {
          console.log(`  Mode: Local (saved to ./traces/)`);
        }
      }
    } catch (error) {
      if (error instanceof VerificationError) {
        logError(`Post-Execution Verification Failed: ${error.message}`);
        console.log("\nFailed assertions:");
        for (const assertion of error.result.assertions.filter((a) => !a.passed)) {
          console.log(`  - ${assertion.label}: ${assertion.reason}`);
        }
      } else {
        logError(`Agent Error: ${(error as Error).message}`);
        console.error(error);
      }

      await this.cleanup();
      process.exit(1);
    }
  }

  // --------------------------------------------------------------------------
  // Step Implementations
  // --------------------------------------------------------------------------

  /**
   * STEP 1: Launch Browser with LLM Agent
   *
   * PRE-EXECUTION GATE:
   * - Action: browser.launch
   * - Policy: allow-browser-launch (requires headless: true)
   *
   * Initializes:
   * - PredicateBrowser with Chrome extension for ML-enhanced snapshots
   * - SentienceAgent with AnthropicProvider for LLM-driven automation
   */
  private async launchBrowser(): Promise<void> {
    logInfo("Requesting browser launch through Pre-Execution Gate...");

    // Pre-execution authorization
    const authResult = await this.sidecar.authorize({
      action: "browser.launch",
      resource: "*",
      params: { headless: CONFIG.headless, browser_type: "chromium" },
    });

    if (!authResult.allowed) {
      throw new Error(`Browser launch denied: ${authResult.reason}`);
    }

    logSuccess("Browser launch AUTHORIZED by policy");

    // Launch PredicateBrowser with Chrome extension
    // Pass PREDICATE_API_KEY to enable ML-enhanced snapshots (predicate-snapshot skill pattern)
    this.predicateBrowser = new PredicateBrowser(
      CONFIG.predicateApiKey || undefined, // apiKey for ML-enhanced snapshots
      undefined, // apiUrl (uses default)
      CONFIG.headless,
    );

    if (CONFIG.predicateApiKey) {
      logInfo("ML-enhanced snapshots enabled (PREDICATE_API_KEY set)");
    } else {
      logInfo("Using local snapshots (PREDICATE_API_KEY not set)");
    }

    await this.predicateBrowser.start();
    this.page = this.predicateBrowser.getPage();

    if (!this.page) {
      throw new Error("Failed to get page from PredicateBrowser");
    }

    // Initialize PredicateContext for ML-enhanced snapshots (predicate-snapshot skill pattern)
    // This uses CDP directly and doesn't require the Chrome extension
    if (CONFIG.predicateApiKey) {
      this.browserSession = createBrowserUseSession(this.page);
      this.predicateContext = new backends.PredicateContext({
        predicateApiKey: CONFIG.predicateApiKey,
        topElementSelector: {
          byImportance: 50,
          fromDominantGroup: 15,
          byPosition: 10,
        },
      });
      logInfo("PredicateContext initialized for ML-enhanced snapshots");
    }

    // Initialize SentienceAgent with LLM
    this.sentienceAgent = new SentienceAgent(
      this.predicateBrowser,
      this.llmProvider!,
      50, // snapshotLimit
      CONFIG.verbose,
    );

    // Create browser adapter for AgentRuntime
    // Use ML-enhanced snapshot if available, otherwise fall back to PredicateBrowser
    // Pass through SnapshotOptions for screenshot, use_api, etc.
    const browserAdapter = {
      snapshot: async (_page: Page, options?: SnapshotOptions): Promise<Snapshot> => {
        return await this.takeMLSnapshot(options);
      },
    };

    // Initialize AgentRuntime with tracer for SDK-based verification
    if (!this.tracer) {
      throw new Error("Tracer not initialized - call initializeTracer() first");
    }
    this.agentRuntime = new AgentRuntime(browserAdapter, this.page, this.tracer);

    // Attach legacy runtime to page for verification
    this.runtime.attach(this.page);

    logSuccess("PredicateBrowser launched with Chrome extension (headless mode)");
    logSuccess(`SentienceAgent initialized with ${CONFIG.llmModel}`);
    logSuccess(`AgentRuntime initialized with Cloud Tracer`);
  }

  /**
   * STEP 2: Navigate to Target using LLM Agent
   *
   * PRE-EXECUTION GATE:
   * - Action: browser.navigate
   * - Policy: allow-research-sites
   *
   * Uses SentienceAgent.act() for LLM-driven navigation
   */
  private async navigateToTarget(): Promise<void> {
    if (!this.predicateBrowser || !this.page || !this.sentienceAgent) {
      throw new Error("Browser/Agent not initialized");
    }

    logInfo(`Requesting navigation to ${CONFIG.targetUrl}...`);

    // Pre-execution authorization
    const authResult = await this.sidecar.authorize({
      action: "browser.navigate",
      resource: CONFIG.targetUrl,
    });

    if (!authResult.allowed) {
      throw new Error(`Navigation denied: ${authResult.reason}`);
    }

    logSuccess("Navigation AUTHORIZED by policy");

    // Navigate using PredicateBrowser
    await this.predicateBrowser.goto(CONFIG.targetUrl);
    await this.page.waitForTimeout(1000);

    logSuccess(`Navigated to ${this.page.url()}`);

    // Use LLM to verify we're on the right page
    logLLM("Asking LLM to verify page content...");
    const snapshot = await this.takeMLSnapshot();

    const verifyResponse = await this.llmProvider!.generate(
      "You are a web page analyzer. Respond with JSON only.",
      `Analyze this page snapshot and confirm if this is the Hacker News "Show HN" page.

Page URL: ${this.page.url()}
Page content (first 2000 chars): ${snapshot.text?.slice(0, 2000) || "No text content"}

Respond with JSON: {"isShowHN": true/false, "reason": "brief explanation"}`,
      { max_tokens: 200 }
    );

    // Track token usage
    this.trackTokenUsage(verifyResponse);

    logLLM(`LLM Response: ${verifyResponse.content.slice(0, 100)}...`);
  }

  /**
   * STEP 3: Verify Page State
   *
   * POST-EXECUTION VERIFICATION using SDK predicates with .eventually() pattern
   * This handles delayed hydration common in modern SPAs
   */
  private async verifyPageState(): Promise<void> {
    if (!this.predicateBrowser || !this.page || !this.agentRuntime) {
      throw new Error("Browser not initialized");
    }

    // Start step tracking for telemetry BEFORE taking snapshot
    this.agentRuntime.beginStep("verify_page_state", 3);

    logInfo("Taking ML-enhanced snapshot with screenshot for verification...");

    // Use agentRuntime.snapshot() which auto-emits trace events with screenshot
    // This enables Studio visualization with screenshot_base64
    const snapshot: Snapshot = await this.agentRuntime.snapshot({
      screenshot: { format: "jpeg", quality: 80 },
      use_api: true,
      limit: 50,
      emitTrace: true, // Auto-emit snapshot trace event for Studio
    });
    logInfo(`Snapshot captured: ${snapshot.elements?.length || 0} elements, screenshot: ${snapshot.screenshot ? "yes" : "no"}`);

    // Use SDK predicates with .eventually() for delayed hydration handling
    // This is the recommended pattern from predicate-snapshot skill
    logInfo("Waiting for page content to hydrate using SDK predicates...");

    // Verify URL contains expected domain using .eventually()
    const urlValid = await this.agentRuntime.check(
      urlContains("news.ycombinator.com"),
      "url_contains_hackernews",
      true // required
    ).eventually({
      timeoutMs: 10000,
      pollMs: 500,
    });

    if (!urlValid) {
      throw new Error("URL verification failed - not on Hacker News");
    }
    logSuccess("URL verified: news.ycombinator.com");

    // Verify page has interactive elements using .eventually()
    // Use clickable=true since ML snapshot captures clickable elements
    const postsLoaded = await this.agentRuntime.check(
      exists("clickable=true"),  // Page has clickable elements (links, buttons)
      "interactive_elements_visible",
      true // required
    ).eventually({
      timeoutMs: 10000,
      pollMs: 500,
    });

    if (!postsLoaded) {
      throw new Error("Interactive elements did not load within timeout");
    }
    logSuccess("Interactive elements verified: content loaded");

    // Also run legacy runtime verification for comparison
    await this.runtime.snapshot({ includeScreenshot: false });

    await this.runtime.verify_state(
      url_contains("news.ycombinator.com", { required: true }),
      dom_contains("Show", { required: true }),
      element_exists("titleline", { required: true, minCount: 3 }),
      confidence_above(0.7, { required: false }),
    );

    logSuccess("Page state VERIFIED - safe to extract data");
  }

  /**
   * STEP 4: Extract Leads using LLM
   *
   * Uses the LLM to intelligently parse and extract post information
   * Integrates with AgentRuntime for step tracking and telemetry
   */
  private async extractLeadsWithLLM(): Promise<Lead[]> {
    if (!this.page || !this.predicateBrowser || !this.llmProvider || !this.agentRuntime) {
      throw new Error("Browser/LLM not initialized");
    }

    // Start step tracking for telemetry
    this.agentRuntime.beginStep("extract_leads", 4);

    logInfo(`Asking LLM to extract top ${CONFIG.topN} posts...`);

    // Take a fresh ML-enhanced snapshot for the LLM
    const snapshot = await this.takeMLSnapshot();

    // Ask LLM to extract structured data
    const extractPrompt = `You are a data extraction assistant. Extract the top ${CONFIG.topN} posts from this Hacker News "Show HN" page.

Page content:
${snapshot.text?.slice(0, 8000) || "No content available"}

Extract the top ${CONFIG.topN} posts and return them as a JSON array with this structure:
[
  {
    "rank": 1,
    "title": "Post title here",
    "url": "https://example.com",
    "points": 123
  }
]

IMPORTANT:
- Only include "Show HN" posts if visible
- Extract the actual URLs from the posts
- Include the point count for each post
- Return ONLY the JSON array, no other text`;

    logLLM("Sending extraction request to Claude...");

    const response = await this.llmProvider.generate(
      "You are a precise data extraction assistant. Return only valid JSON.",
      extractPrompt,
      { max_tokens: 1000 }
    );

    // Track token usage
    this.trackTokenUsage(response);

    logLLM(`LLM used ${response.totalTokens || 0} tokens for extraction`);

    // Parse the LLM response
    let extractedLeads: Lead[] = [];
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        extractedLeads = parsed.map((item: any, index: number) => ({
          rank: item.rank || index + 1,
          title: item.title || "Unknown",
          url: item.url || "",
          points: item.points || 0,
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (parseError) {
      logError(`Failed to parse LLM response: ${(parseError as Error).message}`);
      logInfo("Falling back to DOM extraction...");
      return this.extractLeadsFromDOM();
    }

    // Log extracted leads
    for (const lead of extractedLeads) {
      logSuccess(`#${lead.rank}: "${lead.title.slice(0, 50)}..." (${lead.points} points)`);
    }

    // If LLM extraction failed, fall back to DOM
    if (extractedLeads.length === 0) {
      logInfo("LLM extraction returned empty, falling back to DOM...");
      return this.extractLeadsFromDOM();
    }

    return extractedLeads;
  }

  /**
   * Fallback: Extract leads directly from DOM
   */
  private async extractLeadsFromDOM(): Promise<Lead[]> {
    if (!this.page) throw new Error("Browser not initialized");

    logInfo(`Extracting top ${CONFIG.topN} posts from DOM...`);

    const leads = await this.page.evaluate((topN: number) => {
      const results: Lead[] = [];
      const rows = document.querySelectorAll("tr.athing");

      for (let i = 0; i < Math.min(topN, rows.length); i++) {
        const row = rows[i];
        const titleLink = row.querySelector(".titleline > a") as HTMLAnchorElement;
        const subtext = row.nextElementSibling?.querySelector(".subtext");
        const scoreSpan = subtext?.querySelector(".score");

        if (titleLink) {
          results.push({
            rank: i + 1,
            title: titleLink.textContent?.trim() || "Unknown",
            url: titleLink.href,
            points: parseInt(scoreSpan?.textContent || "0") || 0,
            timestamp: new Date().toISOString(),
          });
        }
      }

      return results;
    }, CONFIG.topN);

    for (const lead of leads) {
      logSuccess(`#${lead.rank}: "${lead.title.slice(0, 50)}..." (${lead.points} points)`);
    }

    return leads;
  }

  /**
   * STEP 5: Load Existing Leads
   *
   * ZERO-TRUST ARCHITECTURE:
   * 1. Request authorization from sidecar via /authorize
   * 2. If ALLOWED, execute locally (sidecar is authorize-only mode)
   * 3. If DENIED or sidecar unavailable, FAIL CLOSED - no fallback
   */
  private async loadExistingLeads(): Promise<Lead[]> {
    logInfo(`Reading existing leads from ${CONFIG.leadsFile}...`);

    // Step 1: Request authorization from sidecar
    const authResult = await this.sidecar.readFile(CONFIG.leadsFile);

    // Step 2: Check authorization result - FAIL CLOSED
    if (!authResult.allowed) {
      // Check if file doesn't exist (expected on first run)
      if (authResult.error?.includes("ENOENT") || authResult.error?.includes("not found")) {
        logInfo("No existing CSV found - this is the first run");
        return [];
      }
      // Policy denial or sidecar error - FAIL CLOSED
      throw new Error(`[ZERO-TRUST] File read DENIED: ${authResult.error}`);
    }

    // Step 3: Authorization granted - execute locally
    logSuccess("File read AUTHORIZED by policy");

    let csvData: string;
    try {
      if (!fs.existsSync(CONFIG.leadsFile)) {
        logInfo("No existing CSV found - this is the first run");
        return [];
      }
      csvData = fs.readFileSync(CONFIG.leadsFile, "utf-8");
    } catch (err) {
      // File read error after authorization - this is an OS error, not policy
      logInfo(`File read error: ${(err as Error).message}`);
      return [];
    }

    if (!csvData || csvData.trim() === "") {
      return [];
    }

    const lines = csvData.trim().split("\n");
    if (lines.length <= 1) {
      return [];
    }

    const leads: Lead[] = [];
    for (let i = 1; i < lines.length; i++) {
      const [rank, title, url, points, timestamp] = lines[i].split(",").map((s) => s.trim());
      if (title) {
        leads.push({
          rank: parseInt(rank) || i,
          title: title.replace(/^"|"$/g, ""),
          url: url?.replace(/^"|"$/g, "") || "",
          points: parseInt(points) || 0,
          timestamp: timestamp || "",
        });
      }
    }

    logSuccess(`Loaded ${leads.length} existing lead(s)`);
    return leads;
  }

  /**
   * STEP 6: Find New Leads
   * Compare by URL (more stable than titles, which LLMs may truncate)
   */
  private findNewLeads(current: Lead[], existing: Lead[]): Lead[] {
    // Normalize URLs for comparison (remove trailing slashes, etc.)
    const normalizeUrl = (url: string) => url.replace(/\/+$/, "").toLowerCase();
    const existingUrls = new Set(existing.map((l) => normalizeUrl(l.url)));
    return current.filter((lead) => !existingUrls.has(normalizeUrl(lead.url)));
  }

  /**
   * STEP 7: Save to CSV
   *
   * ZERO-TRUST ARCHITECTURE:
   * 1. Request authorization from sidecar via /authorize
   * 2. If ALLOWED, execute locally (sidecar is authorize-only mode)
   * 3. If DENIED or sidecar unavailable, FAIL CLOSED - no fallback
   *
   * NOTE: This writes the full file (not append) to avoid duplicates.
   * New leads are merged with existing leads, deduplicated by URL.
   */
  private async saveLeadsToCSV(newLeads: Lead[], existingLeads: Lead[] = []): Promise<void> {
    // Merge new leads with existing, keeping new leads first (they're the current top N)
    // Deduplicate by URL
    const normalizeUrl = (url: string) => url.replace(/\/+$/, "").toLowerCase();
    const seenUrls = new Set<string>();
    const allLeads: Lead[] = [];

    // Add new leads first
    for (const lead of newLeads) {
      const normUrl = normalizeUrl(lead.url);
      if (!seenUrls.has(normUrl)) {
        seenUrls.add(normUrl);
        allLeads.push(lead);
      }
    }

    // Add existing leads that aren't duplicates
    for (const lead of existingLeads) {
      const normUrl = normalizeUrl(lead.url);
      if (!seenUrls.has(normUrl)) {
        seenUrls.add(normUrl);
        allLeads.push(lead);
      }
    }

    logInfo(`Writing ${allLeads.length} total lead(s) to ${CONFIG.leadsFile} (${newLeads.length} new)...`);

    // Format CSV with header
    const header = "rank,title,url,points,timestamp";
    const rows = allLeads.map((l) =>
      `${l.rank},"${l.title.replace(/"/g, '""')}","${l.url}",${l.points},${l.timestamp}`
    );
    const csvContent = header + "\n" + rows.join("\n") + "\n";

    // Step 1: Request authorization from sidecar
    const authResult = await this.sidecar.writeFile(CONFIG.leadsFile, csvContent);

    // Step 2: Check authorization result - FAIL CLOSED
    if (!authResult.allowed) {
      throw new Error(`[ZERO-TRUST] File write DENIED: ${authResult.error}`);
    }

    // Step 3: Authorization granted - execute locally
    logSuccess("File write AUTHORIZED by policy");

    try {
      // Ensure directory exists
      const dir = path.dirname(CONFIG.leadsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CONFIG.leadsFile, csvContent);
      logSuccess(`Saved ${allLeads.length} lead(s) to CSV`);
    } catch (err) {
      throw new Error(`File write failed after authorization: ${(err as Error).message}`);
    }

    // Demo: Show policy enforcement for unauthorized write
    logInfo("Demo: Attempting unauthorized write to /etc/passwd...");
    const unauthorizedResult = await this.sidecar.writeFile("/etc/passwd", "hacked");
    if (!unauthorizedResult.allowed) {
      logSuccess(`BLOCKED by policy: ${unauthorizedResult.error}`);
    }
  }

  /**
   * STEP 8: Cleanup
   */
  private async cleanup(): Promise<void> {
    if (this.predicateBrowser) {
      await this.predicateBrowser.close();
      logSuccess("PredicateBrowser closed");
    }

    // Close tracer (uploads to cloud if cloud tracing is enabled)
    if (this.tracer) {
      await this.tracer.close();
      logSuccess("Tracer closed" + (CONFIG.predicateApiKey ? " (trace uploaded to cloud)" : ""));
    }
  }
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.log(`
${colors.bright}${colors.magenta}
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   ██████╗ ██████╗ ███████╗██████╗ ██╗ ██████╗ █████╗ ████████╗███████╗   ║
║   ██╔══██╗██╔══██╗██╔════╝██╔══██╗██║██╔════╝██╔══██╗╚══██╔══╝██╔════╝   ║
║   ██████╔╝██████╔╝█████╗  ██║  ██║██║██║     ███████║   ██║   █████╗     ║
║   ██╔═══╝ ██╔══██╗██╔══╝  ██║  ██║██║██║     ██╔══██║   ██║   ██╔══╝     ║
║   ██║     ██║  ██║███████╗██████╔╝██║╚██████╗██║  ██║   ██║   ███████╗   ║
║   ╚═╝     ╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝ ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝   ║
║                                                                           ║
║   Zero-Trust AI Agent with Claude LLM                                     ║
║   Pre-Execution Gate + Post-Execution Verification                        ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
${colors.reset}`);

  const agent = new MarketResearchAgent();
  await agent.run();
}

// Run the agent
main().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
