import crypto from "node:crypto";
import type { AuthorizationRequest } from "@predicatesystems/authority";
import {
  type AuthorityAdapter,
  createDefaultAuthorityAdapter,
} from "./authority-client.js";
import { defaultProviderConfig, type ProviderConfig } from "./config.js";
import { ActionDeniedError, SidecarUnavailableError } from "./errors.js";

export interface GuardRequest {
  action: string;
  resource: string;
  args: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface GuardedProviderOptions {
  principal: string;
  config?: Partial<ProviderConfig>;
  authorityClient?: AuthorityAdapter;
  telemetry?: GuardTelemetry;
  auditExporter?: DecisionAuditExporter;
}

export interface DecisionTelemetryEvent {
  principal: string;
  action: string;
  resource: string;
  outcome: "allow" | "deny" | "error";
  reason?: string;
  mandateId?: string;
  sessionId?: string;
  tenantId?: string;
  userId?: string;
  traceId?: string;
  source?: string;
  timestamp: string;
}

export interface GuardTelemetry {
  onDecision?(event: DecisionTelemetryEvent): void;
}

export interface DecisionAuditExporter {
  exportDecision(event: DecisionTelemetryEvent): Promise<void> | void;
}

export class GuardedProvider {
  private readonly principal: string;
  private readonly config: ProviderConfig;
  private readonly authorityClient: AuthorityAdapter;
  private readonly telemetry?: GuardTelemetry;
  private readonly auditExporter?: DecisionAuditExporter;

  constructor(options: GuardedProviderOptions) {
    this.principal = options.principal;
    this.config = { ...defaultProviderConfig, ...(options.config ?? {}) };
    this.authorityClient =
      options.authorityClient ?? createDefaultAuthorityAdapter(this.config);
    this.telemetry = options.telemetry;
    this.auditExporter = options.auditExporter;
  }

  static intentHash(args: Record<string, unknown>): string {
    const encoded = stableJson(args);
    return crypto.createHash("sha256").update(encoded).digest("hex");
  }

  async authorize(request: GuardRequest): Promise<string | null> {
    const wireRequest: AuthorizationRequest = {
      principal: this.principal,
      action: request.action,
      resource: request.resource,
      intent_hash: GuardedProvider.intentHash(request.args),
      labels: labelsFromContext(request.context),
    };

    try {
      const decision = await this.authorityClient.authorize(wireRequest);
      if (decision.allow) {
        await this.emitDecisionEvent({
          principal: this.principal,
          action: request.action,
          resource: request.resource,
          outcome: "allow",
          reason: decision.reason,
          mandateId: decision.mandateId,
          ...contextFields(request.context),
          timestamp: new Date().toISOString(),
        });
        return decision.mandateId ?? null;
      }
      await this.emitDecisionEvent({
        principal: this.principal,
        action: request.action,
        resource: request.resource,
        outcome: "deny",
        reason: decision.reason ?? "denied_by_policy",
        mandateId: decision.mandateId,
        ...contextFields(request.context),
        timestamp: new Date().toISOString(),
      });
      throw new ActionDeniedError(decision.reason ?? "denied_by_policy");
    } catch (error) {
      if (error instanceof ActionDeniedError) {
        throw error;
      }
      if (error instanceof SidecarUnavailableError) {
        await this.emitDecisionEvent({
          principal: this.principal,
          action: request.action,
          resource: request.resource,
          outcome: "error",
          reason: error.message,
          ...contextFields(request.context),
          timestamp: new Date().toISOString(),
        });
        throw error;
      }
      await this.emitDecisionEvent({
        principal: this.principal,
        action: request.action,
        resource: request.resource,
        outcome: "error",
        reason: "Predicate sidecar unavailable",
        ...contextFields(request.context),
        timestamp: new Date().toISOString(),
      });
      throw new SidecarUnavailableError("Predicate sidecar unavailable");
    }
  }

  async guardOrThrow(request: GuardRequest): Promise<string | null> {
    try {
      return await this.authorize(request);
    } catch (error) {
      if (
        error instanceof SidecarUnavailableError &&
        this.config.failClosed === false
      ) {
        return null;
      }
      throw error;
    }
  }

  private async emitDecisionEvent(event: DecisionTelemetryEvent): Promise<void> {
    this.telemetry?.onDecision?.(event);
    if (!this.auditExporter) {
      return;
    }
    try {
      await this.auditExporter.exportDecision(event);
    } catch {
      // Best-effort export; authorization path must not fail on telemetry sink issues.
    }
  }
}

function labelsFromContext(
  context: Record<string, unknown> | undefined,
): string[] {
  if (!context) return [];
  const labels: string[] = [];
  const source = context.source;
  if (typeof source === "string" && source.length > 0) {
    labels.push(`source:${source}`);
  }
  return labels;
}

function contextFields(
  context: Record<string, unknown> | undefined,
): Pick<
  DecisionTelemetryEvent,
  "sessionId" | "tenantId" | "userId" | "traceId" | "source"
> {
  return {
    sessionId:
      typeof context?.session_id === "string" ? context.session_id : undefined,
    tenantId:
      typeof context?.tenant_id === "string" ? context.tenant_id : undefined,
    userId: typeof context?.user_id === "string" ? context.user_id : undefined,
    traceId:
      typeof context?.trace_id === "string" ? context.trace_id : undefined,
    source: typeof context?.source === "string" ? context.source : undefined,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableJson(v)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export { ActionDeniedError, SidecarUnavailableError } from "./errors.js";
