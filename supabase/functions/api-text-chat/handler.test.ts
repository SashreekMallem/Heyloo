import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { TextAgentDeps } from "../_shared/text-agent/engine.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { handleTextChat } from "./handler.ts";

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const WIDGET_SECRET = "widget-secret";

/** Mints a token the exact way `apps/web/src/lib/widget/session-token.ts`'s
 * `mintWidgetToken` does (Node's own `node:crypto`/`Buffer`) — this is a
 * Node/Vitest-only test file, never deployed to Deno, so using Node's real
 * crypto here is a stronger cross-check than round-tripping against
 * `_shared/widget-token.ts`'s own Deno-portable primitives. */
function mintWidgetTokenForTests(
  payload: {
    tenant_id: string;
    widget_public_key: string;
    origin: string;
    iat?: number;
    exp?: number;
  },
  secret: string,
): string {
  const iat = payload.iat ?? Math.floor(Date.now() / 1000);
  const exp = payload.exp ?? iat + 15 * 60;
  const full = { ...payload, iat, exp };
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payloadB64).digest("hex");
  return `${payloadB64}.${signature}`;
}

function makeSql(fixtures: Record<string, unknown[]> = {}): SqlClient {
  return ((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
}

function fakeAnthropicFetch(replyText: string): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        content: [{ type: "text", text: replyText }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;
}

const WEB_CHAT_CONVERSATION_ROW = {
  id: "conv-1",
  tenant_id: "t1",
  channel: "web_chat",
  phone_e164: null,
  customer_id: null,
  widget_session_token_hash: "hash",
  call_log_id: null,
  status: "open",
  structured_state: {},
  recent_turns: [],
  disclosure_sent: false,
  verification_phone_e164: null,
  verification_code_hash: null,
  verification_code_expires_at: null,
  verification_attempts: 0,
  message_count: 0,
  ai_message_count: 0,
};

const TENANT_ROW = {
  business_name: "Acme Dental",
  vertical: "dental",
  timezone: "America/New_York",
  a2p_status: "verified",
  assistant_name: null,
  transfer_number: null,
  dynamic_variable_overrides: {},
  disclosure_line: "disclosure",
};

function baseFixtures(overrides: Record<string, unknown[]> = {}) {
  return {
    "insert into public.text_conversations": [WEB_CHAT_CONVERSATION_ROW],
    "from public.tenants t": [TENANT_ROW],
    ...overrides,
  };
}

async function widgetToken(tenantId = "t1"): Promise<string> {
  return mintWidgetTokenForTests(
    { tenant_id: tenantId, widget_public_key: "wpk_abc", origin: "https://acme.example" },
    WIDGET_SECRET,
  );
}

describe("handleTextChat", () => {
  it("verifies the widget_token, resolves tenant_id from it, and creates a new conversation on the first turn", async () => {
    const sql = makeSql(baseFixtures());
    const deps: TextAgentDeps & { widgetTokenSecret: string } = {
      sql,
      logger: silentLogger,
      anthropicFetch: fakeAnthropicFetch("Hi! How can I help?"),
      anthropicApiKey: "key",
      model: "claude-sonnet-5",
      appBaseUrl: "https://heyloo.app",
      widgetTokenSecret: WIDGET_SECRET,
    };

    const result = await handleTextChat(deps, silentLogger, {
      widget_token: await widgetToken(),
      message: "hi",
    });

    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.sent).toBe(true);
      expect(result.body.conversation_token).toBeTruthy();
      expect(result.body.reply).toContain("texting with Acme Dental's AI assistant");
    }
  });

  it("rejects a request with an invalid widget_token, never touching the engine/DB", async () => {
    const sql = makeSql(baseFixtures());
    const deps: TextAgentDeps & { widgetTokenSecret: string } = {
      sql,
      logger: silentLogger,
      anthropicFetch: fakeAnthropicFetch("unused"),
      anthropicApiKey: "key",
      model: "claude-sonnet-5",
      appBaseUrl: "https://heyloo.app",
      widgetTokenSecret: WIDGET_SECRET,
    };

    const result = await handleTextChat(deps, silentLogger, {
      widget_token: "not-a-real-token",
      message: "hi",
    });

    expect(result).toEqual({ status: 401, body: { error: "invalid_widget_token" } });
  });

  it("distinguishes an expired widget_token from an otherwise-invalid one", async () => {
    const sql = makeSql(baseFixtures());
    const now = Math.floor(Date.now() / 1000);
    const expired = await mintWidgetTokenForTests(
      {
        tenant_id: "t1",
        widget_public_key: "wpk_abc",
        origin: "https://acme.example",
        iat: now - 1000,
        exp: now - 1,
      },
      WIDGET_SECRET,
    );
    const deps: TextAgentDeps & { widgetTokenSecret: string } = {
      sql,
      logger: silentLogger,
      anthropicFetch: fakeAnthropicFetch("unused"),
      anthropicApiKey: "key",
      model: "claude-sonnet-5",
      appBaseUrl: "https://heyloo.app",
      widgetTokenSecret: WIDGET_SECRET,
    };

    const result = await handleTextChat(deps, silentLogger, {
      widget_token: expired,
      message: "hi",
    });

    expect(result).toEqual({ status: 401, body: { error: "expired_widget_token" } });
  });

  it("returns a 500 with a generic error when the engine throws after a valid token", async () => {
    const sql = (() => {
      throw new Error("db exploded");
    }) as unknown as SqlClient;
    const deps: TextAgentDeps & { widgetTokenSecret: string } = {
      sql,
      logger: silentLogger,
      anthropicFetch: fakeAnthropicFetch("unused"),
      anthropicApiKey: "key",
      model: "claude-sonnet-5",
      appBaseUrl: "https://heyloo.app",
      widgetTokenSecret: WIDGET_SECRET,
    };

    const result = await handleTextChat(deps, silentLogger, {
      widget_token: await widgetToken(),
      message: "hi",
    });

    expect(result.status).toBe(500);
  });

  it("still enforces the rate limit when conversation_token is omitted on every call (rate-limit bypass regression)", async () => {
    // Simulates the real DB behavior the bug relied on: omitting
    // conversation_token makes `createWebChatConversation` insert a
    // brand-new row every single call, so this fixture hands back a
    // DISTINCT conversation id each time — exactly what let the old
    // conversation.id-keyed limiter bucket reset on every request.
    let insertCount = 0;
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.text_conversations")) {
        insertCount += 1;
        return Promise.resolve([{ ...WEB_CHAT_CONVERSATION_ROW, id: `conv-${insertCount}` }]);
      }
      if (text.includes("from public.tenants t")) {
        return Promise.resolve([TENANT_ROW]);
      }
      return Promise.resolve([]);
    }) as SqlClient;

    const deps: TextAgentDeps & { widgetTokenSecret: string } = {
      sql,
      logger: silentLogger,
      anthropicFetch: fakeAnthropicFetch("Sure, I can help with that."),
      anthropicApiKey: "key",
      model: "claude-sonnet-5",
      appBaseUrl: "https://heyloo.app",
      widgetTokenSecret: WIDGET_SECRET,
    };

    // Unique tenant id so this test doesn't collide with the module-scope
    // rate limiter's state from other tests/files sharing "t1".
    const token = await widgetToken("rate-limit-bypass-tenant");

    const results: Awaited<ReturnType<typeof handleTextChat>>[] = [];
    for (let i = 0; i < 9; i++) {
      results.push(
        await handleTextChat(deps, silentLogger, {
          widget_token: token,
          message: `message ${i}`,
          // deliberately never passing conversation_token
        }),
      );
    }

    expect(insertCount).toBe(9); // confirms every call really did mint a fresh conversation
    for (const result of results.slice(0, 8)) {
      expect(result.status).toBe(200);
      if (result.status === 200) expect(result.body.sent).toBe(true);
    }
    const ninth = results[8];
    expect(ninth?.status).toBe(200);
    if (ninth?.status === 200) {
      expect(ninth.body.sent).toBe(false);
      expect(ninth.body.reason).toBe("rate_limited");
    }
  });
});
