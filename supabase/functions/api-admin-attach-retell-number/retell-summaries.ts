/**
 * RETELLCFG (docs/BUILD_NOTES.md): pure, dependency-free helpers shared by
 * `inspectRetellConfig` (handler.ts) and `inventoryRetellAccount`
 * (inventory.ts). Nothing here calls Retell or the database.
 *
 * Field shapes RETELL-VERIFIED against docs.retellai.com on 2026-09-29
 * (docs/VERIFY.md RETELLCFG):
 * - conversation flow: `start_speaker` ("user" | "agent"), `start_node_id`,
 *   `nodes[]` where a conversation node carries `instruction: {type:
 *   "prompt" | "static_text", text}` ("static_text: The agent will speak
 *   ... directly"); there is NO `begin_message` on a flow.
 * - retell-llm: `begin_message` ("First utterance said by the agent in the
 *   call. If not set, LLM will dynamically generate a message."),
 *   `start_speaker`, `begin_after_user_silence_ms`.
 * - agent: `language` is a single locale OR an array of locales; `voice_id`
 *   string; `webhook_url` nullable ("If set ... will ignore the account
 *   level webhook for this agent").
 */

/** The 14 legacy edge functions of the product this repo replaced
 * (docs/LAUNCH_STATUS.md owner step 2, docs/DEPLOY_LIVE_NOW.md). All were
 * deleted from the project; any Retell URL still pointing at one 404s. */
export const LEGACY_FUNCTION_NAMES: readonly string[] = [
  "retell-assistant",
  "retell-events",
  "retell-tools",
  "retell-manage",
  "retell-numbers",
  "pos-sync",
  "pos-oauth",
  "pos-oauth-callback",
  "pos-push",
  "pos-push-square",
  "pos-push-clover",
  "square-webhook",
  "clover-webhook",
  "parse-menu",
];

const MAX_TEXT_CHARS = 2000;

/** Truncates long text and redacts every URL inside it (RETELLCFG-REVIEW:
 * an opening or prompt can quote a URL that carries a token). */
function clip(text: string): string {
  const safe = redactUrlsInText(text);
  return safe.length > MAX_TEXT_CHARS ? `${safe.slice(0, MAX_TEXT_CHARS)}...[truncated]` : safe;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// ---------------------------------------------------------------------------
// Opening (first utterance) and language
// ---------------------------------------------------------------------------

export interface StartNodeSummary {
  id: string;
  type: string | null;
  /** `"static_text"` means Retell speaks `instruction_text` verbatim;
   * `"prompt"` means the model generates the line from it. */
  instruction_type: string | null;
  instruction_text: string | null;
}

/** The node a conversation flow starts on, or null when the flow has no
 * resolvable `start_node_id`. */
export function describeStartNode(flow: unknown): StartNodeSummary | null {
  const f = asRecord(flow);
  if (!f) return null;
  const startId = asString(f["start_node_id"]);
  if (!startId || !Array.isArray(f["nodes"])) return null;
  const node = (f["nodes"] as unknown[]).map(asRecord).find((n) => n?.["id"] === startId);
  if (!node) return { id: startId, type: null, instruction_type: null, instruction_text: null };
  const instruction = asRecord(node["instruction"]);
  const text = asString(instruction?.["text"]);
  return {
    id: startId,
    type: asString(node["type"]),
    instruction_type: asString(instruction?.["type"]),
    instruction_text: text === null ? null : clip(text),
  };
}

/** `begin_message` of a retell-llm: a string, or null when unset (Retell
 * then lets the model generate the opening). An empty string is kept as-is
 * (it is meaningful: the agent waits for the caller). */
export function describeBeginMessage(llm: unknown): string | null {
  const text = asString(asRecord(llm)?.["begin_message"]);
  return text === null ? null : clip(text);
}

export function describeStartSpeaker(resource: unknown): string | null {
  return asString(asRecord(resource)?.["start_speaker"]);
}

/** Agent `language`: a locale string, an array of locale strings, or null. */
export function describeLanguage(agent: unknown): string | string[] | null {
  const raw = asRecord(agent)?.["language"];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.every((l) => typeof l === "string")) return raw as string[];
  return null;
}

// ---------------------------------------------------------------------------
// URL discovery, redaction, classification
// ---------------------------------------------------------------------------

