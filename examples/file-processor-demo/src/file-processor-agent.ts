/**
 * ============================================================================
 * File Processor Agent - Zero-Trust Execution Mode Demo
 * ============================================================================
 *
 * This agent demonstrates the zero-trust execution pattern where:
 *   1. Agent requests authorization from sidecar (/v1/authorize)
 *   2. Sidecar evaluates policy and returns mandate_id if allowed
 *   3. Agent calls /v1/execute with mandate_id - sidecar executes the operation
 *   4. Agent receives result with cryptographic evidence
 *
 * ARCHITECTURE:
 *   Agent → /v1/authorize → Sidecar (policy check, returns mandate_id)
 *       ↓
 *   Agent → /v1/execute → Sidecar (executes operation, returns result)
 *
 * SECURITY: The agent has NO filesystem access. All operations are executed
 * by the sidecar, preventing confused deputy attacks.
 *
 * LLM PROVIDERS:
 *   Supports multiple LLM providers via environment variables:
 *   - Anthropic Claude: Set ANTHROPIC_API_KEY
 *   - OpenAI: Set OPENAI_API_KEY
 *   - Local (Ollama/LM Studio): Set LOCAL_LLM_BASE_URL
 */

import Anthropic from "@anthropic-ai/sdk";

// ============================================================================
// LLM Provider Abstraction
// ============================================================================

interface LLMResponse {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

abstract class LLMProvider {
  abstract get name(): string;
  abstract generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse>;
}

/**
 * Anthropic Claude Provider
 */
class AnthropicProvider extends LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(options: { model?: string } = {}) {
    super();
    this.client = new Anthropic();
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
  }

