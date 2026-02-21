import crypto from "node:crypto";
import {
  buildWebStateEvidence,
  buildWebStateEvidenceFromRuntimeSnapshot,
  type RuntimeSnapshotLike,
  type StateEvidence,
  type WebStateSnapshot,
} from "@predicatesystems/authority";

/**
 * Runtime context captured from OpenClaw web agent execution environment.
 * Maps to ts-predicate-authority WebStateSnapshot contract.
 */
export interface WebRuntimeContext {
  url?: string;
  title?: string;
  domHtml?: string;
  domHash?: string;
  visibleText?: string;
  visibleTextHash?: string;
  eventId?: string;
  observedAt?: string;
  dominantGroupKey?: string;
  snapshotTimestamp?: string;
  confidence?: number;
  confidenceReasons?: string[];
}

/**
 * Provider interface for web state evidence capture.
 * Implementations should capture browser/DOM state from the agent runtime.
 */
export interface WebEvidenceProvider {
  captureWebSnapshot(): Promise<WebStateSnapshot>;
}

/**
 * OpenClaw-specific web evidence provider.
 * Captures web state from the agent runtime and maps to TS SDK contract.
 */
export class OpenClawWebEvidenceProvider implements WebEvidenceProvider {
  constructor(
    private readonly capture: () =>
      | Promise<WebRuntimeContext>
      | WebRuntimeContext,
  ) {}

  async captureWebSnapshot(): Promise<WebStateSnapshot> {
    const runtime = await this.capture();
    return {
      url: runtime.url,
      title: runtime.title,
      dom_hash: runtime.domHash ?? sha256(runtime.domHtml ?? ""),
      visible_text_hash:
        runtime.visibleTextHash ?? sha256(runtime.visibleText ?? ""),
      event_id: runtime.eventId,
      observed_at: runtime.observedAt ?? new Date().toISOString(),
      dominant_group_key: runtime.dominantGroupKey,
      snapshot_timestamp: runtime.snapshotTimestamp,
      confidence: runtime.confidence,
      confidence_reasons: runtime.confidenceReasons,
    };
  }
}

/**
 * Build StateEvidence from an OpenClaw web evidence provider.
 */
export async function buildWebEvidenceFromProvider(
  provider: WebEvidenceProvider,
  options?: { schemaVersion?: string },
): Promise<StateEvidence> {
  const snapshot = await provider.captureWebSnapshot();
  return buildWebStateEvidence({
    snapshot,
    schemaVersion: options?.schemaVersion ?? "v1",
  });
}

/**
 * Convenience adapter for predicate-runtime snapshot output.
 * Maps RuntimeSnapshotLike to StateEvidence directly.
 */
export function buildWebEvidenceFromRuntimeSnapshot(
  snapshot: RuntimeSnapshotLike,
  options?: { schemaVersion?: string },
): StateEvidence {
  return buildWebStateEvidenceFromRuntimeSnapshot(snapshot, {
    schemaVersion: options?.schemaVersion ?? "v1",
  });
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
