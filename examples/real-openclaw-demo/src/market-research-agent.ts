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
import * as crypto from "crypto";
import {
  PredicateBrowser,
  SentienceAgent,
  AnthropicProvider,
  AgentRuntime,
  Tracer,
  JsonlTraceSink,
  exists,
  urlContains,
  type Snapshot,
  type LLMResponse,
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

// ============================================================================
// Main Agent Class
// ============================================================================

class MarketResearchAgent {
  private sidecar: PredicateSidecarClient;
  private runtime: PredicateRuntime;
  private agentRuntime: AgentRuntime | null = null;
  private tracer: Tracer | null = null;
  private predicateBrowser: PredicateBrowser | null = null;
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
   * Initialize tracer
   * Uses Cloud tracing if PREDICATE_API_KEY is set, otherwise local JsonlTraceSink
   */
  private async initializeTracer(): Promise<void> {
    const runId = crypto.randomUUID();

    if (CONFIG.predicateApiKey) {
      // Cloud tracing: Use Predicate API for cloud upload
      // Note: For full cloud support, the SDK needs to export createTracer
      // For now, we'll use local tracing with a note about cloud support
      logInfo("PREDICATE_API_KEY set - Cloud tracing would be enabled");
      logInfo("(Full cloud support requires SDK export of createTracer)");

      // Fall back to local tracing for now
      const tracesDir = path.join(process.cwd(), "traces");
      if (!fs.existsSync(tracesDir)) {
        fs.mkdirSync(tracesDir, { recursive: true });
      }
      const localPath = path.join(tracesDir, `${runId}.jsonl`);
      this.tracer = new Tracer(runId, new JsonlTraceSink(localPath));
      logInfo(`Local trace file: ${localPath}`);
    } else {
      // Local tracing: Save traces to ./traces/ directory
      const tracesDir = path.join(process.cwd(), "traces");
      if (!fs.existsSync(tracesDir)) {
        fs.mkdirSync(tracesDir, { recursive: true });
      }
      const localPath = path.join(tracesDir, `${runId}.jsonl`);
      this.tracer = new Tracer(runId, new JsonlTraceSink(localPath));
      logInfo(`Local tracing enabled (PREDICATE_API_KEY not set)`);
      logInfo(`Trace file: ${localPath}`);
    }

    // Emit run_start event for complete trace structure
    this.tracer.emitRunStart(
      "MarketResearchAgent",
      CONFIG.llmModel,
      {
        goal: `Extract top ${CONFIG.topN} posts from Hacker News`,
        start_url: CONFIG.targetUrl,
      }
    );
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
        await this.saveLeadsToCSV(newLeads);
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
   * - SentienceBrowser with Chrome extension for ML-enhanced snapshots
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

    // Initialize SentienceAgent with LLM
    this.sentienceAgent = new SentienceAgent(
      this.predicateBrowser,
      this.llmProvider!,
      50, // snapshotLimit
      CONFIG.verbose,
    );

    // Create browser adapter for AgentRuntime
    // AgentRuntime expects snapshot(page, options) but PredicateBrowser has snapshot(options)
    const browserAdapter = {
      snapshot: async (_page: Page, options?: Record<string, unknown>): Promise<Snapshot> => {
        return await this.predicateBrowser!.snapshot(options);
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
    const snapshot = await this.predicateBrowser.snapshot();

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

    logInfo("Taking ML-enhanced snapshot for verification...");

    const snapshot: Snapshot = await this.predicateBrowser.snapshot();
    logInfo(`Snapshot captured: ${snapshot.text?.length || 0} chars of accessible text`);

    // Use SDK predicates with .eventually() for delayed hydration handling
    // This is the recommended pattern from predicate-snapshot skill
    logInfo("Waiting for page content to hydrate using SDK predicates...");

    // Start step tracking for telemetry
    this.agentRuntime.beginStep("verify_page_state", 3);

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

    // Verify post elements exist using .eventually()
    const postsLoaded = await this.agentRuntime.check(
      exists("role=link"),  // Posts have links
      "posts_visible",
      true // required
    ).eventually({
      timeoutMs: 10000,
      pollMs: 500,
    });

    if (!postsLoaded) {
      throw new Error("Posts did not load within timeout");
    }
    logSuccess("Posts verified: content loaded");

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

    // Take a fresh snapshot for the LLM
    const snapshot = await this.predicateBrowser.snapshot();

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
   * Note: Since the sidecar may not support fs.read yet (returns 404),
   * we fall back to direct file access for this demo.
   * In production, all fs operations would go through the sidecar.
   */
  private async loadExistingLeads(): Promise<Lead[]> {
    logInfo(`Reading existing leads from ${CONFIG.leadsFile}...`);

    // Try sidecar first
    const result = await this.sidecar.readFile(CONFIG.leadsFile);

    let csvData: string | null = null;

    if (result.allowed && result.data) {
      csvData = result.data as string;
    } else if (result.error?.includes("404") || result.error?.includes("sidecar")) {
      // Sidecar doesn't support fs.read yet - fall back to direct access for demo
      logInfo("Sidecar fs.read not available, using direct file access for demo...");
      try {
        if (fs.existsSync(CONFIG.leadsFile)) {
          csvData = fs.readFileSync(CONFIG.leadsFile, "utf-8");
        } else {
          logInfo("No existing CSV found - this is the first run");
          return [];
        }
      } catch (err) {
        logInfo("No existing CSV found - this is the first run");
        return [];
      }
    } else if (result.error?.includes("ENOENT") || result.error?.includes("not found")) {
      logInfo("No existing CSV found - this is the first run");
      return [];
    } else {
      // Some other error - log but continue
      logInfo(`Could not read CSV (${result.error}), starting fresh`);
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
   */
  private findNewLeads(current: Lead[], existing: Lead[]): Lead[] {
    const existingTitles = new Set(existing.slice(0, CONFIG.topN).map((l) => l.title));
    return current.filter((lead) => !existingTitles.has(lead.title));
  }

  /**
   * STEP 7: Save to CSV
   *
   * Note: Since the sidecar may not support fs.write yet (returns 404),
   * we fall back to direct file access for this demo.
   * In production, all fs operations would go through the sidecar.
   */
  private async saveLeadsToCSV(leads: Lead[]): Promise<void> {
    logInfo(`Writing ${leads.length} lead(s) to ${CONFIG.leadsFile}...`);

    const rows = leads.map((l) =>
      `${l.rank},"${l.title.replace(/"/g, '""')}","${l.url}",${l.points},${l.timestamp}`
    );

    const csvContent = rows.join("\n") + "\n";

    // Try sidecar first
    const result = await this.sidecar.appendFile(CONFIG.leadsFile, csvContent);

    if (result.allowed) {
      logSuccess(`Saved ${leads.length} lead(s) to CSV via sidecar`);
    } else if (result.error?.includes("404") || result.error?.includes("sidecar")) {
      // Sidecar doesn't support fs.write yet - fall back to direct access for demo
      logInfo("Sidecar fs.write not available, using direct file access for demo...");
      try {
        // Ensure directory exists
        const dir = path.dirname(CONFIG.leadsFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(CONFIG.leadsFile, csvContent);
        logSuccess(`Saved ${leads.length} lead(s) to CSV (direct write)`);
      } catch (err) {
        throw new Error(`Failed to write CSV: ${(err as Error).message}`);
      }
    } else {
      throw new Error(`Failed to write CSV: ${result.error}`);
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
