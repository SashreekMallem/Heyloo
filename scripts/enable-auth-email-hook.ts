/**
 * Turns on Supabase Auth's Send Email Hook for the LIVE project so every auth
 * email (signup confirmation, password reset, invite, magic link, email
 * change, reauthentication code) goes through the `auth-send-email` edge
 * function and therefore through the messaging EmailProvider (Microsoft Graph
 * / SMTP / Resend) instead of Supabase's built-in mailer (EMAIL-MSGRAPH,
 * docs/SETUP_EMAIL_MICROSOFT.md).
 *
 * DRY-RUN BY DEFAULT: prints exactly what would be sent (endpoints, field
 * names, the secret's shape but never its value) and makes NO network call.
 * Nothing changes until `--apply` is passed.
 *
 *   node --experimental-strip-types scripts/enable-auth-email-hook.ts             # dry-run
 *   node --experimental-strip-types scripts/enable-auth-email-hook.ts --apply     # enable the hook
 *   node --experimental-strip-types scripts/enable-auth-email-hook.ts --disable --apply   # roll back
 *
 * `--apply` needs SUPABASE_ACCESS_TOKEN (a Supabase access token allowed to
 * write auth config and secrets: Management API scopes `auth:write`,
 * `secrets:write`, plus `auth:read`, `secrets:read` and function read for the
 * checks). SUPABASE_PROJECT_REF defaults to the live project.
 *
 * What `--apply` does, in this order (order matters: a hook that is on while
 * the function is missing or has no secret would break every signup email):
 *   1. checks the `auth-send-email` function is deployed and that a complete
 *      email provider is configured as function secrets (names only);
 *   2. generates a fresh signing secret locally (`v1,whsec_<base64>`), sets it
 *      as the function secret `SEND_EMAIL_HOOK_SECRET`;
 *   3. PATCHes the Auth config: `hook_send_email_enabled`,
 *      `hook_send_email_uri`, `hook_send_email_secrets` (the same value);
 *   4. reads both back and confirms.
 * The secret is generated in memory and sent only to those two endpoints. It
 * is NEVER printed or written to disk; error text is scrubbed of it too.
 * Re-running while the hook is already on refuses unless `--rotate` is given.
 *
 * Rule 1 (docs/VERIFY.md EMAIL-MSGRAPH). Field names verified against the
 * Management API OpenAPI document (https://api.supabase.com/api/v1-json,
 * fetched 2026-09-29) and supabase.com/docs/reference/api/v1-update-auth-service-config:
 *   PATCH /v1/projects/{ref}/config/auth   (Bearer; scope auth:write)
 *     hook_send_email_enabled  boolean | null
 *     hook_send_email_uri      string  | null
 *     hook_send_email_secrets  string  | null
 *   GET   /v1/projects/{ref}/config/auth   (scope auth:read)
 *   POST  /v1/projects/{ref}/secrets       (scope secrets:write)
 *     body: [{ "name": "...", "value": "..." }]  (name must not start with SUPABASE_)
 *   GET   /v1/projects/{ref}/secrets       (scope secrets:read; names, no plaintext values)
 *   GET   /v1/projects/{ref}/functions/{slug}
 * The secret format `v1,whsec_<base64>` and the requirement that the function
 * verify it with the Standard Webhooks scheme are from
 * supabase.com/docs/guides/auth/auth-hooks/send-email-hook.
 *
 * Erasable-TypeScript syntax only, dependency-free (same convention as the
 * other scripts/*.ts files).
 */

import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const LIVE_PROJECT_REF = "qulcubtwqsqgqpfgvorn";
export const FUNCTION_SLUG = "auth-send-email";
export const HOOK_SECRET_NAME = "SEND_EMAIL_HOOK_SECRET";
const API = "https://api.supabase.com";

export function hookUri(ref: string): string {
  return `https://${ref}.supabase.co/functions/v1/${FUNCTION_SLUG}`;
}

/** `v1,whsec_<base64 of 32 random bytes>`: the format Supabase itself generates. */
export function generateHookSecret(random: (n: number) => Uint8Array = randomBytes): string {
  return `v1,whsec_${Buffer.from(random(32)).toString("base64")}`;
}

/** The Auth config PATCH body. */
export function buildHookPatch(
  ref: string,
  secret: string,
): {
  hook_send_email_enabled: true;
  hook_send_email_uri: string;
  hook_send_email_secrets: string;
} {
  return {
    hook_send_email_enabled: true,
    hook_send_email_uri: hookUri(ref),
    hook_send_email_secrets: secret,
  };
}

