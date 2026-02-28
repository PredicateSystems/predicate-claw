import {
  AuthorityClient,
  Verifier,
  type AuthorizationRequest,
  type VerifyRequest,
  type ActualOperation,
} from "@predicatesystems/authority";
import type { ProviderConfig } from "./config.js";

export type { VerifyRequest, ActualOperation };

export interface AuthorityDecision {
  allow: boolean;
  reason?: string;
  mandateId?: string;
}

export interface VerificationResult {
  verified: boolean;
  reason?: string;
  auditId?: string;
  authorized?: { action: string; resource: string };
  actual?: { action: string; resource: string };
}

export interface AuthorityAdapter {
  authorize(request: AuthorizationRequest): Promise<AuthorityDecision>;
  verify?(request: VerifyRequest): Promise<VerificationResult>;
}

interface SdkDecision {
  allowed: boolean;
  reason?: string;
  mandate_id?: string | null;
}

interface SdkLike {
  authorize(request: AuthorizationRequest): Promise<SdkDecision>;
}

export function createAuthorityAdapter(client: SdkLike): AuthorityAdapter {
  return {
    async authorize(request: AuthorizationRequest): Promise<AuthorityDecision> {
      const decision = await client.authorize(request);
      return {
        allow: decision.allowed,
        reason: decision.reason,
        mandateId: decision.mandate_id ?? undefined,
      };
    },
  };
}

export function createDefaultAuthorityAdapter(
  config: ProviderConfig,
): AuthorityAdapter {
  const sdkClient = new AuthorityClient({
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    backoffInitialMs: config.backoffInitialMs,
  });

  // Create verifier for post-execution verification
  const verifier = new Verifier({
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  });

  return {
    async authorize(request: AuthorizationRequest): Promise<AuthorityDecision> {
      const decision = await sdkClient.authorize(request);
      return {
        allow: decision.allowed,
        reason: decision.reason,
        mandateId: decision.mandate_id ?? undefined,
      };
    },

    async verify(request: VerifyRequest): Promise<VerificationResult> {
      const result = await verifier.verify(request);
      return {
        verified: result.verified,
        reason: result.reason,
        auditId: result.auditId,
        authorized: result.details?.authorized
          ? { action: result.details.authorized.action, resource: result.details.authorized.resource }
          : undefined,
        actual: result.details?.actual
          ? { action: result.details.actual.action, resource: result.details.actual.resource }
          : undefined,
      };
    },
  };
}
