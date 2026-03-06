/**
 * SecureClaw OpenClaw Plugin
 *
 * Integrates Predicate Authority for pre-execution authorization
 * and post-execution verification into OpenClaw's hook system.
 *
 * This is the main plugin definition that users install.
 */

import { GuardedProvider, ActionDeniedError, SidecarUnavailableError } from "./provider.js";
import type { GuardRequest, GuardTelemetry, DecisionTelemetryEvent, DecisionAuditExporter } from "./provider.js";
import crypto from "node:crypto";
import path from "node:path";

// =============================================================================
// Configuration
// =============================================================================

export interface SecureClawConfig {
  /** Agent principal identifier for authorization requests */
  principal: string;

  /** Path to YAML policy file */
  policyFile: string;

  /** Predicate Authority sidecar URL */
  sidecarUrl: string;

  /** Fail closed when sidecar is unavailable (default: true) */
  failClosed: boolean;

  /** Enable post-execution verification via Snapshot Engine (default: true) */
  enablePostVerification: boolean;

  /** Enable verbose logging */
  verbose: boolean;

  /** Session ID for audit trail correlation */
  sessionId?: string;

  /** Tenant ID for multi-tenant deployments */
  tenantId?: string;

  /** User ID for audit attribution */
  userId?: string;
}

export const defaultSecureClawConfig: SecureClawConfig = {
  principal: "agent:secureclaw",
  policyFile: "./policies/default.json",
  sidecarUrl: "http://127.0.0.1:8787",
  failClosed: true,
  enablePostVerification: true,
  verbose: false,
};

export function loadSecureClawConfigFromEnv(): Partial<SecureClawConfig> {
  return {
    principal: process.env.SECURECLAW_PRINCIPAL,
    policyFile: process.env.SECURECLAW_POLICY,
    sidecarUrl: process.env.PREDICATE_SIDECAR_URL,
    failClosed: process.env.SECURECLAW_FAIL_OPEN !== "true",
    enablePostVerification: process.env.SECURECLAW_VERIFY !== "false",
    verbose: process.env.SECURECLAW_VERBOSE === "true",
    tenantId: process.env.SECURECLAW_TENANT_ID,
    userId: process.env.SECURECLAW_USER_ID,
  };
}

export function mergeSecureClawConfig(
  base: SecureClawConfig,
  overrides: Partial<SecureClawConfig>,
): SecureClawConfig {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(overrides).filter(([_, v]) => v !== undefined)),
  } as SecureClawConfig;
}

// =============================================================================
// Resource Extraction
// =============================================================================

/**
 * Extract the action type from a tool name.
 */
export function extractAction(toolName: string): string {
  const actionMap: Record<string, string> = {
    // File system operations
    Read: "fs.read",
    Write: "fs.write",
    Edit: "fs.write",
    Glob: "fs.list",
    MultiEdit: "fs.write",

    // Shell/process operations
    Bash: "shell.exec",
    Task: "agent.spawn",

    // Network operations
    WebFetch: "http.request",
    WebSearch: "http.request",

    // Browser automation
    "computer-use:screenshot": "browser.screenshot",
    "computer-use:click": "browser.interact",
    "computer-use:type": "browser.interact",
    "computer-use:scroll": "browser.interact",
    "computer-use:navigate": "browser.navigate",

    // Notebook operations
    NotebookRead: "notebook.read",
    NotebookEdit: "notebook.write",

    // MCP tool calls
    mcp_tool: "mcp.call",
  };

  return actionMap[toolName] ?? `tool.${toolName.toLowerCase()}`;
}

/**
 * Extract the resource identifier from tool parameters.
 */
