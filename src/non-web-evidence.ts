import crypto from "node:crypto";
import {
  buildDesktopAccessibilityStateEvidence,
  buildTerminalStateEvidence,
  type DesktopAccessibilityEvidenceProvider,
  type DesktopAccessibilitySnapshot,
  type StateEvidence,
  type TerminalEvidenceProvider,
  type TerminalSessionSnapshot,
} from "@predicatesystems/authority";

export interface TerminalRuntimeContext {
  sessionId: string;
  terminalId?: string;
  cwd?: string;
  command?: string;
  transcript?: string;
  observedAt?: string;
  confidence?: number;
}

export interface DesktopRuntimeContext {
  appName?: string;
  windowTitle?: string;
  focusedRole?: string;
  focusedName?: string;
  uiTreeText?: string;
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
      transcript_hash: sha256(runtime.transcript ?? ""),
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
    return {
      app_name: runtime.appName,
      window_title: runtime.windowTitle,
      focused_role: runtime.focusedRole,
      focused_name: runtime.focusedName,
      ui_tree_hash: runtime.uiTreeHash ?? sha256(runtime.uiTreeText ?? ""),
      observed_at: runtime.observedAt ?? new Date().toISOString(),
      confidence: runtime.confidence,
    };
  }
}

export async function buildTerminalEvidenceFromProvider(
  provider: TerminalEvidenceProvider,
): Promise<StateEvidence> {
  const snapshot = await provider.captureTerminalSnapshot();
  return buildTerminalStateEvidence({ snapshot });
}

export async function buildDesktopEvidenceFromProvider(
  provider: DesktopAccessibilityEvidenceProvider,
): Promise<StateEvidence> {
  const snapshot = await provider.captureAccessibilitySnapshot();
  return buildDesktopAccessibilityStateEvidence({ snapshot });
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