/** Provider secret sets (names only) the function can send with. */
const PROVIDER_SETS: Record<string, readonly string[]> = {
  microsoft_graph: ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "EMAIL_FROM_ADDRESS"],
  smtp: ["SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "EMAIL_FROM_ADDRESS"],
  resend: ["RESEND_API_KEY", "EMAIL_FROM_ADDRESS"],
};

/**
 * Which providers have every secret they need (`EMAIL_FROM_ADDRESS` may also
 * be the legacy `RESEND_FROM_ADDRESS`). Only names are visible through the
 * Management API, so this cannot tell which one `EMAIL_PROVIDER` selects; the
 * caller warns about that.
 */
export function completeProviders(secretNames: ReadonlySet<string>): string[] {
  const has = (name: string) =>
    secretNames.has(name) ||
    (name === "EMAIL_FROM_ADDRESS" && secretNames.has("RESEND_FROM_ADDRESS"));
  return Object.entries(PROVIDER_SETS)
    .filter(([, names]) => names.every(has))
    .map(([id]) => id);
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HookOptions {
  ref: string;
  accessToken: string;
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
  /** Generates the secret; tests inject a fixed one. */
  makeSecret?: () => string;
  /** Replace the secret even if the hook is already on. */
  rotate?: boolean;
}

export type HookOutcome = { ok: true; changed: boolean } | { ok: false; error: string };

function scrub(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

async function api(
  fetchImpl: FetchLike,
  token: string,
  method: string,
  path: string,
  body: unknown,
  secret: string,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      error: `${method} ${path} -> ${res.status}: ${scrub(text, secret).slice(0, 300)}`,
    };
  }
  try {
    return { ok: true, json: text ? JSON.parse(text) : null };
  } catch {
    return { ok: true, json: null };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Enables the hook. See the header for the order and the checks. */
export async function enableAuthEmailHook(options: HookOptions): Promise<HookOutcome> {
  const { ref, accessToken } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => {});
  const secret = (options.makeSecret ?? generateHookSecret)();
  const call = (method: string, path: string, body?: unknown) =>
    api(fetchImpl, accessToken, method, path, body, secret);

  // 1. Preconditions: the function exists and an email provider is complete.
  const fn = await call("GET", `/v1/projects/${ref}/functions/${FUNCTION_SLUG}`);
  if (!fn.ok) {
    return {
      ok: false,
      error: `${FUNCTION_SLUG} is not deployed (${fn.error}). Deploy it first: supabase functions deploy ${FUNCTION_SLUG} --no-verify-jwt`,
    };
  }
  const secrets = await call("GET", `/v1/projects/${ref}/secrets`);
  if (!secrets.ok) return { ok: false, error: secrets.error };
  const names = new Set(
    (Array.isArray(secrets.json) ? secrets.json : [])
      .map((entry) => asRecord(entry)["name"])
      .filter((name): name is string => typeof name === "string"),
  );
  const providers = completeProviders(names);
  if (providers.length === 0) {
    return {
      ok: false,
      error:
        "no complete email provider in the function secrets. Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and EMAIL_FROM_ADDRESS (plus EMAIL_PROVIDER=microsoft_graph), or the SMTP_* / RESEND_* equivalents, before enabling the hook, or every signup email would fail.",
    };
  }
  log(
    `  provider secrets present for: ${providers.join(", ")} (EMAIL_PROVIDER must select one of them)`,
  );

  // Already on? Refuse to rotate silently.
  const current = await call("GET", `/v1/projects/${ref}/config/auth`);
  if (!current.ok) return { ok: false, error: current.error };
  const live = asRecord(current.json);
  if (
    live["hook_send_email_enabled"] === true &&
    live["hook_send_email_uri"] === hookUri(ref) &&
    names.has(HOOK_SECRET_NAME) &&
    !options.rotate
  ) {
    log(
      "  the hook is already enabled for this function; nothing to do (use --rotate to replace the secret)",
    );
    return { ok: true, changed: false };
  }

  // 2. Function secret first, then 3. the Auth config.
  const setSecret = await call("POST", `/v1/projects/${ref}/secrets`, [
    { name: HOOK_SECRET_NAME, value: secret },
  ]);
  if (!setSecret.ok) return { ok: false, error: setSecret.error };
  log(`  set function secret ${HOOK_SECRET_NAME}`);

  const patch = await call("PATCH", `/v1/projects/${ref}/config/auth`, buildHookPatch(ref, secret));
  if (!patch.ok) return { ok: false, error: patch.error };
  log(
    "  patched auth config: hook_send_email_enabled, hook_send_email_uri, hook_send_email_secrets",
  );

  // 4. Read back.
  const after = await call("GET", `/v1/projects/${ref}/config/auth`);
  if (!after.ok) return { ok: false, error: `read-back failed: ${after.error}` };
  const seen = asRecord(after.json);
  if (seen["hook_send_email_enabled"] !== true || seen["hook_send_email_uri"] !== hookUri(ref)) {
    return {
      ok: false,
      error: "applied but the auth config does not show the hook enabled on read-back",
    };
  }
  const secretsAfter = await call("GET", `/v1/projects/${ref}/secrets`);
  if (
    !secretsAfter.ok ||
    !(Array.isArray(secretsAfter.json) ? secretsAfter.json : []).some(
      (entry) => asRecord(entry)["name"] === HOOK_SECRET_NAME,
    )
  ) {
    return {
      ok: false,
      error: `${HOOK_SECRET_NAME} is not listed as a function secret on read-back`,
    };
  }
  return { ok: true, changed: true };
}

/** Rolls back to Supabase's built-in mailer. The function and its secret stay. */
export async function disableAuthEmailHook(options: HookOptions): Promise<HookOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const patch = await api(
    fetchImpl,
    options.accessToken,
    "PATCH",
    `/v1/projects/${options.ref}/config/auth`,
    { hook_send_email_enabled: false },
    "",
  );
  if (!patch.ok) return { ok: false, error: patch.error };
  const after = await api(
    fetchImpl,
    options.accessToken,
    "GET",
    `/v1/projects/${options.ref}/config/auth`,
    undefined,
    "",
  );
  if (!after.ok) return { ok: false, error: after.error };
  return asRecord(after.json)["hook_send_email_enabled"] === false
    ? { ok: true, changed: true }
    : { ok: false, error: "the hook still shows enabled on read-back" };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const disable = args.has("--disable");
  const ref = process.env["SUPABASE_PROJECT_REF"] || LIVE_PROJECT_REF;

  console.log(apply ? "APPLY" : "DRY-RUN (no request is sent)");
  console.log(`project: ${ref}`);
  if (disable) {
    console.log("would PATCH /v1/projects/<ref>/config/auth  { hook_send_email_enabled: false }");
  } else {
    console.log(`hook uri: ${hookUri(ref)}`);
    console.log("would, in order:");
    console.log(`  1. GET  /v1/projects/<ref>/functions/${FUNCTION_SLUG}   (must be deployed)`);
    console.log(
      "  2. GET  /v1/projects/<ref>/secrets   (a complete provider set must exist; names only)",
    );
    console.log("  3. generate a signing secret locally: v1,whsec_<base64 of 32 random bytes>");
    console.log(
      `  4. POST /v1/projects/<ref>/secrets   [{ name: "${HOOK_SECRET_NAME}", value: <secret> }]`,
    );
    console.log(
      "  5. PATCH /v1/projects/<ref>/config/auth   { hook_send_email_enabled: true, hook_send_email_uri, hook_send_email_secrets: <secret> }",
    );
    console.log("  6. read both back and confirm");
    console.log("The secret is never printed.");
  }

  if (!apply) {
    console.log("\nNothing was changed. To do it: deploy the function, set the provider secrets,");
    console.log(
      "then re-run with --apply and SUPABASE_ACCESS_TOKEN set (docs/SETUP_EMAIL_MICROSOFT.md).",
    );
    return;
  }

  const accessToken = process.env["SUPABASE_ACCESS_TOKEN"];
  if (!accessToken) {
    console.error("--apply needs SUPABASE_ACCESS_TOKEN");
    process.exit(1);
  }
  const log = (line: string) => console.log(line);
  const outcome = disable
    ? await disableAuthEmailHook({ ref, accessToken, log })
    : await enableAuthEmailHook({ ref, accessToken, log, rotate: args.has("--rotate") });
  if (!outcome.ok) {
    console.error(`FAILED: ${outcome.error}`);
    process.exit(1);
  }
  if (disable) {
    console.log("Hook disabled: Supabase's built-in mailer is sending again.");
    return;
  }
  console.log(outcome.changed ? "Hook enabled and verified on read-back." : "No change.");
  console.log(
    "\nNext: trigger a password reset for a real address you own and confirm the mail arrives",
  );
  console.log("from the Microsoft 365 mailbox. If it does not, roll back with:");
  console.log(
    "  node --experimental-strip-types scripts/enable-auth-email-hook.ts --disable --apply",
  );
  console.log(
    "and read the function logs (Supabase dashboard > Edge Functions > auth-send-email > Logs).",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`FAILED: ${String(err)}`);
    process.exit(1);
  });
}
