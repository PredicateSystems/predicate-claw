import { describe, expect, it } from "vitest";
import {
  OpenClawDesktopAccessibilityEvidenceProvider,
  OpenClawTerminalEvidenceProvider,
  buildDesktopEvidenceFromProvider,
  buildTerminalEvidenceFromProvider,
} from "../src/non-web-evidence.js";

describe("non-web evidence providers", () => {
  it("builds terminal session state evidence", async () => {
    const provider = new OpenClawTerminalEvidenceProvider(() => ({
      sessionId: "s-1",
      terminalId: "t-1",
      cwd: "/workspace",
      command: "cat secrets.txt",
      transcript: "line1\nline2\n",
      observedAt: "2026-02-20T08:00:00.000Z",
      confidence: 0.92,
    }));

    const snapshot = await provider.captureTerminalSnapshot();
    const evidence = await buildTerminalEvidenceFromProvider(provider);

    expect(snapshot.session_id).toBe("s-1");
    expect(snapshot.transcript_hash).toEqual(expect.any(String));
    expect(evidence).toMatchObject({
      source: "terminal",
      schema_version: "terminal-v1",
      confidence: 0.92,
    });
    expect(evidence.state_hash).toEqual(expect.any(String));
  });

  it("builds desktop accessibility state evidence", async () => {
    const provider = new OpenClawDesktopAccessibilityEvidenceProvider(() => ({
      appName: "Terminal",
      windowTitle: "Deploy Prod",
      focusedRole: "button",
      focusedName: "Confirm",
      uiTreeText: "root > dialog > button:Confirm",
      observedAt: "2026-02-20T08:01:00.000Z",
      confidence: 0.88,
    }));

    const snapshot = await provider.captureAccessibilitySnapshot();
    const evidence = await buildDesktopEvidenceFromProvider(provider);

    expect(snapshot.ui_tree_hash).toEqual(expect.any(String));
    expect(evidence).toMatchObject({
      source: "desktop_accessibility",
      schema_version: "desktop-a11y-v1",
      confidence: 0.88,
    });
    expect(evidence.state_hash).toEqual(expect.any(String));
  });
});
