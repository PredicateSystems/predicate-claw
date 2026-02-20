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
}

export class GuardedProvider {
  private readonly principal: string;
  private readonly config: ProviderConfig;
  private readonly authorityClient: AuthorityAdapter;

  constructor(options: GuardedProviderOptions) {
    this.principal = options.principal;
    this.config = { ...defaultProviderConfig, ...(options.config ?? {}) };
    this.authorityClient =
      options.authorityClient ?? createDefaultAuthorityAdapter(this.config);
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
        return decision.mandateId ?? null;
      }
      throw new ActionDeniedError(decision.reason ?? "denied_by_policy");
    } catch (error) {
      if (error instanceof ActionDeniedError) {
        throw error;
      }
      if (error instanceof SidecarUnavailableError) {
        throw error;
      }
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
