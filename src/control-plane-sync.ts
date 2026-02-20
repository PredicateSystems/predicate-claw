export interface ControlPlaneSyncConfig {
  baseUrl: string;
  tenantId: string;
  timeoutMs?: number;
}

export interface PolicySyncSnapshot {
  version: string;
  cursor: string;
  rules: unknown[];
}

export interface RevocationSyncSnapshot {
  version: string;
  cursor: string;
  revoked: unknown[];
}

export class ControlPlaneSyncClient {
  private readonly baseUrl: string;
  private readonly tenantId: string;
  private readonly timeoutMs: number;

  constructor(config: ControlPlaneSyncConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.tenantId = config.tenantId;
    this.timeoutMs = config.timeoutMs ?? 3000;
  }

  async pullPolicySnapshot(
    cursor?: string,
  ): Promise<PolicySyncSnapshot> {
    const url = new URL(`${this.baseUrl}/v1/policy/sync`);
    url.searchParams.set("tenant_id", this.tenantId);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }
    const response = await this.fetchWithTimeout(url.toString());
    if (!response.ok) {
      throw new Error(`policy sync failed: ${response.status}`);
    }
    return (await response.json()) as PolicySyncSnapshot;
  }

  async pullRevocationSnapshot(
    cursor?: string,
  ): Promise<RevocationSyncSnapshot> {
    const url = new URL(`${this.baseUrl}/v1/revocations/sync`);
    url.searchParams.set("tenant_id", this.tenantId);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }
    const response = await this.fetchWithTimeout(url.toString());
    if (!response.ok) {
      throw new Error(`revocation sync failed: ${response.status}`);
    }
    return (await response.json()) as RevocationSyncSnapshot;
  }

  private async fetchWithTimeout(input: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(input, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function syncControlPlaneState(
  client: ControlPlaneSyncClient,
  cursors?: { policyCursor?: string; revocationCursor?: string },
): Promise<{
  policy: PolicySyncSnapshot;
  revocations: RevocationSyncSnapshot;
}> {
  const [policy, revocations] = await Promise.all([
    client.pullPolicySnapshot(cursors?.policyCursor),
    client.pullRevocationSnapshot(cursors?.revocationCursor),
  ]);
  return { policy, revocations };
}