export function extractResource(toolName: string, params: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return extractFilePath(params);

    case "Glob":
      return typeof params.pattern === "string" ? params.pattern : "*";

    case "Bash":
      return extractBashCommand(params);

    case "WebFetch":
    case "WebSearch":
      return typeof params.url === "string"
        ? params.url
        : typeof params.query === "string"
          ? `search:${params.query}`
          : "unknown";

    case "computer-use:navigate":
      return typeof params.url === "string" ? params.url : "browser:current";

    case "computer-use:screenshot":
    case "computer-use:click":
    case "computer-use:type":
    case "computer-use:scroll":
      return "browser:current";

    case "Task":
      return typeof params.prompt === "string"
        ? `task:${params.prompt.slice(0, 50)}`
        : "task:unknown";

    case "NotebookRead":
    case "NotebookEdit":
      return typeof params.notebook_path === "string" ? params.notebook_path : "notebook:unknown";

    case "mcp_tool":
      return extractMcpResource(params);

    default:
      return (
        extractFilePath(params) ||
        (typeof params.path === "string" ? params.path : null) ||
        (typeof params.target === "string" ? params.target : null) ||
        `${toolName}:params`
      );
  }
}

/**
 * Normalize a file path to prevent path traversal attacks.
 * Resolves relative paths, removes . and .. components, and handles ~ expansion.
 */
export function normalizePath(filePath: string): string {
  if (!filePath || filePath === "file:unknown") {
    return filePath;
  }

  // Expand ~ to home directory
  let normalized = filePath;
  if (normalized.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE || "/";
    normalized = path.join(home, normalized.slice(2));
  } else if (normalized === "~") {
    normalized = process.env.HOME || process.env.USERPROFILE || "/";
  }

  // Resolve to absolute path (handles . and .. components)
  // path.resolve will make relative paths absolute based on cwd
  normalized = path.resolve(normalized);

  // Normalize the path (removes redundant slashes, etc.)
  normalized = path.normalize(normalized);

  return normalized;
}

function extractFilePath(params: Record<string, unknown>): string {
  const pathKeys = ["file_path", "filePath", "path", "file", "filename"];
  for (const key of pathKeys) {
    if (typeof params[key] === "string") {
      // Normalize the path to prevent path traversal attacks
      return normalizePath(params[key]);
    }
  }
  return "file:unknown";
}

function extractBashCommand(params: Record<string, unknown>): string {
  const command = params.command;
  if (typeof command !== "string") {
    return "bash:unknown";
  }

  const maxLen = 100;
  if (command.length <= maxLen) {
    return command;
  }

  const parts = command.split(/\s+/);
  const cmdName = parts[0] ?? "cmd";
  const firstArg = parts[1] ?? "";

  return `${cmdName} ${firstArg}...`.slice(0, maxLen);
}

function extractMcpResource(params: Record<string, unknown>): string {
  const server =
    typeof params.server === "string"
      ? params.server
      : typeof params.mcp_server === "string"
        ? params.mcp_server
        : "unknown";
  const tool =
    typeof params.tool === "string"
      ? params.tool
      : typeof params.tool_name === "string"
        ? params.tool_name
        : "unknown";
  return `mcp:${server}/${tool}`;
}

/**
 * Check if a resource path should be considered sensitive.
 */
export function isSensitiveResource(resource: string): boolean {
  const lowered = resource.toLowerCase();
  const sensitivePatterns = [
    "/.ssh/",
    "/etc/passwd",
    "/etc/shadow",
    "id_rsa",
    "id_ed25519",
    "credentials",
    ".env",
    "secret",
    "token",
    "password",
    "api_key",
    "apikey",
    "private_key",
    "privatekey",
    ".pem",
    ".key",
    "aws_",
    "gcp_",
    "azure_",
  ];

  return sensitivePatterns.some((pattern) => lowered.includes(pattern));
}

/**
 * Redact sensitive resources for safe logging.
 */
export function redactResource(resource: string): string {
  if (isSensitiveResource(resource)) {
    return "[REDACTED]";
  }
  return resource;
}