/** Keys whose VALUES are never read or returned: request headers / query
 * params (Retell custom tools and MCPs carry auth tokens here) and SIP trunk
 * credentials. Only the fact that the key exists is visible to callers. */
const SECRET_BEARING_KEY =
  /^(headers|query_params|auth_username|auth_password|sip_trunk_auth_username|sip_trunk_auth_password|password|secret|api_key|token)$/i;

const URL_IN_TEXT = /https?:\/\/[^\s"'`<>\\]+/gi;

/** A path segment that looks like an embedded credential: long, URL-safe,
 * mixing letters and digits (Zapier / n8n / Make catch-hook ids, Slack and
 * Discord webhook tokens, `bot<id>:<token>`). */
const SECRET_LIKE_SEGMENT = /^(?=.*[0-9])(?=.*[A-Za-z])[A-Za-z0-9._~:+=-]{16,}$/;

/** Hosts whose URLs never carry a credential in the path (Supabase function
 * and REST URLs authenticate by header / `apikey` query), so their path
 * stays verbatim: the function name is what the classification reads. */
function isSupabaseHost(host: string): boolean {
  return host.endsWith(".supabase.co") || host.endsWith(".supabase.in");
}

/** Strip credentials, query values, fragments and credential-like path
 * segments (on non-Supabase hosts) from a URL string without re-encoding
 * the rest of its path (so `{{dynamic_variable}}` placeholders stay
 * readable): `https://u:p@h/x?token=abc#f` -> `https://REDACTED@h/x?token=REDACTED`,
 * `https://hooks.zapier.com/hooks/catch/123/abc9def0ghi1jkl2/` ->
 * `https://hooks.zapier.com/hooks/catch/123/REDACTED/`. */
export function redactUrl(raw: string): string {
  const hashIndex = raw.indexOf("#");
  const withoutFragment = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutFragment.indexOf("?");
  const base = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
  const query = queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : null;
  const withoutCredentials = base.replace(/^(https?:\/\/)[^@/]*@/i, "$1REDACTED@");
  const authority = /^(https?:\/\/(?:[^@/]*@)?)([^/:]+)(:\d+)?/i.exec(withoutCredentials);
  const host = authority?.[2]?.toLowerCase() ?? "";
  const safeBase =
    authority && !isSupabaseHost(host)
      ? authority[0] +
        withoutCredentials
          .slice(authority[0].length)
          .split("/")
          .map((segment) => (SECRET_LIKE_SEGMENT.test(segment) ? "REDACTED" : segment))
          .join("/")
      : withoutCredentials;
  if (query === null || query === "") return safeBase;
  const safeQuery = query
    .split("&")
    .filter((pair) => pair.length > 0)
    .map((pair) => `${pair.split("=")[0]}=REDACTED`)
    .join("&");
  return `${safeBase}?${safeQuery}`;
}

/** `redactUrl` for a URL-valued field that may be null. */
export function redactUrlOrNull(raw: string | null | undefined): string | null {
  return typeof raw === "string" ? redactUrl(raw) : null;
}

/** Every URL inside free text replaced by its redacted form. */
export function redactUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT, (match) => {
    const trailing = /[.,;:!?)\]]+$/.exec(match)?.[0] ?? "";
    return redactUrl(match.slice(0, match.length - trailing.length)) + trailing;
  });
}

export interface FoundUrl {
  /** JSON path inside the resource, e.g. `tools[2].url`. */
  path: string;
  /** Redacted URL (see `redactUrl`). */
  url: string;
}

/** Every http(s) URL anywhere in `value` (whole-string values and URLs
 * embedded in longer text such as prompts or code-node source), skipping
 * the subtrees of secret-bearing keys entirely. */
export function collectUrls(value: unknown, path = ""): FoundUrl[] {
  const found: FoundUrl[] = [];
  const walk = (node: unknown, at: string): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(URL_IN_TEXT)) {
        const cleaned = match[0].replace(/[.,;:!?)\]]+$/, "");
        found.push({ path: at, url: redactUrl(cleaned) });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => {
        walk(item, `${at}[${i}]`);
      });
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    for (const [key, child] of Object.entries(record)) {
      if (SECRET_BEARING_KEY.test(key)) continue;
      walk(child, at ? `${at}.${key}` : key);
    }
  };
  walk(value, path);
  return found;
}

