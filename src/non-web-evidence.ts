import {
  type DesktopAccessibilityEvidenceProvider,
  type DesktopAccessibilitySnapshot,
  type StateEvidence,
  type TerminalEvidenceProvider,
  type TerminalSessionSnapshot,
  buildDesktopAccessibilityStateEvidence,
  buildTerminalStateEvidence,
} from "@predicatesystems/authority";

export interface TerminalRuntimeContext {
  sessionId: string;
  terminalId?: string;
  cwd?: string;
  command?: string;
  /** Raw transcript text (will be canonicalized before hashing) */
  transcript?: string;
  observedAt?: string;
  confidence?: number;
  /** Environment variables (secrets will be redacted before hashing) */
  env?: Record<string, string>;
}

export interface DesktopRuntimeContext {
  appName?: string;
  windowTitle?: string;
  focusedRole?: string;
  focusedName?: string;
  /** Raw UI tree text (will be normalized before hashing) */
  uiTreeText?: string;
  /** Pre-computed UI tree hash (bypasses canonicalization) */
  uiTreeHash?: string;
  observedAt?: string;
  confidence?: number;
}

export class OpenClawTerminalEvidenceProvider
  implements TerminalEvidenceProvider
{
  constructor(
    private readonly capture: () =>
      | Promise<TerminalRuntimeContext>
      | TerminalRuntimeContext,
  ) {}

  async captureTerminalSnapshot(): Promise<TerminalSessionSnapshot> {
    const runtime = await this.capture();
    return {
      session_id: runtime.sessionId,
      terminal_id: runtime.terminalId,
      cwd: runtime.cwd,
      command: runtime.command,
      // Pass raw transcript - canonicalization happens in buildTerminalStateEvidence
      // when useCanonicalHash is enabled. The field is named transcript_hash for
      // backward compatibility but carries raw text when canonical hashing is used.
      transcript_hash: runtime.transcript ?? "",
      observed_at: runtime.observedAt ?? new Date().toISOString(),
      confidence: runtime.confidence,
    };
  }
}

export class OpenClawDesktopAccessibilityEvidenceProvider
  implements DesktopAccessibilityEvidenceProvider
{
  constructor(
    private readonly capture: () =>
      | Promise<DesktopRuntimeContext>
      | DesktopRuntimeContext,
  ) {}

  async captureAccessibilitySnapshot(): Promise<DesktopAccessibilitySnapshot> {
    const runtime = await this.capture();
    // Pass raw UI tree text - canonicalization happens in buildDesktopAccessibilityStateEvidence
    // when useCanonicalHash is enabled. Use pre-computed hash if available for legacy mode.
    // The field is named ui_tree_hash for backward compatibility but carries raw text
    // when canonical hashing is used.
    return {
      app_name: runtime.appName,
      window_title: runtime.windowTitle,
      focused_role: runtime.focusedRole,
      focused_name: runtime.focusedName,
      ui_tree_hash: runtime.uiTreeHash ?? runtime.uiTreeText ?? "",
      observed_at: runtime.observedAt ?? new Date().toISOString(),
      confidence: runtime.confidence,
    };
  }
}

export interface BuildEvidenceOptions {
  /**
   * Use canonical hashing with proper normalization.
   * When true, applies ANSI stripping, timestamp normalization, whitespace
   * collapsing, and other canonicalization rules for reproducible hashes.
   * @default true
   */
  useCanonicalHash?: boolean;
}

export async function buildTerminalEvidenceFromProvider(
  provider: TerminalEvidenceProvider,
  options: BuildEvidenceOptions = {},
): Promise<StateEvidence> {
  const snapshot = await provider.captureTerminalSnapshot();
  const useCanonicalHash = options.useCanonicalHash ?? true;
  return buildTerminalStateEvidence({ snapshot, useCanonicalHash });
}

export async function buildDesktopEvidenceFromProvider(
  provider: DesktopAccessibilityEvidenceProvider,
  options: BuildEvidenceOptions = {},
): Promise<StateEvidence> {
  const snapshot = await provider.captureAccessibilitySnapshot();
  const useCanonicalHash = options.useCanonicalHash ?? true;
  return buildDesktopAccessibilityStateEvidence({ snapshot, useCanonicalHash });
}
