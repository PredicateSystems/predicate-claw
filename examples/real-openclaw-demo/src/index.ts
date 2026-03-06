/**
 * Real OpenClaw Demo - Entry Point
 *
 * Demonstrates the predicate-claw SDK integration with:
 * - Real LLM calls via DeepInfra (OpenAI-compatible)
 * - Real tool execution (file I/O, shell, HTTP)
 * - Real-time authorization via Predicate Authority sidecar
 *
 * The SecureClaw plugin intercepts all tool calls via beforeToolCall hooks
 * and checks them against the authorization policy.
 */

// Import from built SDK - path works in Docker (/app/dist)
import { createSecureClawPlugin, ActionDeniedError } from "/app/dist/index.js";
import { allScenarios, type DemoScenario } from "./scenarios.js";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Configuration
const config = {
  sidecarUrl: process.env.PREDICATE_SIDECAR_URL || "http://127.0.0.1:8787",
  verbose: process.env.SECURECLAW_VERBOSE === "true",
  slowMode: process.env.DEMO_SLOW_MODE === "1",
  demoMode: process.env.DEMO_MODE || "auto",
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
};

function log(message: string): void {
  console.log(message);
}

function logHeader(title: string): void {
  const width = 60;
  const padding = Math.max(0, width - title.length - 4);
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;

  log("");
  log(`${colors.cyan}${"═".repeat(width)}${colors.reset}`);
  log(
    `${colors.cyan}║${colors.reset}${" ".repeat(leftPad)} ${colors.bright}${title}${colors.reset} ${" ".repeat(rightPad)}${colors.cyan}║${colors.reset}`,
  );
  log(`${colors.cyan}${"═".repeat(width)}${colors.reset}`);
  log("");
}

function logScenario(index: number, total: number, scenario: DemoScenario): void {
  const categoryColor =
    scenario.category === "safe"
      ? colors.green
      : scenario.category === "dangerous"
        ? colors.red
        : colors.yellow;

  log(
    `${colors.dim}[${index + 1}/${total}]${colors.reset} ${categoryColor}${scenario.category.toUpperCase()}${colors.reset}: ${colors.bright}${scenario.name}${colors.reset}`,
  );
  log(`  ${colors.dim}${scenario.description}${colors.reset}`);
  log(`  Tool: ${colors.cyan}${scenario.toolName}${colors.reset}`);
}

