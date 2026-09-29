/**
 * SETTINGS-1 (docs/BUILD_NOTES.md): what "Changes pending" actually means.
 *
 * PUBLISH-1's badge compared `agent_configs.updated_at > published_at`, which
 * (a) lit up for edits that are already live on the next call (assistant
 * name, transfer number, vertical details, FAQ — every `agent_configs`
 * write bumps `updated_at`), and (b) missed the one owner setting that
 * really needs a republish: the call language, which lives on `tenants`
 * and is baked into the published agent (its opening line and the Retell
 * agent-level language, `compile-and-publish.ts`). It also could not see an
 * agent compiled before the live-settings tokens existed (audit: 6/10 live
 * agents lacked `{{language}}`, 4/10 lacked `{{transfer_number}}`).
 *
 * Reasons, each from data the tenant can already read under RLS:
 * - `never_published`: no `published_at`.
 * - `language_changed`: `tenants.language_config.changed_at` (stamped by
 *   `POST /api/tenant/settings/language`) is newer than `published_at` AND
 *   the language now differs from the one the published agent was built
 *   with (`published_primary`, when known).
 * - `platform_update`: the published agent does not reference a live
 *   setting token (`{{language}}`, or `{{transfer_number}}` once a transfer
 *   number is set), so a setting the owner changes would not reach calls.
 *   `compiled_config` is treated as opaque text — only Heyloo's own
 *   `{{variable}}` token names are looked for, never its structure.
 * - `compiler_outdated` (SETTINGS-2): `agent_configs.compiled_with_version`
 *   (stamped by `compile-and-publish.ts` with the compiler's
 *   `AGENT_COMPILER_VERSION`) is missing or older than
 *   `CURRENT_AGENT_COMPILER_VERSION` — the published agent was built before a
 *   compiler change that only reaches calls on republish (e.g. the block that
 *   makes the AI read the FAQ and special instructions). Catches what the
 *   token search cannot see. `undefined` (the column does not exist yet on this
 *   database) is "unknown" and never flags; `null` (column present, never
 *   stamped) flags.
 */

/**
 * SETTINGS-2: the compiler version this portal expects a current agent to have
 * been compiled with. MUST equal `AGENT_COMPILER_VERSION` in
 * `supabase/functions/_shared/compiler/template-compiler.ts` (a test reads that
 * file and fails on drift); bump both whenever a compile of the same template
 * would produce different agent output.
 */
export const CURRENT_AGENT_COMPILER_VERSION = 2;

export type PublishReason =
  | "never_published"
  | "language_changed"
  | "platform_update"
  | "compiler_outdated";

export interface PublishStatusInput {
  publishedAt: string | null;
  compiledConfig: unknown;
  transferNumber: string | null;
  languageConfig: unknown;
  /** `agent_configs.compiled_with_version`; `undefined` = column not available on this database (skip the check). */
  compiledWithVersion?: number | null;
}

export interface PublishStatus {
  publishedAt: string | null;
  pending: boolean;
  reasons: PublishReason[];
}

export const PUBLISH_REASON_TEXT: Record<PublishReason, string> = {
  never_published: "Your agent hasn't been published yet.",
  language_changed: "You changed the call language — publish to switch your agent over.",
  platform_update:
    "Your agent was published before recent improvements — publish once so your live settings (like the transfer number and language) reach every call.",
  compiler_outdated:
    "Your agent was published before recent improvements — publish once so it picks up the newest settings support (FAQ answers, special instructions, call routing, custom questions and more).",
};

/** The language-change stamp written by the Language tab (absent on older rows). */
export function languageChangedAt(languageConfig: unknown): string | null {
  if (typeof languageConfig !== "object" || languageConfig === null) return null;
  const value = (languageConfig as Record<string, unknown>)["changed_at"];
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function stringKey(languageConfig: unknown, key: string): string | null {
  if (typeof languageConfig !== "object" || languageConfig === null) return null;
  const value = (languageConfig as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * SETTINGS-1 review: the language the PUBLISHED agent was built with, as
 * recorded by the Language tab when the first unpublished change was made
 * (`published_primary`). Lets "switched to Spanish, then back to English"
 * stop showing "You changed the call language" — the live agent already
 * speaks English. Absent on rows stamped before this key existed: unknown,
 * so a newer `changed_at` still counts as a change (conservative).
 */
export function publishedLanguage(languageConfig: unknown): string | null {
  return stringKey(languageConfig, "published_primary");
}

/** True when `changed_at` is newer than the last publish (or nothing was ever published). */
export function languageChangePendingSince(
  languageConfig: unknown,
  publishedAt: string | null,
): boolean {
  const changedAt = languageChangedAt(languageConfig);
  if (!changedAt) return false;
  if (!publishedAt) return true;
  return Date.parse(changedAt) > Date.parse(publishedAt);
}

function serialize(compiled: unknown): string {
  if (compiled == null) return "";
  if (typeof compiled === "string") return compiled;
  try {
    return JSON.stringify(compiled);
  } catch {
    return "";
  }
}

export function computePublishStatus(input: PublishStatusInput): PublishStatus {
  const reasons: PublishReason[] = [];
  if (!input.publishedAt) {
    reasons.push("never_published");
    return { publishedAt: null, pending: true, reasons };
  }

  if (languageChangePendingSince(input.languageConfig, input.publishedAt)) {
    const live = publishedLanguage(input.languageConfig);
    const current = stringKey(input.languageConfig, "primary");
    if (!(live !== null && live === current)) reasons.push("language_changed");
  }

  const compiled = serialize(input.compiledConfig);
  if (compiled.length > 0) {
    const missingLanguage = !compiled.includes("{{language}}");
    const missingTransfer =
      input.transferNumber && input.transferNumber.trim().length > 0
        ? !compiled.includes("{{transfer_number}}")
        : false;
    if (missingLanguage || missingTransfer) reasons.push("platform_update");
  }

  // SETTINGS-2: a stale compiler version. Skipped when the token check above already
  // asked for a republish (one "published before recent improvements" message is enough),
  // and when the database has no stamp column at all (`undefined`).
  if (input.compiledWithVersion !== undefined && !reasons.includes("platform_update")) {
    const version = input.compiledWithVersion;
    if (version === null || version < CURRENT_AGENT_COMPILER_VERSION) {
      reasons.push("compiler_outdated");
    }
  }

  return { publishedAt: input.publishedAt, pending: reasons.length > 0, reasons };
}

/** INTAKE-Q-1: the first compiler version whose agents can ask the owner's custom intake questions. */
export const CUSTOM_QUESTIONS_MIN_COMPILER_VERSION = 2;

/**
 * INTAKE-Q-1: whether the PUBLISHED agent already knows how to ask custom
 * questions (its prompt was compiled by a version that has the block). Edits
 * to the question list are live on the next call only when this is true;
 * otherwise the owner must publish once. A database with no stamp column
 * (`undefined`) is "unknown" and counts as yes, matching `computePublishStatus`.
 */
export function agentAsksCustomQuestions(input: {
  publishedAt: string | null;
  compiledWithVersion?: number | null;
}): boolean {
  if (!input.publishedAt) return false;
  if (input.compiledWithVersion === undefined) return true;
  return (
    input.compiledWithVersion !== null &&
    input.compiledWithVersion >= CUSTOM_QUESTIONS_MIN_COMPILER_VERSION
  );
}

/** React Query key for `GET /api/tenant/agent/publish-status` — under the `agent_configs` prefix every agent-settings save already invalidates. */
export function publishStatusQueryKey(tenantId: string | null) {
  return ["tenant", tenantId, "agent_configs", "publish_status"] as const;
}