  get name(): string {
    return `Anthropic (${this.model})`;
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textContent = response.content.find(c => c.type === "text");
    return {
      text: textContent?.text ?? "",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

/**
 * OpenAI Provider
 */
class OpenAIProvider extends LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(options: { model?: string; baseUrl?: string } = {}) {
    super();
    this.apiKey = process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-4o";
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  get name(): string {
    return `OpenAI (${this.model})`;
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/**
 * Local LLM Provider (Ollama, LM Studio, or any OpenAI-compatible API)
 */
class LocalLLMProvider extends LLMProvider {
  private model: string;
  private baseUrl: string;

  constructor(options: { model?: string; baseUrl?: string } = {}) {
    super();
    this.model = options.model ?? process.env.LOCAL_LLM_MODEL ?? "llama3.2";
    this.baseUrl = options.baseUrl ?? process.env.LOCAL_LLM_BASE_URL ?? "http://localhost:11434/v1";
  }

  get name(): string {
    return `Local (${this.model} @ ${this.baseUrl})`;
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1024,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Local LLM API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/**
 * Create LLM provider based on environment variables
 */
function createLLMProvider(): LLMProvider | null {
  const explicitProvider = process.env.LLM_PROVIDER?.toLowerCase();

  if (explicitProvider) {
    switch (explicitProvider) {
      case "anthropic":
      case "claude":
        if (!process.env.ANTHROPIC_API_KEY) {
          console.warn("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY not set");
          return null;
        }
        return new AnthropicProvider();

      case "openai":
      case "gpt":
        if (!process.env.OPENAI_API_KEY) {
          console.warn("LLM_PROVIDER=openai but OPENAI_API_KEY not set");
          return null;
        }
        return new OpenAIProvider();

      case "local":
      case "ollama":
      case "lmstudio":
        return new LocalLLMProvider();

      default:
        console.warn(`Unknown LLM_PROVIDER: ${explicitProvider}`);
        return null;
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider();
  }

  if (process.env.OPENAI_API_KEY) {
    return new OpenAIProvider();
  }

  if (process.env.LOCAL_LLM_BASE_URL) {
    return new LocalLLMProvider();
  }

  return null;
}

// ============================================================================
// Sidecar API Types
// ============================================================================

interface AuthorizeRequest {
  principal: string;
  action: string;
  resource: string;
}

interface AuthorizeResponse {
  allowed: boolean;
  reason?: string;
  mandate_id?: string;
  mandate_token?: string;
  violated_rule?: string;
  matched_rule?: string;
}

interface ExecuteRequest {
  mandate_id: string;
  action: string;
  resource: string;
  payload?: ExecutePayload;
}

type ExecutePayload =
  | { type: "file_write"; content: string; create?: boolean; append?: boolean }
  | { type: "file_delete"; recursive?: boolean }
  | { type: "cli_exec"; command: string; args?: string[]; cwd?: string; timeout_ms?: number }
  | { type: "http_fetch"; method: string; headers?: Record<string, string>; body?: string }
  | { type: "env_read"; keys: string[] };

interface ExecuteResponse {
  success: boolean;
  result?: ExecuteResult;
  error?: string;
  audit_id: string;
  evidence_hash?: string;
}

type ExecuteResult =
  | { type: "file_read"; content: string; size: number; content_hash: string }
  | { type: "file_write"; bytes_written: number; content_hash: string }
  | { type: "file_list"; entries: DirectoryEntry[]; total_entries: number }
  | { type: "file_delete"; paths_removed: number }
  | { type: "cli_exec"; exit_code: number; stdout: string; stderr: string; duration_ms: number }
  | { type: "http_fetch"; status_code: number; headers: Record<string, string>; body: string; body_hash: string }
  | { type: "env_read"; values: Record<string, string> };

interface DirectoryEntry {
  name: string;
  entry_type: string;
  size: number;
  modified?: number;
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  sidecarUrl: process.env.PREDICATE_SIDECAR_URL || "http://predicate-sidecar:8787",
  principal: process.env.SECURECLAW_PRINCIPAL || "agent:file-processor",
  inputDir: "/workspace/input",
  outputDir: "/workspace/output",
  archiveDir: "/workspace/archive",
};

// Terminal colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
  bgBlue: "\x1b[44m",
  bgYellow: "\x1b[43m",
};

// ============================================================================
// Types
// ============================================================================

interface SalesRecord {
  id: string;
  region: string;
  product: string;
  amount: number;
  date: string;
  customer?: string;
}

interface AggregatedSales {
  region: string;
  totalAmount: number;
  recordCount: number;
  products: string[];
  dateRange: { start: string; end: string };
}

interface ProcessingResult {
  inputFiles: string[];
  recordsProcessed: number;
  aggregations: AggregatedSales[];
  outputFile: string;
  archivedFiles: string[];
}

// ============================================================================
// Logging Utilities
// ============================================================================

function logHeader(title: string): void {
  const width = 70;
  console.log("");
  console.log(`${colors.cyan}${"═".repeat(width)}${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset} ${colors.bright}${title}${colors.reset}`);
  console.log(`${colors.cyan}${"═".repeat(width)}${colors.reset}`);
  console.log("");
}

function logStep(step: number, description: string): void {
  console.log(`${colors.bright}[Step ${step}]${colors.reset} ${description}`);
}

function logAuthorize(action: string, resource: string): void {
  console.log(`┌${"─".repeat(62)}┐`);
  console.log(`│ ${colors.bgBlue}${colors.white} AUTHORIZE ${colors.reset} ${action.padEnd(49)} │`);
  console.log(`│ Resource: ${resource.slice(0, 50).padEnd(50)} │`);
  console.log(`└${"─".repeat(62)}┘`);
}

function logExecute(action: string, resource: string, mandateId: string): void {
  console.log(`┌${"─".repeat(62)}┐`);
  console.log(`│ ${colors.bgYellow}${colors.white} EXECUTE ${colors.reset}   ${action.padEnd(49)} │`);
  console.log(`│ Resource: ${resource.slice(0, 50).padEnd(50)} │`);
  console.log(`│ Mandate:  ${mandateId.slice(0, 50).padEnd(50)} │`);
  console.log(`└${"─".repeat(62)}┘`);
}

function logAllowed(mandateId: string): void {
  console.log(`  ${colors.green}✓ ALLOWED${colors.reset} mandate_id: ${mandateId}`);
}

function logDenied(reason: string): void {
  console.log(`  ${colors.red}✗ DENIED: ${reason}${colors.reset}`);
}

function logExecuted(evidenceHash?: string): void {
  console.log(`  ${colors.green}✓ EXECUTED${colors.reset} ${evidenceHash ? `evidence: ${evidenceHash.slice(0, 20)}...` : ""}`);
}

function logSuccess(message: string): void {
  console.log(`  ${colors.green}✓${colors.reset} ${message}`);
}

function logInfo(message: string): void {
  console.log(`  ${colors.dim}→${colors.reset} ${message}`);
}

// ============================================================================
// Sidecar Client (Zero-Trust Execute Mode)
// ============================================================================

class SidecarClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: { baseUrl: string; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  /**
   * Request authorization from sidecar - returns mandate_id if allowed
   */
  async authorize(request: AuthorizeRequest): Promise<AuthorizeResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 403) {
          const errorJson = await response.json() as any;
          return {
            allowed: false,
            reason: errorJson.reason || "policy_denied",
            violated_rule: errorJson.violated_rule,
          };
        }
        throw new Error(`Sidecar returned ${response.status}: ${await response.text()}`);
      }

      const result = await response.json() as any;
      return {
        allowed: result.allowed,
        reason: result.reason,
        mandate_id: result.mandate_id,
        mandate_token: result.mandate_token,
        matched_rule: result.scopes_authorized?.[0]?.matched_rule,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Execute operation through sidecar using mandate_id
   */
  async execute(request: ExecuteRequest): Promise<ExecuteResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      const result = await response.json() as ExecuteResponse;

      if (!response.ok) {
        return {
          success: false,
          error: result.error || `Execute failed with status ${response.status}`,
          audit_id: result.audit_id || "",
        };
      }

      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Authorize and execute in one flow
   */
  async authorizeAndExecute(
    principal: string,
    action: string,
    resource: string,
    payload?: ExecutePayload
  ): Promise<{ authorized: boolean; result?: ExecuteResponse; reason?: string }> {
    // Step 1: Authorize
    logAuthorize(action, resource);

    const authResponse = await this.authorize({ principal, action, resource });

    if (!authResponse.allowed) {
      logDenied(authResponse.reason || "policy_denied");
      return { authorized: false, reason: authResponse.reason };
    }

    if (!authResponse.mandate_id) {
      logDenied("No mandate_id returned (delegation not enabled?)");
      return { authorized: false, reason: "no_mandate_id" };
    }

    logAllowed(authResponse.mandate_id);

    // Step 2: Execute
    logExecute(action, resource, authResponse.mandate_id);

    const execResponse = await this.execute({
      mandate_id: authResponse.mandate_id,
      action,
      resource,
      payload,
    });

    if (execResponse.success) {
      logExecuted(execResponse.evidence_hash);
    } else {
      console.log(`  ${colors.red}✗ EXECUTE FAILED: ${execResponse.error}${colors.reset}`);
    }

    return { authorized: true, result: execResponse };
  }
}

// ============================================================================
// File Processor Agent
// ============================================================================

class FileProcessorAgent {
  private sidecarClient: SidecarClient;
  private llmProvider: LLMProvider | null;

  constructor() {
    this.sidecarClient = new SidecarClient({
      baseUrl: CONFIG.sidecarUrl,
      timeoutMs: 10000,
    });

    this.llmProvider = createLLMProvider();
  }

  /**
   * Main entry point - run the file processing pipeline
   */
  async run(): Promise<void> {
    logHeader("FILE PROCESSOR AGENT - Zero-Trust Execute Mode Demo");

    console.log(`${colors.cyan}Configuration:${colors.reset}`);
    console.log(`  Sidecar URL: ${CONFIG.sidecarUrl}`);
    console.log(`  Principal:   ${CONFIG.principal}`);
    console.log(`  Input Dir:   ${CONFIG.inputDir}`);
    console.log(`  Output Dir:  ${CONFIG.outputDir}`);
    console.log(`  LLM:         ${this.llmProvider ? this.llmProvider.name : "disabled (no provider configured)"}`);
    console.log(`  Mode:        ${colors.bright}Zero-Trust Execute${colors.reset} (sidecar executes all operations)`);
    console.log("");

    try {
      // Step 1: List input files
      logStep(1, "Listing input directory");
      const inputFiles = await this.listDirectory(CONFIG.inputDir);

      if (inputFiles.length === 0) {
        logInfo("No files found in input directory");
        return;
      }

      logSuccess(`Found ${inputFiles.length} files: ${inputFiles.join(", ")}`);
      console.log("");

      // Step 2: Read and parse all input files
      logStep(2, "Reading input files");
      const allRecords: SalesRecord[] = [];

      for (const file of inputFiles) {
        if (!file.endsWith(".json")) continue;

        const filePath = `${CONFIG.inputDir}/${file}`;
        const content = await this.readFile(filePath);

        if (content) {
          try {
            const records = JSON.parse(content) as SalesRecord[];
            allRecords.push(...records);
            logSuccess(`Read ${records.length} records from ${file}`);
          } catch (e) {
            logInfo(`Skipping ${file}: invalid JSON`);
          }
        }
      }
      console.log("");

      // Step 3: Process with LLM (or simple aggregation)
      logStep(3, "Processing data");
      const aggregations = await this.aggregateData(allRecords);
      logSuccess(`Aggregated ${allRecords.length} records into ${aggregations.length} regions`);

      for (const agg of aggregations) {
        logInfo(`${agg.region}: $${agg.totalAmount.toLocaleString()} (${agg.recordCount} records)`);
      }
      console.log("");

      // Step 4: Write output
      logStep(4, "Writing output");
      const outputFile = `${CONFIG.outputDir}/aggregated_sales.json`;
      const outputContent = JSON.stringify({
        generatedAt: new Date().toISOString(),
        totalRecords: allRecords.length,
        aggregations,
      }, null, 2);

      await this.writeFile(outputFile, outputContent);
      logSuccess(`Wrote aggregated results to ${outputFile}`);
      console.log("");

      // Step 5: Archive processed files
      logStep(5, "Archiving processed files");
      const archivedFiles: string[] = [];

      for (const file of inputFiles) {
        if (!file.endsWith(".json")) continue;

        const sourcePath = `${CONFIG.inputDir}/${file}`;
        const archivePath = `${CONFIG.archiveDir}/${file}`;

        const content = await this.readFile(sourcePath);
        if (content) {
          await this.writeFile(archivePath, content);
          archivedFiles.push(file);
        }
      }
      logSuccess(`Archived ${archivedFiles.length} files to ${CONFIG.archiveDir}`);
      console.log("");

      // Step 6: Generate report using shell command
      logStep(6, "Generating report");
      const reportResult = await this.executeCommand("wc", ["-l", `${CONFIG.outputDir}/aggregated_sales.json`]);
      if (reportResult) {
        logSuccess(`Report: ${reportResult.trim()}`);
      }
      console.log("");

      // Step 7: Demonstrate policy denial
      logStep(7, "Attempting unauthorized access (demo)");
      await this.demonstrateDenial();
      console.log("");

      // Summary
      logHeader("AGENT COMPLETED - All operations executed by sidecar");

      const result: ProcessingResult = {
        inputFiles,
        recordsProcessed: allRecords.length,
        aggregations,
        outputFile,
        archivedFiles,
      };

      console.log(`${colors.cyan}Summary:${colors.reset}`);
      console.log(`  Files processed:    ${result.inputFiles.length}`);
      console.log(`  Records aggregated: ${result.recordsProcessed}`);
      console.log(`  Regions:           ${result.aggregations.length}`);
      console.log(`  Output file:        ${result.outputFile}`);
      console.log(`  Archived files:     ${result.archivedFiles.length}`);
      console.log("");
      console.log(`${colors.green}${colors.bright}All operations executed via /v1/execute endpoint.${colors.reset}`);
      console.log(`${colors.dim}Agent had ZERO filesystem access - sidecar executed all operations.${colors.reset}`);

    } catch (error) {
      console.error(`${colors.red}Error: ${(error as Error).message}${colors.reset}`);
      throw error;
    }
  }

  // ==========================================================================
  // File Operations (authorize + execute through sidecar)
  // ==========================================================================

  /**
   * List directory contents via sidecar
   */
  private async listDirectory(dirPath: string): Promise<string[]> {
    const { authorized, result, reason } = await this.sidecarClient.authorizeAndExecute(
      CONFIG.principal,
      "fs.list",
      dirPath
    );

    if (!authorized || !result?.success) {
      logInfo(`Could not list directory: ${reason || result?.error}`);
      return [];
    }

    const listResult = result.result as { type: "file_list"; entries: DirectoryEntry[]; total_entries: number };
    return listResult.entries
      .filter(e => e.entry_type === "file")
      .map(e => e.name);
  }

  /**
   * Read file contents via sidecar
   */
  private async readFile(filePath: string): Promise<string | null> {
    const { authorized, result, reason } = await this.sidecarClient.authorizeAndExecute(
      CONFIG.principal,
      "fs.read",
      filePath
    );

    if (!authorized || !result?.success) {
      logInfo(`Could not read file: ${reason || result?.error}`);
      return null;
    }

    const readResult = result.result as { type: "file_read"; content: string; size: number; content_hash: string };
    logSuccess(`Read ${readResult.size} bytes (hash: ${readResult.content_hash.slice(0, 20)}...)`);
    return readResult.content;
  }

  /**
   * Write file contents via sidecar
   */
  private async writeFile(filePath: string, content: string): Promise<boolean> {
    const { authorized, result, reason } = await this.sidecarClient.authorizeAndExecute(
      CONFIG.principal,
      "fs.write",
      filePath,
      { type: "file_write", content, create: true, append: false }
    );

    if (!authorized || !result?.success) {
      logInfo(`Could not write file: ${reason || result?.error}`);
      return false;
    }

    const writeResult = result.result as { type: "file_write"; bytes_written: number; content_hash: string };
    logSuccess(`Wrote ${writeResult.bytes_written} bytes (hash: ${writeResult.content_hash.slice(0, 20)}...)`);
    return true;
  }

  /**
   * Execute shell command via sidecar
   */
  private async executeCommand(command: string, args: string[]): Promise<string | null> {
    const fullCommand = `${command} ${args.join(" ")}`;

    const { authorized, result, reason } = await this.sidecarClient.authorizeAndExecute(
      CONFIG.principal,
      "cli.exec",
      fullCommand,
      { type: "cli_exec", command, args }
    );

    if (!authorized || !result?.success) {
      logInfo(`Could not execute command: ${reason || result?.error}`);
      return null;
    }

    const execResult = result.result as { type: "cli_exec"; exit_code: number; stdout: string; stderr: string; duration_ms: number };
    return execResult.stdout;
  }

  // ==========================================================================
  // Data Processing
  // ==========================================================================

  private async aggregateData(records: SalesRecord[]): Promise<AggregatedSales[]> {
    const byRegion = new Map<string, SalesRecord[]>();

    for (const record of records) {
      const region = record.region || "Unknown";
      if (!byRegion.has(region)) {
        byRegion.set(region, []);
      }
      byRegion.get(region)!.push(record);
    }

    // LLM analysis if available
    if (this.llmProvider) {
      logInfo(`Using LLM for enhanced analysis (${this.llmProvider.name})...`);
      try {
        const analysis = await this.llmAnalyze(records);
        if (analysis) {
          logInfo("LLM analysis complete");
          logInfo(`LLM insight: ${analysis.slice(0, 100)}...`);
        }
      } catch (e) {
        logInfo("LLM analysis skipped: " + (e as Error).message);
      }
    }

    const aggregations: AggregatedSales[] = [];

    for (const [region, regionRecords] of byRegion) {
      const totalAmount = regionRecords.reduce((sum, r) => sum + (r.amount || 0), 0);
      const products = [...new Set(regionRecords.map(r => r.product).filter(Boolean))];
      const dates = regionRecords.map(r => r.date).filter(Boolean).sort();

      aggregations.push({
        region,
        totalAmount,
        recordCount: regionRecords.length,
        products,
        dateRange: {
          start: dates[0] || "unknown",
          end: dates[dates.length - 1] || "unknown",
        },
      });
    }

    return aggregations.sort((a, b) => b.totalAmount - a.totalAmount);
  }

  private async llmAnalyze(records: SalesRecord[]): Promise<string | null> {
    if (!this.llmProvider) return null;

    const systemPrompt = "You are a sales data analyst. Provide brief, actionable insights.";
    const userPrompt = `Analyze these sales records and provide a brief summary:

${JSON.stringify(records.slice(0, 10), null, 2)}
${records.length > 10 ? `... and ${records.length - 10} more records` : ""}

Provide:
1. Top performing region
2. Most popular product
3. Any notable trends

Keep your response under 200 words.`;

    const response = await this.llmProvider.generate(systemPrompt, userPrompt);
    return response.text;
  }

  // ==========================================================================
  // Security Demonstration
  // ==========================================================================

  private async demonstrateDenial(): Promise<void> {
    logInfo("Attempting to read /etc/passwd (should be denied)...");

    const authResponse = await this.sidecarClient.authorize({
      principal: CONFIG.principal,
      action: "fs.read",
      resource: "/etc/passwd",
    });

    logAuthorize("fs.read", "/etc/passwd");

    if (!authResponse.allowed) {
      logDenied(authResponse.reason || "resource not in authorized scope");
      logSuccess("BLOCKED: Policy enforcement working correctly");
    } else {
      console.log(`  ${colors.yellow}⚠ Unexpected: access was allowed${colors.reset}`);
    }

    // Try writing to unauthorized location
    logInfo("Attempting to write to /tmp/hack.txt (should be denied)...");

    const writeAuth = await this.sidecarClient.authorize({
      principal: CONFIG.principal,
      action: "fs.write",
      resource: "/tmp/hack.txt",
    });

    logAuthorize("fs.write", "/tmp/hack.txt");

    if (!writeAuth.allowed) {
      logDenied(writeAuth.reason || "resource not in authorized scope");
      logSuccess("BLOCKED: Write to unauthorized path prevented");
    } else {
      console.log(`  ${colors.yellow}⚠ Unexpected: access was allowed${colors.reset}`);
    }
  }
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  const agent = new FileProcessorAgent();
  await agent.run();
}

main().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