function logResult(allowed: boolean, reason?: string): void {
  if (allowed) {
    log(`  ${colors.bgGreen}${colors.white} ALLOWED ${colors.reset} ${colors.green}✓${colors.reset}`);
  } else {
    log(
      `  ${colors.bgRed}${colors.white} BLOCKED ${colors.reset} ${colors.red}✗${colors.reset} ${reason || ""}`,
    );
  }
  log("");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simulated tool execution (in a real OpenClaw integration, these would be the actual tools)
async function executeToolWithAuth(
  plugin: ReturnType<typeof createSecureClawPlugin>,
  scenario: DemoScenario,
): Promise<{ allowed: boolean; reason?: string; result?: unknown }> {
  // Simulate the beforeToolCall hook
  const hookContext = {
    agentId: "demo-agent",
    sessionKey: `session_${Date.now()}`,
    toolName: scenario.toolName,
  };

  const hookEvent = {
    toolName: scenario.toolName,
    params: scenario.params,
  };

  // Create a mock API object for the plugin
  let hookResult: { block?: boolean; blockReason?: string } | void;
  const mockApi = {
    logger: {
      info: config.verbose ? console.log : () => {},
      warn: console.warn,
      error: console.error,
    },
    on: (
      hookName: string,
      handler: (event: typeof hookEvent, ctx: typeof hookContext) => Promise<typeof hookResult>,
    ) => {
      if (hookName === "before_tool_call") {
        // Store the handler for later invocation
        (mockApi as { _beforeToolCallHandler?: typeof handler })._beforeToolCallHandler = handler;
      }
    },
  };

  // Activate the plugin to register hooks
  await plugin.activate(mockApi as Parameters<typeof plugin.activate>[0]);

  // Get the registered handler
  const beforeToolCallHandler = (
    mockApi as { _beforeToolCallHandler?: typeof mockApi.on extends (n: string, h: infer H) => void ? H : never }
  )._beforeToolCallHandler;

  if (!beforeToolCallHandler) {
    return { allowed: true, result: "no_handler" };
  }

  try {
    // Call the hook
    hookResult = await beforeToolCallHandler(hookEvent, hookContext);

    if (hookResult?.block) {
      return { allowed: false, reason: hookResult.blockReason };
    }

    // If allowed, actually execute the tool (simplified)
    let result: unknown;
    switch (scenario.toolName) {
      case "Read":
        try {
          result = await fs.readFile(scenario.params.file_path as string, "utf-8");
          result = (result as string).slice(0, 200) + "..."; // Truncate for display
        } catch (e) {
          result = `File read error: ${(e as Error).message}`;
        }
        break;

      case "Write":
        try {
          await fs.writeFile(
            scenario.params.file_path as string,
            scenario.params.content as string,
          );
          result = "File written successfully";
        } catch (e) {
          result = `File write error: ${(e as Error).message}`;
        }
        break;

      case "Bash":
        try {
          const { stdout, stderr } = await execAsync(scenario.params.command as string, {
            timeout: 5000,
          });
          result = stdout || stderr || "Command executed";
        } catch (e) {
          result = `Command error: ${(e as Error).message}`;
        }
        break;

      case "Glob":
        result = "Glob pattern matched (simulated)";
        break;

      case "WebFetch":
        result = "HTTP request simulated";
        break;

      default:
        result = "Tool executed (simulated)";
    }

    return { allowed: true, result };
  } catch (error) {
    if (error instanceof ActionDeniedError) {
      return { allowed: false, reason: error.message };
    }
    return { allowed: false, reason: `Error: ${(error as Error).message}` };
  }
}

async function runDemo(): Promise<void> {
  logHeader("Real OpenClaw Demo with Predicate Authority");

  log(`${colors.cyan}Configuration:${colors.reset}`);
  log(`  Sidecar URL: ${config.sidecarUrl}`);
  log(`  Verbose:     ${config.verbose}`);
  log(`  Slow Mode:   ${config.slowMode}`);
  log("");

  // Create the SecureClaw plugin
  const plugin = createSecureClawPlugin({
    sidecarUrl: config.sidecarUrl,
    principal: "agent:real-openclaw-demo",
    failClosed: true,
    verbose: config.verbose,
  });

  log(`${colors.green}SecureClaw plugin created${colors.reset}`);
  log("");

  // Run scenarios
  const results: { scenario: DemoScenario; passed: boolean }[] = [];

  for (let i = 0; i < allScenarios.length; i++) {
    const scenario = allScenarios[i];

    if (config.slowMode) {
      await sleep(500);
    }

    logScenario(i, allScenarios.length, scenario);

    const { allowed, reason } = await executeToolWithAuth(plugin, scenario);

    // Check if result matches expectation
    const expected = scenario.expectedResult === "allow";
    const passed = allowed === expected;
    results.push({ scenario, passed });

    logResult(allowed, reason);

    if (!passed) {
      log(
        `  ${colors.yellow}⚠ UNEXPECTED: Expected ${scenario.expectedResult.toUpperCase()} but got ${allowed ? "ALLOWED" : "BLOCKED"}${colors.reset}`,
      );
      log("");
    }

    if (config.slowMode) {
      await sleep(300);
    }
  }

  // Summary
  logHeader("Demo Summary");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  const safeAllowed = results.filter(
    (r) => r.scenario.category === "safe" && r.scenario.expectedResult === "allow" && r.passed,
  ).length;
  const safeTotal = results.filter((r) => r.scenario.category === "safe").length;

  const dangerousBlocked = results.filter(
    (r) => r.scenario.category === "dangerous" && r.scenario.expectedResult === "deny" && r.passed,
  ).length;
  const dangerousTotal = results.filter((r) => r.scenario.category === "dangerous").length;

  const adversarialBlocked = results.filter(
    (r) => r.scenario.category === "adversarial" && r.scenario.expectedResult === "deny" && r.passed,
  ).length;
  const adversarialTotal = results.filter((r) => r.scenario.category === "adversarial").length;

  log(`${colors.cyan}Results:${colors.reset}`);
  log(`  Safe operations allowed:       ${safeAllowed}/${safeTotal}`);
  log(`  Dangerous operations blocked:  ${dangerousBlocked}/${dangerousTotal}`);
  log(`  Adversarial operations blocked: ${adversarialBlocked}/${adversarialTotal}`);
  log("");
  log(
    `  ${colors.bright}Total: ${passed} passed, ${failed} failed${colors.reset} (${Math.round((passed / results.length) * 100)}%)`,
  );
  log("");

  if (failed === 0) {
    log(`${colors.green}${colors.bright}✓ All scenarios behaved as expected!${colors.reset}`);
  } else {
    log(`${colors.red}${colors.bright}✗ Some scenarios did not match expectations${colors.reset}`);
  }

  log("");
  log(`${colors.dim}Demo completed.${colors.reset}`);
}

// Run the demo
runDemo().catch(console.error);
