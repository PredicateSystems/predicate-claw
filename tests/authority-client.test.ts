import { describe, expect, it } from "vitest";
import { createAuthorityAdapter } from "../src/authority-client.js";

describe("createAuthorityAdapter", () => {
  it("maps SDK allow decisions", async () => {
    const adapter = createAuthorityAdapter({
      authorize: async () => ({
        allowed: true,
        reason: "allowed",
        mandate_id: "mnd_ok",
      }),
    });

    const decision = await adapter.authorize({
      principal: "agent:openclaw-local",
      action: "shell.execute",
      resource: "echo hi",
      intent_hash: "ih",
      labels: [],
    });

    expect(decision).toEqual({
      allow: true,
      reason: "allowed",
      mandateId: "mnd_ok",
    });
  });

  it("maps SDK deny decisions", async () => {
    const adapter = createAuthorityAdapter({
      authorize: async () => ({
        allowed: false,
        reason: "explicit_deny",
        mandate_id: undefined,
      }),
    });

    const decision = await adapter.authorize({
      principal: "agent:openclaw-local",
      action: "fs.read",
      resource: "/etc/passwd",
      intent_hash: "ih",
      labels: ["source:untrusted_dm"],
    });

    expect(decision).toEqual({
      allow: false,
      reason: "explicit_deny",
      mandateId: undefined,
    });
  });
});