// =============================================================================
// OpenClaw Plugin Types (minimal subset for plugin interface)
// =============================================================================

interface PluginLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface PluginHookToolContext {
  agentId?: string;
  sessionKey?: string;
  toolName: string;
}

interface PluginHookSessionContext {
  agentId?: string;
  sessionId: string;
}

interface PluginHookBeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
}

interface PluginHookBeforeToolCallResult {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
}

interface PluginHookAfterToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

interface PluginHookSessionStartEvent {
  sessionId: string;
  resumedFrom?: string;
}

interface PluginHookSessionEndEvent {
  sessionId: string;
  messageCount: number;
  durationMs?: number;
}

interface OpenClawPluginApi {
  logger: PluginLogger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (hookName: string, handler: (...args: any[]) => any, opts?: { priority?: number }) => void;
}

interface OpenClawPluginDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  activate: (api: OpenClawPluginApi) => Promise<void>;
}

// =============================================================================
// Verification Types
// =============================================================================

interface VerificationResult {
  verified: boolean;
  reason?: string;
  auditId?: string;
  authorized?: { action: string; resource: string };
  actual?: { action: string; resource: string };
}

interface ActualOperation {
  action: string;
  resource: string;
  type?: string;
  executed_at?: string;
  exit_code?: number;
  content_hash?: string;
  error?: string;
}

// =============================================================================
// Plugin Factory
// =============================================================================

export interface SecureClawPluginOptions extends Partial<SecureClawConfig> {}

/**
 * Create the SecureClaw plugin instance.
 *
 * Usage:
 * ```ts
 * import { createSecureClawPlugin } from "predicate-claw";
 *
 * export default createSecureClawPlugin({
 *   principal: "agent:my-agent",
 *   sidecarUrl: "http://localhost:8787",
 * });
 * ```
 */
