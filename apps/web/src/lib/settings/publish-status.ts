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
 *   `POST /api/tenant/settings/language`) is newer than `published_at`.
 * - `platform_update`: the published agent does not reference a live
 *   setting token (`{{language}}`, or `{{transfer_number}}` once a transfer
 *   number is set), so a setting the owner changes would not reach calls.
 *   `compiled_config` is treated as opaque text — only Heyloo's own
 *   `{{variable}}` token names are looked for, never its structure.
 */

export type PublishReason = "never_published" | "language_changed" | "platform_update";

export interface PublishStatusInput {
  publishedAt: string | null;
  compiledConfig: unknown;
  transferNumber: string | null;
  languageConfig: unknown;
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
};

/** The language-change stamp written by the Language tab (absent on older rows). */
export function languageChangedAt(languageConfig: unknown): string | null {
  if (typeof languageConfig !== "object" || languageConfig === null) return null;
  const value = (languageConfig as Record<string, unknown>)["changed_at"];
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
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

  const changedAt = languageChangedAt(input.languageConfig);
  if (changedAt && Date.parse(changedAt) > Date.parse(input.publishedAt)) {
    reasons.push("language_changed");
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

  return { publishedAt: input.publishedAt, pending: reasons.length > 0, reasons };
}

/** React Query key for `GET /api/tenant/agent/publish-status` — under the `agent_configs` prefix every agent-settings save already invalidates. */
export function publishStatusQueryKey(tenantId: string | null) {
  return ["tenant", tenantId, "agent_configs", "publish_status"] as const;
}