export interface ExpectedRetellUrls {
  /** Agent `webhook_url` target (the deployed `/voice-events`). */
  voice_events: string;
  /** Custom-tool `url` target (the deployed `/voice-tools`). */
  voice_tools: string;
  /** Phone-number `inbound_webhook_url` target (the deployed `/voice-inbound`). */
  voice_inbound: string;
}

export type UrlClassification =
  /** Exactly the endpoint this platform configures for that field. */
  | "expected"
  /** One of our current Retell-facing functions, but not the one this field
   * should point at (e.g. a tool URL pointing at /voice-events). */
  | "current_function_wrong_field"
  /** One of the 14 deleted legacy functions (always a 404). */
  | "legacy_function"
  /** A function path on THIS project that is not a Retell-facing function
   * of this codebase (likely deleted/renamed; check it exists). */
  | "unexpected_project_function"
  /** A different Supabase project (e.g. the legacy product's project). */
  | "other_supabase_project"
  /** Any other host. Only a finding when the field is one this platform
   * owns (webhook_url, tool url, inbound_webhook_url). */
  | "external";

interface ParsedUrl {
  host: string;
  path: string;
}

function parseUrl(url: string): ParsedUrl | null {
  const m = /^https?:\/\/(?:[^@/]*@)?([^/:?#]+)(?::\d+)?(\/[^?#]*)?/i.exec(url);
  if (!m?.[1]) return null;
  return { host: m[1].toLowerCase(), path: (m[2] ?? "/").replace(/\/+$/, "") || "/" };
}

function sameEndpoint(a: string, b: string): boolean {
  const pa = parseUrl(a);
  const pb = parseUrl(b);
  return pa !== null && pb !== null && pa.host === pb.host && pa.path === pb.path;
}

/** `https://<ref>.supabase.co/functions/v1/<name>/...` -> `<name>`. */
export function functionNameOf(url: string, projectHost: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed || parsed.host !== projectHost.toLowerCase()) return null;
  const m = /^\/functions\/v1\/([^/]+)/.exec(parsed.path);
  return m?.[1] ?? null;
}

export function hostOf(url: string): string | null {
  return parseUrl(url)?.host ?? null;
}

export function classifyUrl(
  url: string,
  opts: { projectHost: string; expected: ExpectedRetellUrls; expectedForField: string | null },
): { classification: UrlClassification; function_name: string | null } {
  const fn = functionNameOf(url, opts.projectHost);
  if (fn !== null) {
    if (LEGACY_FUNCTION_NAMES.includes(fn))
      return { classification: "legacy_function", function_name: fn };
    const current = [
      opts.expected.voice_events,
      opts.expected.voice_tools,
      opts.expected.voice_inbound,
    ];
    const isCurrent = current.some((c) => sameEndpoint(url, c));
    if (opts.expectedForField !== null) {
      if (sameEndpoint(url, opts.expectedForField))
        return { classification: "expected", function_name: fn };
      return {
        classification: isCurrent ? "current_function_wrong_field" : "unexpected_project_function",
        function_name: fn,
      };
    }
    return {
      classification: isCurrent ? "expected" : "unexpected_project_function",
      function_name: fn,
    };
  }
  const host = hostOf(url);
  if (host?.endsWith(".supabase.co") && host !== opts.projectHost.toLowerCase()) {
    return { classification: "other_supabase_project", function_name: null };
  }
  return { classification: "external", function_name: null };
}

export type RetellResourceType = "agent" | "phone_number" | "retell_llm" | "conversation_flow";

/** Which platform endpoint a given (resource, JSON path) must point at, or
 * null when the field is not one this platform configures (prompt text,
 * MCP servers, knowledge bases...). */
export function expectedUrlForField(
  resourceType: RetellResourceType,
  path: string,
  expected: ExpectedRetellUrls,
): string | null {
  if (resourceType === "agent" && path === "webhook_url") return expected.voice_events;
  if (resourceType === "phone_number" && path === "inbound_webhook_url")
    return expected.voice_inbound;
  if (
    (resourceType === "retell_llm" || resourceType === "conversation_flow") &&
    /(^|\.)(general_tools|tools)\[\d+\]\.url$/.test(path)
  ) {
    return expected.voice_tools;
  }
  return null;
}
