/**
 * Applies the repo's Supabase Auth email templates (`supabase/templates/*.html`)
 * and their subjects to the LIVE project through the Management API
 * (SIGNUP-BILL-FIX A). The local `supabase/config.toml` `[auth.email.template.*]`
 * blocks only affect `supabase start`; the hosted project keeps its own copy,
 * and out of the box that copy links to `{{ .ConfirmationURL }}` instead of the
 * app's `/auth/confirm?token_hash=...&type=...&next=...` route.
 *
 * DRY-RUN BY DEFAULT: prints exactly what would be sent (field names, subjects,
 * sizes, the link in each template) and makes NO network call. Nothing changes
 * until `--apply` is passed.
 *
 *   node --experimental-strip-types scripts/apply-auth-templates.ts            # dry-run
 *   node --experimental-strip-types scripts/apply-auth-templates.ts --apply    # PATCH the live project
 *
 * `--apply` needs:
 *   SUPABASE_PROJECT_REF      the project ref (the `<ref>` in <ref>.supabase.co)
 *   SUPABASE_ACCESS_TOKEN     a Supabase personal access token / fine-grained
 *                             token allowed to write the project's auth config
 *                             (Management API scope `auth:write`)
 *
 * Endpoint and fields (Rule 1: verified against the CURRENT docs, fetched
 * 2026-09-29, supabase.com/docs/reference/api/v1-update-auth-service-config):
 *   PATCH https://api.supabase.com/v1/projects/{ref}/config/auth
 *   Authorization: Bearer <token>
 *   body: mailer_templates_{confirmation,invite,recovery,magic_link,email_change}_content
 *         mailer_subjects_{confirmation,invite,recovery,magic_link,email_change}
 * The `type=` value of each link is the documented `verifyOtp` type for that
 * email (supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow-for-ssr
 * and /docs/guides/auth/auth-email-templates): `email` for signup confirmation,
 * `invite`, `magiclink`, `recovery`, `email_change`.
 *
 * Erasable-TypeScript syntax only, dependency-free (same convention as the
 * other scripts/*.ts files).
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface AuthTemplateSpec {
  /** Management API / config.toml template key. */
  key: "confirmation" | "invite" | "recovery" | "magic_link" | "email_change";
  file: string;
  subject: string;
  /** `type=` the link must carry (the `verifyOtp` type `/auth/confirm` accepts). */
  otpType: string;
  /** `next=` the link must carry (where the customer lands after verification). */
  next: string;
}

export const AUTH_TEMPLATES: readonly AuthTemplateSpec[] = [
  {
    key: "confirmation",
    file: "confirmation.html",
    subject: "Confirm your Heyloo account",
    otpType: "email",
    next: "/signup/resume",
  },
  {
    key: "recovery",
    file: "recovery.html",
    subject: "Reset your Heyloo password",
    otpType: "recovery",
    next: "/reset-password/confirm",
  },
  {
    key: "invite",
    file: "invite.html",
    subject: "You're invited to Heyloo",
    otpType: "invite",
    next: "/dashboard",
  },
  {
    key: "magic_link",
    file: "magic_link.html",
    subject: "Your Heyloo sign-in link",
    otpType: "magiclink",
    next: "/dashboard",
  },
  {
    key: "email_change",
    file: "email_change.html",
    subject: "Confirm your new Heyloo email address",
    otpType: "email_change",
    next: "/dashboard",
  },
];

/** The link every template must contain, exactly (HTML-escaped `&` as in the files). */
export function expectedLink(spec: AuthTemplateSpec): string {
  return `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${spec.otpType}&amp;next=${spec.next}`;
}

/** Throws if a template would send a customer to the wrong place. */
export function validateTemplate(spec: AuthTemplateSpec, html: string): void {
  if (html.includes("{{ .ConfirmationURL }}")) {
    throw new Error(
      `${spec.file}: uses {{ .ConfirmationURL }}; it must link to the app's /auth/confirm route`,
    );
  }
  if (!html.includes(expectedLink(spec))) {
    throw new Error(`${spec.file}: missing the expected link ${expectedLink(spec)}`);
  }
}

/** Management API body: `mailer_templates_<key>_content` + `mailer_subjects_<key>`. */
export function buildAuthTemplatePatch(templatesDir: string): Record<string, string> {
  const body: Record<string, string> = {};
  for (const spec of AUTH_TEMPLATES) {
    const html = readFileSync(join(templatesDir, spec.file), "utf8");
    validateTemplate(spec, html);
    body[`mailer_templates_${spec.key}_content`] = html;
    body[`mailer_subjects_${spec.key}`] = spec.subject;
  }
  return body;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** PATCHes the live auth config, then reads it back and checks every field stuck. */
export async function applyAuthTemplates(
  projectRef: string,
  accessToken: string,
  body: Record<string, string>,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`;
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };

  const patch = await fetchImpl(url, { method: "PATCH", headers, body: JSON.stringify(body) });
  if (!patch.ok) {
    return { ok: false, error: `PATCH ${patch.status}: ${(await patch.text()).slice(0, 500)}` };
  }

  const read = await fetchImpl(url, { method: "GET", headers });
  if (!read.ok) return { ok: false, error: `read-back GET ${read.status}` };
  const live = (await read.json()) as Record<string, unknown>;
  // Trimmed: the API may normalise leading/trailing whitespace of a template.
  const stale = Object.keys(body).filter(
    (field) => String(live[field] ?? "").trim() !== (body[field] ?? "").trim(),
  );
  if (stale.length > 0) {
    return { ok: false, error: `applied but not reflected on read-back: ${stale.join(", ")}` };
  }
  return { ok: true };
}

function main(): void {
  const apply = process.argv.includes("--apply");
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const body = buildAuthTemplatePatch(join(repoRoot, "supabase", "templates"));

  console.log(
    apply ? "APPLY: patching the live project's auth config" : "DRY-RUN (no request sent)",
  );
  console.log("PATCH https://api.supabase.com/v1/projects/<ref>/config/auth");
  for (const spec of AUTH_TEMPLATES) {
    const html = body[`mailer_templates_${spec.key}_content`] ?? "";
    console.log(
      `  ${spec.key.padEnd(13)} subject=${JSON.stringify(spec.subject)}  ${html.length} chars  -> ${expectedLink(spec)}`,
    );
  }

  if (!apply) {
    console.log("\nNothing was changed. Re-run with --apply (and SUPABASE_PROJECT_REF +");
    console.log("SUPABASE_ACCESS_TOKEN set) to update the live project.");
    return;
  }

  const ref = process.env["SUPABASE_PROJECT_REF"];
  const token = process.env["SUPABASE_ACCESS_TOKEN"];
  if (!ref || !token) {
    console.error("--apply needs SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN");
    process.exit(1);
  }
  applyAuthTemplates(ref, token, body).then(
    (result) => {
      if (!result.ok) {
        console.error(`FAILED: ${result.error}`);
        process.exit(1);
      }
      console.log("Applied and verified on read-back.");
    },
    (err) => {
      console.error(`FAILED: ${String(err)}`);
      process.exit(1);
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