export function createSecureClawPlugin(
  options: SecureClawPluginOptions = {},
): OpenClawPluginDefinition {
  // Merge config: defaults -> env -> explicit options
  const envConfig = loadSecureClawConfigFromEnv();
  const config = mergeSecureClawConfig(mergeSecureClawConfig(defaultSecureClawConfig, envConfig), options);

  // Session tracking for audit trail
  let currentSessionId: string | undefined;
  let sessionStartTime: number | undefined;
  const toolCallMetrics: Map<string, { count: number; blocked: number }> = new Map();

  // Mandate tracking for post-execution verification
  const pendingMandates: Map<string, { mandateId: string; action: string; resource: string }> =
    new Map();

  return {
    id: "secureclaw",
    name: "SecureClaw",
    description: "Zero-trust security middleware with pre-authorization and post-verification",
    version: "1.0.0",

    async activate(api: OpenClawPluginApi) {
      const log = api.logger;

      // Create telemetry handler for logging decisions
      const telemetry: GuardTelemetry = {
        onDecision(event: DecisionTelemetryEvent) {
          if (config.verbose) {
            const status =
              event.outcome === "allow"
                ? "ALLOWED"
                : event.outcome === "deny"
                  ? "BLOCKED"
                  : "ERROR";
            log.info(
              `[SecureClaw] ${status}: ${event.action} on ${event.resource} (${event.reason ?? "no reason"})`,
            );
          }
        },
      };

      // Create audit exporter placeholder
      const auditExporter: DecisionAuditExporter = {
        async exportDecision(_event: DecisionTelemetryEvent) {
          // TODO: Send to centralized audit log
        },
      };

      // Create GuardedProvider instance
      const guardedProvider = new GuardedProvider({
        principal: config.principal,
        config: {
          baseUrl: config.sidecarUrl,
          failClosed: config.failClosed,
          timeoutMs: 5000,
          maxRetries: 0,
          backoffInitialMs: 100,
        },
        telemetry,
        auditExporter,
      });

      if (config.verbose) {
        log.info(`[SecureClaw] Activating with principal: ${config.principal}`);
        log.info(`[SecureClaw] Sidecar URL: ${config.sidecarUrl}`);
        log.info(`[SecureClaw] Fail closed: ${config.failClosed}`);
        log.info(`[SecureClaw] Post-verification: ${config.enablePostVerification}`);
      }

      // Hook: session_start
      api.on(
        "session_start",
        (event: PluginHookSessionStartEvent, _ctx: PluginHookSessionContext) => {
          currentSessionId = event.sessionId;
          sessionStartTime = Date.now();
          toolCallMetrics.clear();

          if (config.verbose) {
            log.info(`[SecureClaw] Session started: ${event.sessionId}`);
          }
        },
        { priority: 100 },
      );

      // Hook: session_end
      api.on(
        "session_end",
        (event: PluginHookSessionEndEvent, _ctx: PluginHookSessionContext) => {
          const duration = sessionStartTime ? Date.now() - sessionStartTime : 0;

          if (config.verbose) {
            log.info(`[SecureClaw] Session ended: ${event.sessionId}`);
            log.info(`[SecureClaw] Duration: ${duration}ms`);
            log.info(`[SecureClaw] Tool metrics:`);
            for (const [tool, metrics] of toolCallMetrics) {
              log.info(`  ${tool}: ${metrics.count} calls, ${metrics.blocked} blocked`);
            }
          }

          currentSessionId = undefined;
          sessionStartTime = undefined;
          toolCallMetrics.clear();
        },
        { priority: 100 },
      );

      // Hook: before_tool_call - Pre-execution authorization
      api.on(
        "before_tool_call",
        async (
          event: PluginHookBeforeToolCallEvent,
          ctx: PluginHookToolContext,
        ): Promise<PluginHookBeforeToolCallResult | void> => {
          const { toolName, params } = event;
          const action = extractAction(toolName);
          const resource = extractResource(toolName, params);

          // Track metrics
          const metrics = toolCallMetrics.get(toolName) ?? { count: 0, blocked: 0 };
          metrics.count++;
          toolCallMetrics.set(toolName, metrics);

          if (config.verbose) {
            log.info(`[SecureClaw] Pre-auth: ${action} on ${redactResource(resource)}`);
          }

          try {
            const guardRequest: GuardRequest = {
              action,
              resource,
              args: params,
              context: {
                session_id: currentSessionId ?? ctx.sessionKey,
                tenant_id: config.tenantId,
                user_id: config.userId,
                agent_id: ctx.agentId,
                source: "secureclaw",
              },
            };

            const mandateId = await guardedProvider.guardOrThrow(guardRequest);

            // Store mandate for post-verification
            if (mandateId && config.enablePostVerification) {
              const toolCallId = `${toolName}:${Date.now()}`;
              pendingMandates.set(toolCallId, { mandateId, action, resource });
              (ctx as unknown as Record<string, unknown>).__secureClawToolCallId = toolCallId;
            }

            return undefined;
          } catch (error) {
            if (error instanceof ActionDeniedError) {
              metrics.blocked++;
              toolCallMetrics.set(toolName, metrics);

              const reason = error.message ?? "denied_by_policy";
              if (config.verbose) {
                log.warn(`[SecureClaw] BLOCKED: ${action} - ${reason}`);
              }

              return {
                block: true,
                blockReason: `[SecureClaw] Action blocked: ${reason}`,
              };
            }

            if (error instanceof SidecarUnavailableError) {
              metrics.blocked++;
              toolCallMetrics.set(toolName, metrics);

              log.error(`[SecureClaw] Sidecar error (fail-closed): ${error.message}`);
              return {
                block: true,
                blockReason: `[SecureClaw] Authorization service unavailable (fail-closed mode)`,
              };
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            if (config.failClosed) {
              metrics.blocked++;
              toolCallMetrics.set(toolName, metrics);

              log.error(`[SecureClaw] Unknown error (fail-closed): ${errorMessage}`);
              return {
                block: true,
                blockReason: `[SecureClaw] Authorization service unavailable (fail-closed mode)`,
              };
            }

            log.warn(`[SecureClaw] Unknown error (fail-open): ${errorMessage}`);
            return undefined;
          }
        },
        { priority: 1000 },
      );

      // Hook: after_tool_call - Post-execution verification
      api.on(
        "after_tool_call",
        async (event: PluginHookAfterToolCallEvent, ctx: PluginHookToolContext): Promise<void> => {
          if (!config.enablePostVerification) {
            return;
          }

          const { toolName, params, result, error, durationMs } = event;
          const action = extractAction(toolName);
          const resource = extractResource(toolName, params);

          if (config.verbose) {
            log.info(
              `[SecureClaw] Post-verify: ${action} on ${redactResource(resource)} ` +
                `(${durationMs ?? 0}ms, error: ${error ? "yes" : "no"})`,
            );
          }

          const toolCallId = (ctx as unknown as Record<string, unknown>).__secureClawToolCallId as
            | string
            | undefined;
          const mandateInfo = toolCallId ? pendingMandates.get(toolCallId) : undefined;

          if (mandateInfo) {
            pendingMandates.delete(toolCallId!);

            const evidence = buildExecutionEvidence(action, resource, result, error);

            const verifyResult = await (
              guardedProvider as unknown as {
                verify: (mandateId: string, actual: ActualOperation) => Promise<VerificationResult>;
              }
            ).verify(mandateInfo.mandateId, evidence);

            if (config.verbose) {
              if (verifyResult.verified) {
                log.info(
                  `[SecureClaw] Verified: ${action} on ${redactResource(resource)} ` +
                    `(audit_id: ${verifyResult.auditId ?? "none"})`,
                );
              } else {
                log.warn(
                  `[SecureClaw] Verification FAILED: ${action} on ${redactResource(resource)} ` +
                    `(reason: ${verifyResult.reason ?? "unknown"})`,
                );
              }
            }

            if (!verifyResult.verified) {
              log.warn(
                `[SecureClaw] POST-VERIFICATION MISMATCH: ` +
                  `authorized=${JSON.stringify(verifyResult.authorized)}, ` +
                  `actual=${JSON.stringify(verifyResult.actual)}`,
              );
            }
          }
        },
        { priority: 100 },
      );

      log.info("[SecureClaw] Plugin activated - all tool calls will be authorized");
    },
  };
}

/**
 * Build execution evidence for post-verification.
 */
function buildExecutionEvidence(
  action: string,
  resource: string,
  result: unknown,
  error: string | undefined,
): ActualOperation {
  const baseEvidence = {
    action,
    resource,
    executed_at: new Date().toISOString(),
  };

  if (action.startsWith("fs.")) {
    const fileResult = result as { content?: string; size?: number } | undefined;
    return {
      ...baseEvidence,
      type: "file",
      content_hash: fileResult?.content
        ? crypto.createHash("sha256").update(fileResult.content).digest("hex")
        : undefined,
      error,
    };
  }

  if (action === "shell.exec" || action === "bash.run") {
    const cliResult = result as { exitCode?: number; stdout?: string } | undefined;
    return {
      ...baseEvidence,
      type: "cli",
      exit_code: cliResult?.exitCode ?? (error ? 1 : 0),
      content_hash: cliResult?.stdout
        ? crypto.createHash("sha256").update(cliResult.stdout).digest("hex")
        : undefined,
      error,
    };
  }

  if (action.startsWith("browser.")) {
    return {
      ...baseEvidence,
      type: "browser",
      error,
    };
  }

  if (action.startsWith("http.") || action.startsWith("fetch.")) {
    return {
      ...baseEvidence,
      type: "http",
      error,
    };
  }

  return {
    ...baseEvidence,
    type: "generic",
    error,
  };
}
