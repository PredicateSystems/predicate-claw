import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildWebEvidenceFromProvider,
  buildWebEvidenceFromRuntimeSnapshot,
  OpenClawWebEvidenceProvider,
  type WebRuntimeContext,
} from "../src/web-evidence.js";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

describe("web evidence providers", () => {
  it("builds web state evidence from OpenClaw runtime context", async () => {
    const mockContext: WebRuntimeContext = {
      url: "https://example.com/dashboard",
      title: "Dashboard - Example App",
      domHtml: "<html><body><h1>Dashboard</h1></body></html>",
      visibleText: "Dashboard",
      eventId: "evt-123",
      observedAt: "2026-02-20T12:00:00Z",
      dominantGroupKey: "main-content",
      confidence: 0.95,
      confidenceReasons: ["stable_dom", "no_pending_requests"],
    };

    const provider = new OpenClawWebEvidenceProvider(() => mockContext);
    const evidence = await buildWebEvidenceFromProvider(provider);

    expect(evidence.source).toBe("browser");
    expect(evidence.schema_version).toBe("v1");
    expect(evidence.state_hash).toBeDefined();
    expect(typeof evidence.state_hash).toBe("string");
    expect(evidence.confidence).toBe(0.95);
  });

  it("computes dom_hash when domHtml provided without domHash", async () => {
    const domHtml = "<html><body>Test</body></html>";
    const expectedHash = sha256(domHtml);

    const provider = new OpenClawWebEvidenceProvider(() => ({
      url: "https://example.com",
      domHtml,
    }));

    const snapshot = await provider.captureWebSnapshot();
    expect(snapshot.dom_hash).toBe(expectedHash);
  });

  it("computes visible_text_hash when visibleText provided without hash", async () => {
    const visibleText = "Hello World";
    const expectedHash = sha256(visibleText);

    const provider = new OpenClawWebEvidenceProvider(() => ({
      url: "https://example.com",
      visibleText,
    }));

    const snapshot = await provider.captureWebSnapshot();
    expect(snapshot.visible_text_hash).toBe(expectedHash);
  });

  it("uses provided hashes when available", async () => {
    const precomputedDomHash = "abc123";
    const precomputedTextHash = "def456";

    const provider = new OpenClawWebEvidenceProvider(() => ({
      url: "https://example.com",
      domHash: precomputedDomHash,
      visibleTextHash: precomputedTextHash,
    }));

    const snapshot = await provider.captureWebSnapshot();
    expect(snapshot.dom_hash).toBe(precomputedDomHash);
    expect(snapshot.visible_text_hash).toBe(precomputedTextHash);
  });

  it("builds evidence from predicate-runtime snapshot format", () => {
    const runtimeSnapshot = {
      url: "https://example.com/page",
      timestamp: "2026-02-20T12:00:00Z",
      dominant_group_key: "content-area",
      diagnostics: {
        confidence: 0.88,
        reasons: ["dom_stable"],
      },
    };

    const evidence = buildWebEvidenceFromRuntimeSnapshot(runtimeSnapshot);

    expect(evidence.source).toBe("browser");
    expect(evidence.schema_version).toBe("v1");
    expect(evidence.confidence).toBe(0.88);
  });

  it("handles async capture functions", async () => {
    const asyncCapture = async (): Promise<WebRuntimeContext> => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return {
        url: "https://async.example.com",
        title: "Async Page",
      };
    };

    const provider = new OpenClawWebEvidenceProvider(asyncCapture);
    const snapshot = await provider.captureWebSnapshot();

    expect(snapshot.url).toBe("https://async.example.com");
    expect(snapshot.title).toBe("Async Page");
    expect(snapshot.observed_at).toBeDefined();
  });
});
