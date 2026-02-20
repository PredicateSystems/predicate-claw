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

export interface ControlPlaneSyncStatus {
  policyVersion: string;
  revocationVersion: string;
  pinnedPolicyVersion?: string;
  policyVersionMismatch: boolean;
  stale: boolean;
  syncAgeMs: number;
  lastSyncedAtMs: number;
}

export interface ControlPlaneSyncStatusTrackerOptions {
  pinnedPolicyVersion?: string;
  staleAfterMs?: number;
  onStatus?: (status: ControlPlaneSyncStatus) => void;
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

export class ControlPlaneSyncStatusTracker {
  private readonly pinnedPolicyVersion?: string;
  private readonly staleAfterMs: number;
  private readonly onStatus?: (status: ControlPlaneSyncStatus) => void;
  private latest?: {
    policyVersion: string;
    revocationVersion: string;
    lastSyncedAtMs: number;
  };

  constructor(options?: ControlPlaneSyncStatusTrackerOptions) {
    this.pinnedPolicyVersion = options?.pinnedPolicyVersion;
    this.staleAfterMs = options?.staleAfterMs ?? 300000;
    this.onStatus = options?.onStatus;
  }

  recordSync(
    snapshot: { policy: PolicySyncSnapshot; revocations: RevocationSyncSnapshot },
    nowMs: number = Date.now(),
  ): ControlPlaneSyncStatus {
    this.latest = {
      policyVersion: snapshot.policy.version,
      revocationVersion: snapshot.revocations.version,
      lastSyncedAtMs: nowMs,
    };
    const status = this.snapshot(nowMs);
    this.onStatus?.(status);
    return status;
  }

  snapshot(nowMs: number = Date.now()): ControlPlaneSyncStatus {
    if (!this.latest) {
      return {
        policyVersion: "unknown",
        revocationVersion: "unknown",
        pinnedPolicyVersion: this.pinnedPolicyVersion,
        policyVersionMismatch: false,
        stale: true,
        syncAgeMs: Number.POSITIVE_INFINITY,
        lastSyncedAtMs: 0,
      };
    }
    const syncAgeMs = Math.max(0, nowMs - this.latest.lastSyncedAtMs);
    const policyVersionMismatch =
      typeof this.pinnedPolicyVersion === "string" &&
      this.pinnedPolicyVersion.length > 0
        ? this.latest.policyVersion !== this.pinnedPolicyVersion
        : false;
    return {
      policyVersion: this.latest.policyVersion,
      revocationVersion: this.latest.revocationVersion,
      pinnedPolicyVersion: this.pinnedPolicyVersion,
      policyVersionMismatch,
      stale: syncAgeMs > this.staleAfterMs,
      syncAgeMs,
      lastSyncedAtMs: this.latest.lastSyncedAtMs,
    };
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
