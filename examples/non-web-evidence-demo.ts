/**
 * Non-Web Evidence Provider Demo
 *
 * This example demonstrates how to use the terminal and desktop accessibility
 * evidence providers with canonical hashing for reproducible state_hash computation.
 *
 * The canonicalization ensures that minor variations (ANSI codes, timestamps,
 * whitespace) don't break hash verification.
 *
 * Run with: npx tsx examples/non-web-evidence-demo.ts
 */

import {
  OpenClawTerminalEvidenceProvider,
  OpenClawDesktopAccessibilityEvidenceProvider,
  buildTerminalEvidenceFromProvider,
  buildDesktopEvidenceFromProvider,
  type TerminalRuntimeContext,
  type DesktopRuntimeContext,
} from "../src/index.js";

// ============================================================================
// Terminal Evidence Demo
// ============================================================================

async function demoTerminalEvidence(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Terminal Evidence Provider Demo");
  console.log("=".repeat(60));

  // Simulated terminal runtime context (in real usage, capture from actual terminal)
  const terminalContext: TerminalRuntimeContext = {
    sessionId: "demo-session-001",
    terminalId: "term-1",
    cwd: "/workspace/./src/../src", // Will be normalized to /workspace/src
    command: "git   status  ", // Extra whitespace will be collapsed
    // Transcript with ANSI codes and timestamps that will be normalized
    transcript: `\x1b[32m[12:34:56]\x1b[0m Running git status...
On branch main
Your branch is up to date with 'origin/main'.

\x1b[33mnothing to commit, working tree clean\x1b[0m`,
    env: {
      HOME: "/home/user",
      PATH: "/usr/bin:/bin",
      AWS_SECRET_KEY: "should-be-redacted", // Secrets are redacted
      EDITOR: "vim",
    },
  };

  // Create provider with capture function
  const terminalProvider = new OpenClawTerminalEvidenceProvider(
    () => terminalContext,
  );

  // Build evidence with canonical hashing (default)
  const terminalEvidence = await buildTerminalEvidenceFromProvider(
    terminalProvider,
    { useCanonicalHash: true },
  );

  console.log("\nTerminal Evidence:");
  console.log(JSON.stringify(terminalEvidence, null, 2));

  // Demonstrate hash stability - same content with different formatting
  const terminalContext2: TerminalRuntimeContext = {
    ...terminalContext,
    cwd: "/workspace/src", // Same path after normalization
    command: "git status", // Same command after whitespace collapse
    // Same content without ANSI codes and different timestamps
    transcript: `[09:00:00] Running git status...
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean`,
  };

  const terminalProvider2 = new OpenClawTerminalEvidenceProvider(
    () => terminalContext2,
  );

  const terminalEvidence2 = await buildTerminalEvidenceFromProvider(
    terminalProvider2,
    { useCanonicalHash: true },
  );

  console.log("\nTerminal Evidence (normalized variant):");
  console.log(JSON.stringify(terminalEvidence2, null, 2));

  const hashesMatch = terminalEvidence.state_hash === terminalEvidence2.state_hash;
  console.log(`\nHashes match: ${hashesMatch ? "YES (canonicalization working)" : "NO"}`);
}

// ============================================================================
// Desktop Accessibility Evidence Demo
// ============================================================================

async function demoDesktopEvidence(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("Desktop Accessibility Evidence Provider Demo");
  console.log("=".repeat(60));

  // Simulated desktop accessibility context
  const desktopContext: DesktopRuntimeContext = {
    appName: "  Visual Studio Code  ", // Will be trimmed and normalized
    windowTitle: "main.ts - my-project",
    focusedRole: "editor",
    focusedName: "Text Editor",
    // Simulated UI tree text (in real usage, capture from OS accessibility API)
    uiTreeText: `
      Window: Visual Studio Code
        Toolbar:
          Button:   New File
          Button: Save
        Editor:
          TextArea: main.ts content
        StatusBar:
          Label: Ln 42, Col 15
    `,
    confidence: 0.95,
  };

  // Create provider with capture function
  const desktopProvider = new OpenClawDesktopAccessibilityEvidenceProvider(
    () => desktopContext,
  );

  // Build evidence with canonical hashing
  const desktopEvidence = await buildDesktopEvidenceFromProvider(
    desktopProvider,
    { useCanonicalHash: true },
  );

  console.log("\nDesktop Evidence:");
  console.log(JSON.stringify(desktopEvidence, null, 2));

  // Demonstrate hash stability with whitespace variations
  const desktopContext2: DesktopRuntimeContext = {
    ...desktopContext,
    appName: "Visual Studio Code", // Same after normalization
    // Same content with different whitespace
    uiTreeText: `Window: Visual Studio Code
Toolbar:
Button: New File
Button: Save
Editor:
TextArea: main.ts content
StatusBar:
Label: Ln 42, Col 15`,
  };

  const desktopProvider2 = new OpenClawDesktopAccessibilityEvidenceProvider(
    () => desktopContext2,
  );

  const desktopEvidence2 = await buildDesktopEvidenceFromProvider(
    desktopProvider2,
    { useCanonicalHash: true },
  );

  console.log("\nDesktop Evidence (normalized variant):");
  console.log(JSON.stringify(desktopEvidence2, null, 2));

  const hashesMatch = desktopEvidence.state_hash === desktopEvidence2.state_hash;
  console.log(`\nHashes match: ${hashesMatch ? "YES (canonicalization working)" : "NO"}`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("OpenClaw Non-Web Evidence Provider Demo");
  console.log("Demonstrates canonical hashing for terminal and desktop contexts\n");

  await demoTerminalEvidence();
  await demoDesktopEvidence();

  console.log("\n" + "=".repeat(60));
  console.log("Demo complete!");
  console.log("=".repeat(60));
}

main().catch(console.error);
