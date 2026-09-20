import { beforeEach, describe, expect, it, vi } from "vitest";

// _shared/deno/env.ts is excluded from this package's tsconfig.json (Deno
// entrypoint glue — it reads `Deno.env.get`, a global that doesn't exist
// under Node/Vitest) but its logic is plain, portable functions with no
// other Deno-only surface (no `Deno.serve`, no top-level `Deno.env.get`
// calls at module scope), so — same shim pattern as
// `admin/index.test.ts` uses for a real `Deno.serve` entrypoint — stubbing
// the minimal `Deno.env.get` surface it touches lets this file exercise the
// real implementation under Vitest rather than re-deriving its logic in a
// parallel, untested copy.
const envMap = new Map<string, string>();

vi.stubGlobal("Deno", {
  env: {
    get: (name: string) => envMap.get(name),
  },
});

const { requireRetellWebhookKey } = await import("./env.ts");

describe("requireRetellWebhookKey (OPS-4)", () => {
  beforeEach(() => {
    envMap.clear();
  });

  it("falls back to RETELL_API_KEY when RETELL_WEBHOOK_SIGNING_SECRET is unset", () => {
    // FACT (docs.retellai.com/features/webhook-overview, confirmed
    // 2026-09-20): Retell signs every webhook with the account's API key —
    // there is no separate webhook-signing secret, so this is the normal
    // case on a live project.
    envMap.set("RETELL_API_KEY", "key_live_abc123");

    expect(requireRetellWebhookKey()).toBe("key_live_abc123");
  });

  it("prefers RETELL_WEBHOOK_SIGNING_SECRET when explicitly set (rotation override)", () => {
    envMap.set("RETELL_WEBHOOK_SIGNING_SECRET", "override_secret");
    envMap.set("RETELL_API_KEY", "key_live_abc123");

    expect(requireRetellWebhookKey()).toBe("override_secret");
  });

  it("throws only when neither var is set — fails closed (CLAUDE.md Rule 2)", () => {
    expect(() => requireRetellWebhookKey()).toThrow(/Missing Retell webhook signing key/);
  });

  it("does not fall back when RETELL_WEBHOOK_SIGNING_SECRET is an empty string", () => {
    envMap.set("RETELL_WEBHOOK_SIGNING_SECRET", "");
    envMap.set("RETELL_API_KEY", "key_live_abc123");

    expect(requireRetellWebhookKey()).toBe("key_live_abc123");
  });
});
