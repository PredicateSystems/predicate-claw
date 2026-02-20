import {
  AuthorityClient,
  type AuthorizationRequest,
} from "@predicatesystems/authority";
import type { ProviderConfig } from "./config.js";

export interface AuthorityDecision {
  allow: boolean;
  reason?: string;
  mandateId?: string;
}

export interface AuthorityAdapter {
  authorize(request: AuthorizationRequest): Promise<AuthorityDecision>;
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
  return createAuthorityAdapter(sdkClient);
}
