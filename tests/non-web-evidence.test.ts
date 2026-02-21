import { describe, expect, it } from "vitest";
import {
  OpenClawDesktopAccessibilityEvidenceProvider,
  OpenClawTerminalEvidenceProvider,
  buildDesktopEvidenceFromProvider,
  buildTerminalEvidenceFromProvider,
} from "../src/non-web-evidence.js";

describe("non-web evidence providers", () => {
  describe("legacy mode (useCanonicalHash=false)", () => {
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
      const evidence = await buildTerminalEvidenceFromProvider(provider, {
        useCanonicalHash: false,
      });

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
      const evidence = await buildDesktopEvidenceFromProvider(provider, {
        useCanonicalHash: false,
      });

      expect(snapshot.ui_tree_hash).toEqual(expect.any(String));
      expect(evidence).toMatchObject({
        source: "desktop_accessibility",
        schema_version: "desktop-a11y-v1",
        confidence: 0.88,
      });
      expect(evidence.state_hash).toEqual(expect.any(String));
    });
  });

  describe("canonical mode (default)", () => {
    it("builds terminal evidence with canonical schema version", async () => {
      const provider = new OpenClawTerminalEvidenceProvider(() => ({
        sessionId: "s-1",
        terminalId: "t-1",
        cwd: "/workspace",
        command: "npm test",
        transcript: "\x1b[32mPASS\x1b[0m all tests",
        observedAt: "2026-02-20T08:00:00.000Z",
        confidence: 0.95,
      }));

      const evidence = await buildTerminalEvidenceFromProvider(provider);

      expect(evidence).toMatchObject({
        source: "terminal",
        schema_version: "terminal:v1.0",
        confidence: 0.95,
      });
      expect(evidence.state_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("builds desktop evidence with canonical schema version", async () => {
      const provider = new OpenClawDesktopAccessibilityEvidenceProvider(() => ({
        appName: "Firefox",
        windowTitle: "GitHub",
        focusedRole: "button",
        focusedName: "Submit",
        uiTreeText: "window > form > button:Submit",
        observedAt: "2026-02-20T08:01:00.000Z",
        confidence: 0.9,
      }));

      const evidence = await buildDesktopEvidenceFromProvider(provider);

      expect(evidence).toMatchObject({
        source: "desktop_accessibility",
        schema_version: "desktop:v1.0",
        confidence: 0.9,
      });
      expect(evidence.state_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("produces stable hashes for equivalent terminal inputs", async () => {
      // Same content with different whitespace/ANSI codes
      const provider1 = new OpenClawTerminalEvidenceProvider(() => ({
        sessionId: "s-1",
        command: "  npm   test  ",
        transcript: "\x1b[32mOK\x1b[0m",
      }));

      const provider2 = new OpenClawTerminalEvidenceProvider(() => ({
        sessionId: "s-1",
        command: "npm test",
        transcript: "OK",
      }));

      const evidence1 = await buildTerminalEvidenceFromProvider(provider1);
      const evidence2 = await buildTerminalEvidenceFromProvider(provider2);

      // Canonical hashing should produce identical hashes
      expect(evidence1.state_hash).toBe(evidence2.state_hash);
    });

    it("produces stable hashes for equivalent desktop inputs", async () => {
      // Same content with different whitespace
      const provider1 = new OpenClawDesktopAccessibilityEvidenceProvider(() => ({
        appName: "  Firefox  ",
        windowTitle: "  GitHub  ",
        focusedRole: "BUTTON",
        focusedName: "  Submit  ",
      }));

      const provider2 = new OpenClawDesktopAccessibilityEvidenceProvider(() => ({
        appName: "Firefox",
        windowTitle: "GitHub",
        focusedRole: "button",
        focusedName: "Submit",
      }));

      const evidence1 = await buildDesktopEvidenceFromProvider(provider1);
      const evidence2 = await buildDesktopEvidenceFromProvider(provider2);

      // Canonical hashing should produce identical hashes
      expect(evidence1.state_hash).toBe(evidence2.state_hash);
    });

    it("passes raw transcript for canonical hashing in SDK", async () => {
      const provider = new OpenClawTerminalEvidenceProvider(() => ({
        sessionId: "s-1",
        transcript: "\x1b[31mERROR\x1b[0m: something went wrong",
      }));

      const snapshot = await provider.captureTerminalSnapshot();

      // transcript_hash now contains raw text (hashing is done by SDK when useCanonicalHash=true)
      expect(snapshot.transcript_hash).toEqual(expect.any(String));
      // Raw transcript with ANSI codes is 36 chars
      expect(snapshot.transcript_hash).toBe("\x1b[31mERROR\x1b[0m: something went wrong");

      // Verify the final evidence hash is canonical (sha256-prefixed)
      const evidence = await buildTerminalEvidenceFromProvider(provider);
      expect(evidence.state_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  });
});
