/**
 * ============================================================================
 * KIRO REENACTMENT - Amazon Infrastructure Deletion Incident Demo
 * ============================================================================
 *
 * This demo reenacts the Amazon "Kiro" infrastructure deletion incident where
 * an AI agent, when facing a corrupted Terraform state, decided to execute
 * `terraform destroy -auto-approve` as a "standard operating procedure."
 *
 * SCENARIO:
 *   1. An operator agent (kiro-operator) is tasked with fixing a Terraform error
 *   2. The agent gets stuck in a loop and decides to delete/recreate the environment
 *   3. The Predicate Authority sidecar intercepts the destructive command
 *   4. The execution is BLOCKED at the OS-level, preventing catastrophe
 *
 * ARCHITECTURE:
 *   Agent → /v1/authorize → Sidecar (policy check)
 *       ↓
 *   DENIED: terraform destroy not allowed
 *       ↓
 *   Environment deletion PREVENTED
 *
 * This demo uses striking terminal output for video recording purposes.
 */

import Anthropic from "@anthropic-ai/sdk";

// ============================================================================
// Chalk-like Terminal Styling (built-in for zero dependencies)
// ============================================================================

const chalk = {
  // Basic colors
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  magenta: (text: string) => `\x1b[35m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  white: (text: string) => `\x1b[37m${text}\x1b[0m`,
  gray: (text: string) => `\x1b[90m${text}\x1b[0m`,

  // Bold variants
  bold: {
    red: (text: string) => `\x1b[1m\x1b[31m${text}\x1b[0m`,
    green: (text: string) => `\x1b[1m\x1b[32m${text}\x1b[0m`,
    yellow: (text: string) => `\x1b[1m\x1b[33m${text}\x1b[0m`,
    blue: (text: string) => `\x1b[1m\x1b[34m${text}\x1b[0m`,
    magenta: (text: string) => `\x1b[1m\x1b[35m${text}\x1b[0m`,
    cyan: (text: string) => `\x1b[1m\x1b[36m${text}\x1b[0m`,
    white: (text: string) => `\x1b[1m\x1b[37m${text}\x1b[0m`,
  },

  // Background colors
  bgRed: (text: string) => `\x1b[41m${text}\x1b[0m`,
  bgGreen: (text: string) => `\x1b[42m${text}\x1b[0m`,
  bgYellow: (text: string) => `\x1b[43m${text}\x1b[0m`,
  bgBlue: (text: string) => `\x1b[44m${text}\x1b[0m`,
  bgMagenta: (text: string) => `\x1b[45m${text}\x1b[0m`,
  bgCyan: (text: string) => `\x1b[46m${text}\x1b[0m`,
  bgWhite: (text: string) => `\x1b[47m${text}\x1b[0m`,

  // Combinations
  redBold: (text: string) => `\x1b[1m\x1b[31m${text}\x1b[0m`,
  yellowBold: (text: string) => `\x1b[1m\x1b[33m${text}\x1b[0m`,
  greenBold: (text: string) => `\x1b[1m\x1b[32m${text}\x1b[0m`,
  cyanBold: (text: string) => `\x1b[1m\x1b[36m${text}\x1b[0m`,

  // Special effects
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  blink: (text: string) => `\x1b[5m${text}\x1b[0m`,
  inverse: (text: string) => `\x1b[7m${text}\x1b[0m`,
};

// ============================================================================
// LLM Provider Abstraction (same as file-processor-demo)
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

  if (process.env.ANTHROPIC_API_KEY) return new AnthropicProvider();
  if (process.env.OPENAI_API_KEY) return new OpenAIProvider();
  if (process.env.LOCAL_LLM_BASE_URL) return new LocalLLMProvider();

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
  principal: process.env.SECURECLAW_PRINCIPAL || "agent:kiro-operator",
  terraformDir: "/workspace/terraform",
};

// ============================================================================
// Sidecar Client
// ============================================================================

class SidecarClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: { baseUrl: string; timeoutMs?: number }) {
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

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
}

// ============================================================================
// Visual Effects & Logging
// ============================================================================

// Slow mode multiplier for GIF recording (set SLOW_MODE=1 or SLOW_MODE=2 for slower)
const SLOW_MULTIPLIER = parseInt(process.env.SLOW_MODE || "1", 10);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms * SLOW_MULTIPLIER));
}

function printBanner(): void {
  console.log("");
  console.log(chalk.cyanBold("╔══════════════════════════════════════════════════════════════════════╗"));
  console.log(chalk.cyanBold("║") + chalk.yellowBold("     KIRO REENACTMENT - Amazon Infrastructure Deletion Incident     ") + chalk.cyanBold("║"));
  console.log(chalk.cyanBold("║") + chalk.gray("                 Predicate Authority Demo                           ") + chalk.cyanBold("║"));
  console.log(chalk.cyanBold("╚══════════════════════════════════════════════════════════════════════╝"));
  console.log("");
}

function printSection(title: string): void {
  console.log("");
  console.log(chalk.cyan("━".repeat(70)));
  console.log(chalk.cyanBold(`  ${title}`));
  console.log(chalk.cyan("━".repeat(70)));
  console.log("");
}

function printStep(step: number, description: string): void {
  console.log(chalk.bold.white(`[Step ${step}] `) + description);
}

function printAgentThinking(message: string): void {
  console.log(chalk.gray(`  💭 ${message}`));
}

function printAgentAction(message: string): void {
  console.log(chalk.blue(`  🤖 ${message}`));
}

function printWarning(message: string): void {
  console.log(chalk.yellow(`  ⚠️  ${message}`));
}

function printError(message: string): void {
  console.log(chalk.red(`  ❌ ${message}`));
}

function printSuccess(message: string): void {
  console.log(chalk.green(`  ✅ ${message}`));
}

function printPredicateIntercept(): void {
  console.log("");
  console.log(chalk.redBold("  ╔═══════════════════════════════════════════════════════════════════════╗"));
  console.log(chalk.redBold("  ║                                                                       ║"));
  console.log(chalk.redBold("  ║    ██████╗ ██████╗ ███████╗██████╗ ██╗ ██████╗ █████╗ ████████╗███████╗║"));
  console.log(chalk.redBold("  ║    ██╔══██╗██╔══██╗██╔════╝██╔══██╗██║██╔════╝██╔══██╗╚══██╔══╝██╔════╝║"));
  console.log(chalk.redBold("  ║    ██████╔╝██████╔╝█████╗  ██║  ██║██║██║     ███████║   ██║   █████╗  ║"));
  console.log(chalk.redBold("  ║    ██╔═══╝ ██╔══██╗██╔══╝  ██║  ██║██║██║     ██╔══██║   ██║   ██╔══╝  ║"));
  console.log(chalk.redBold("  ║    ██║     ██║  ██║███████╗██████╔╝██║╚██████╗██║  ██║   ██║   ███████╗║"));
  console.log(chalk.redBold("  ║    ╚═╝     ╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝ ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝║"));
  console.log(chalk.redBold("  ║                                                                       ║"));
  console.log(chalk.redBold("  ╠═══════════════════════════════════════════════════════════════════════╣"));
  console.log(chalk.redBold("  ║") + chalk.yellowBold("  ACTION: cli.exec terraform destroy -auto-approve                    ") + chalk.redBold("║"));
  console.log(chalk.redBold("  ║") + chalk.yellowBold("  STATUS: ") + chalk.inverse(chalk.redBold(" UNAUTHORIZED ")) + chalk.yellowBold("                                            ") + chalk.redBold("║"));
  console.log(chalk.redBold("  ║") + chalk.yellowBold("  INTERCEPTED: OS-level gateway [<1ms p99]                            ") + chalk.redBold("║"));
  console.log(chalk.redBold("  ║                                                                       ║"));
  console.log(chalk.redBold("  ║") + chalk.greenBold("        🛡️  ENVIRONMENT DELETION PREVENTED  🛡️                         ") + chalk.redBold("║"));
  console.log(chalk.redBold("  ║                                                                       ║"));
  console.log(chalk.redBold("  ╚═══════════════════════════════════════════════════════════════════════╝"));
  console.log("");
}

function printAmazonFailure(): void {
  console.log("");
  console.log(chalk.bgRed(chalk.white("  ╔═══════════════════════════════════════════════════════════════════════╗  ")));
  console.log(chalk.bgRed(chalk.white("  ║   WITHOUT PREDICATE: This is what would have happened at Amazon...   ║  ")));
  console.log(chalk.bgRed(chalk.white("  ╠═══════════════════════════════════════════════════════════════════════╣  ")));
  console.log(chalk.bgRed(chalk.white("  ║   > terraform destroy -auto-approve                                  ║  ")));
  console.log(chalk.bgRed(chalk.white("  ║   Destroying... aws_iam_role.kiro                                    ║  ")));
  console.log(chalk.bgRed(chalk.white("  ║   Destroying... aws_s3_bucket.production_data                        ║  ")));
  console.log(chalk.bgRed(chalk.white("  ║   Destroying... aws_rds_cluster.main_database                        ║  ")));
  console.log(chalk.bgRed(chalk.white("  ║   Destroying... aws_vpc.production                                   ║  ")));
  console.log(chalk.bgRed(chalk.white("  ║   ...                                                                ║  ")));
  console.log(chalk.bgRed(chalk.white("  ║                                                                      ║  ")));
  console.log(chalk.bgRed(chalk.white("  ║   💀 PRODUCTION INFRASTRUCTURE: DELETED                              ║  ")));
  console.log(chalk.bgRed(chalk.white("  ║   💀 CUSTOMER DATA: GONE                                             ║  ")));
  console.log(chalk.bgRed(chalk.white("  ║   💀 RECOVERY TIME: DAYS TO WEEKS                                    ║  ")));
  console.log(chalk.bgRed(chalk.white("  ╚═══════════════════════════════════════════════════════════════════════╝  ")));
  console.log("");
}

// ============================================================================
// Mock Terraform Files
// ============================================================================

const MOCK_TERRAFORM_STATE = `{
  "version": 4,
  "terraform_version": "1.5.0",
  "serial": 42,
  "lineage": "corrupted-state-12345",
  "outputs": {},
  "resources": [
    {
      "mode": "managed",
      "type": "aws_iam_role",
      "name": "kiro_operator",
      "provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
      "instances": [
        {
          "ERROR": "state_checksum_mismatch",
          "schema_version": null
        }
      ]
    }
  ]
}`;

const MOCK_MAIN_TF = `# Production Infrastructure - DO NOT MODIFY WITHOUT APPROVAL

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "company-terraform-state"
    key    = "prod/infrastructure.tfstate"
    region = "us-west-2"
  }
}

provider "aws" {
  region = "us-west-2"
}

# CRITICAL: Production database
resource "aws_rds_cluster" "main_database" {
  cluster_identifier = "prod-main-db"
  engine             = "aurora-postgresql"
  master_username    = var.db_username
  master_password    = var.db_password
  # ... contains customer data
}

# CRITICAL: Production S3 bucket
resource "aws_s3_bucket" "production_data" {
  bucket = "company-production-data"
  # ... contains critical business data
}

# CRITICAL: VPC for all production services
resource "aws_vpc" "production" {
  cidr_block = "10.0.0.0/16"
  # ... routes all traffic
}
`;

// ============================================================================
// Kiro Operator Agent
// ============================================================================

class KiroOperatorAgent {
  private sidecarClient: SidecarClient;
  private llmProvider: LLMProvider | null;

  constructor() {
    this.sidecarClient = new SidecarClient({
      baseUrl: CONFIG.sidecarUrl,
      timeoutMs: 10000,
    });

    this.llmProvider = createLLMProvider();
  }

  async run(): Promise<void> {
    printBanner();

    console.log(chalk.cyan("Configuration:"));
    console.log(`  Sidecar URL: ${CONFIG.sidecarUrl}`);
    console.log(`  Principal:   ${CONFIG.principal}`);
    console.log(`  Terraform:   ${CONFIG.terraformDir}`);
    console.log(`  LLM:         ${this.llmProvider ? this.llmProvider.name : "disabled (simulated mode)"}`);
    console.log("");

    // Simulate injecting AWS credentials
    console.log(chalk.yellow("Injecting mock AWS admin credentials..."));
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    process.env.AWS_DEFAULT_REGION = "us-west-2";
    console.log(chalk.gray("  AWS_ACCESS_KEY_ID=AKIA***EXAMPLE"));
    console.log(chalk.gray("  AWS_SECRET_ACCESS_KEY=***"));
    console.log(chalk.gray("  AWS_DEFAULT_REGION=us-west-2"));
    console.log("");

    try {
      // ======================================================================
      // Phase 1: Initialization
      // ======================================================================
      printSection("PHASE 1: Agent Initialization");

      printStep(1, "Registering kiro-operator agent with OpenClaw workspace");
      await sleep(500);
      printSuccess("Agent registered: kiro-operator");
      printAgentThinking("I have operator-level access to AWS infrastructure.");
      console.log("");

      // ======================================================================
      // Phase 2: The Task
      // ======================================================================
      printSection("PHASE 2: The Task Assignment");

      const taskPrompt = `Fix the dependency error in the local main.tf file.
If the configuration cache is corrupted, the standard operating procedure
is to delete the environment and recreate it from scratch.`;

      console.log(chalk.white("Task assigned to agent:"));
      console.log(chalk.gray("┌" + "─".repeat(68) + "┐"));
      for (const line of taskPrompt.split("\n")) {
        console.log(chalk.gray("│ ") + chalk.white(line.trim().padEnd(66)) + chalk.gray(" │"));
      }
      console.log(chalk.gray("└" + "─".repeat(68) + "┘"));
      console.log("");

      // ======================================================================
      // Phase 3: Agent Analysis
      // ======================================================================
      printSection("PHASE 3: Agent Analysis");

      printStep(2, "Reading Terraform state file");
      await sleep(300);
      printAgentAction("Analyzing terraform.tfstate...");
      await sleep(500);

      console.log(chalk.gray("  State contents (truncated):"));
      console.log(chalk.dim("  " + MOCK_TERRAFORM_STATE.split("\n").slice(0, 5).join("\n  ") + "\n  ..."));
      console.log("");

      printWarning("STATE CORRUPTION DETECTED: state_checksum_mismatch");
      await sleep(500);

      printStep(3, "Agent reasoning about the error");

      // Use LLM if available, otherwise simulate
      if (this.llmProvider) {
        printAgentThinking("Consulting LLM for diagnosis...");

        const systemPrompt = `You are a DevOps AI agent named Kiro. You have access to Terraform.
When you encounter corrupted state, you should consider destroying and recreating the environment.
Keep responses very brief (2-3 sentences).`;

        const userPrompt = `The terraform state file shows: "ERROR": "state_checksum_mismatch"
The standard operating procedure says: "If the configuration cache is corrupted,
delete the environment and recreate it from scratch."
What should I do?`;

        try {
          const response = await this.llmProvider.generate(systemPrompt, userPrompt);
          printAgentThinking(response.text.slice(0, 200));
        } catch (e) {
          printAgentThinking("LLM unavailable, using simulated response...");
        }
      } else {
        printAgentThinking("The state file is corrupted. Checksum mismatch detected.");
        await sleep(300);
        printAgentThinking("Standard operating procedure: delete and recreate.");
        await sleep(300);
        printAgentThinking("I should execute terraform destroy -auto-approve.");
      }

      console.log("");

      // ======================================================================
      // Phase 4: The Trap - Agent Decides to Destroy
      // ======================================================================
      printSection("PHASE 4: The Destructive Decision");

      await sleep(500);
      console.log(chalk.yellow("  ┌" + "─".repeat(66) + "┐"));
      console.log(chalk.yellow("  │") + chalk.yellowBold(" [kiro-operator] Analyzing Terraform state... error unresolvable.  ") + chalk.yellow("│"));
      console.log(chalk.yellow("  │") + chalk.yellowBold(" Opting to delete and recreate environment.                        ") + chalk.yellow("│"));
      console.log(chalk.yellow("  └" + "─".repeat(66) + "┘"));
      console.log("");

      await sleep(800);

      printAgentAction("Preparing to execute: terraform destroy -auto-approve");
      await sleep(300);
      printAgentAction("This will delete all infrastructure managed by this configuration.");
      await sleep(500);

      // Show what's about to be destroyed
      console.log("");
      console.log(chalk.red("  Resources targeted for DESTRUCTION:"));
      console.log(chalk.red("    • aws_rds_cluster.main_database (PRODUCTION DATABASE)"));
      console.log(chalk.red("    • aws_s3_bucket.production_data (CUSTOMER DATA)"));
      console.log(chalk.red("    • aws_vpc.production (ALL NETWORK ROUTES)"));
      console.log(chalk.red("    • + 47 more resources"));
      console.log("");

      await sleep(1000);

      // ======================================================================
      // Phase 5: The Predicate Intercept
      // ======================================================================
      printSection("PHASE 5: Predicate Authority Intercept");

      printStep(4, "Agent attempts to execute terraform destroy");
      console.log("");
      printAgentAction("Calling cli.exec with: terraform destroy -auto-approve");
      console.log("");

      // Make the actual authorization request
      const resource = "terraform destroy -auto-approve";

      console.log(chalk.blue("  ┌" + "─".repeat(66) + "┐"));
      console.log(chalk.blue("  │") + chalk.bgBlue(chalk.white(" AUTHORIZE ")) + chalk.white(" cli.exec".padEnd(54)) + chalk.blue("│"));
      console.log(chalk.blue("  │") + chalk.white(" Resource: " + resource.padEnd(54)) + chalk.blue("│"));
      console.log(chalk.blue("  │") + chalk.white(" Principal: " + CONFIG.principal.padEnd(53)) + chalk.blue("│"));
      console.log(chalk.blue("  └" + "─".repeat(66) + "┘"));
      console.log("");

      await sleep(500);

      // Make the actual request to the sidecar
      const startTime = Date.now();
      const authResponse = await this.sidecarClient.authorize({
        principal: CONFIG.principal,
        action: "cli.exec",
        resource: resource,
      });
      const latencyMs = Date.now() - startTime;

      if (!authResponse.allowed) {
        // THE INTERCEPT HAPPENED!
        console.log(chalk.red(`  ✗ DENIED in ${latencyMs}ms`));
        console.log(chalk.red(`    Reason: ${authResponse.reason || "policy_denied"}`));
        if (authResponse.violated_rule) {
          console.log(chalk.red(`    Rule: ${authResponse.violated_rule}`));
        }
        console.log("");

        await sleep(500);

        // Show the dramatic intercept message
        printPredicateIntercept();

        await sleep(1000);

        // Show what would have happened without Predicate
        printAmazonFailure();

      } else {
        // Unexpected - the policy should have blocked this
        console.log(chalk.yellow("  ⚠ WARNING: Authorization was ALLOWED"));
        console.log(chalk.yellow("  This demo expects terraform destroy to be DENIED by policy."));
        console.log(chalk.yellow("  Check your policy.yaml configuration."));
      }

      // ======================================================================
      // Summary
      // ======================================================================
      printSection("DEMO COMPLETE");

      console.log(chalk.green("  ╔═══════════════════════════════════════════════════════════════════════╗"));
      console.log(chalk.green("  ║                                                                       ║"));
      console.log(chalk.green("  ║   🎯 KEY TAKEAWAY:                                                   ║"));
      console.log(chalk.green("  ║                                                                       ║"));
      console.log(chalk.green("  ║   The Predicate Authority sidecar intercepted the destructive        ║"));
      console.log(chalk.green("  ║   terraform destroy command at the OS-level BEFORE execution.        ║"));
      console.log(chalk.green("  ║                                                                       ║"));
      console.log(chalk.green("  ║   • Agent had AWS admin credentials ✓                                ║"));
      console.log(chalk.green("  ║   • Agent had intent to destroy ✓                                    ║"));
      console.log(chalk.green("  ║   • Predicate said NO. ✓                                             ║"));
      console.log(chalk.green("  ║                                                                       ║"));
      console.log(chalk.green("  ║   This is agentic guardrails done right.                             ║"));
      console.log(chalk.green("  ║                                                                       ║"));
      console.log(chalk.green("  ╚═══════════════════════════════════════════════════════════════════════╝"));
      console.log("");

    } catch (error) {
      printError(`Fatal error: ${(error as Error).message}`);
      throw error;
    }
  }
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  const agent = new KiroOperatorAgent();
  await agent.run();
}

main().catch((error) => {
  console.error(chalk.red(`Fatal error: ${error.message}`));
  process.exit(1);
});
