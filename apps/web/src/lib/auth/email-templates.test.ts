import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * The email templates, their wiring in supabase/config.toml, and the script that
 * pushes them to the live project (SIGNUP-BILL-FIX A). The contract under test:
 * every link goes to the app's /auth/confirm route with a `type` that route
 * accepts, and lands where the flow needs (signup -> resume, recovery ->
 * /reset-password/confirm, invite -> /dashboard).
 */

const repoRoot = resolve(import.meta.dirname, "../../../../..");
const templatesDir = resolve(repoRoot, "supabase/templates");
const scriptPath = resolve(repoRoot, "scripts/apply-auth-templates.ts");

// Same set as `VALID_TYPES` in src/app/auth/confirm/route.ts.
const ROUTE_ACCEPTS = new Set([
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

interface ScriptModule {
  AUTH_TEMPLATES: { key: string; file: string; subject: string; otpType: string; next: string }[];
  buildAuthTemplatePatch: (dir: string) => Record<string, string>;
  validateTemplate: (spec: never, html: string) => void;
  applyAuthTemplates: (
    ref: string,
    token: string,
    body: Record<string, string>,
    fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

// A variable specifier keeps this outside the app's TypeScript project (the
// script lives in /scripts, deliberately dependency-free).
const mod = (await import(/* @vite-ignore */ scriptPath)) as ScriptModule;

describe("supabase/templates/*.html", () => {
  it("has the five templates, each linking to /auth/confirm with a type the route accepts", () => {
    expect(mod.AUTH_TEMPLATES.map((t) => t.key).sort()).toEqual(
      ["confirmation", "email_change", "invite", "magic_link", "recovery"].sort(),
    );
    for (const spec of mod.AUTH_TEMPLATES) {
      expect(ROUTE_ACCEPTS.has(spec.otpType)).toBe(true);
      const html = readFileSync(resolve(templatesDir, spec.file), "utf8");
      expect(html).toContain("{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}");
      expect(html).toContain(`type=${spec.otpType}`);
      expect(html).toContain(`next=${spec.next}`);
      expect(html).not.toContain(".ConfirmationURL");
    }
  });

  it("routes each flow to the right place", () => {
    const byKey = Object.fromEntries(mod.AUTH_TEMPLATES.map((t) => [t.key, t]));
    expect(byKey["confirmation"]).toMatchObject({ otpType: "email", next: "/signup/resume" });
    expect(byKey["recovery"]).toMatchObject({
      otpType: "recovery",
      next: "/reset-password/confirm",
    });
    expect(byKey["invite"]).toMatchObject({ otpType: "invite", next: "/dashboard" });
  });

  it("is wired into supabase/config.toml for local parity (subject + content_path per template)", () => {
    const toml = readFileSync(resolve(repoRoot, "supabase/config.toml"), "utf8");
    for (const spec of mod.AUTH_TEMPLATES) {
      expect(toml).toContain(`[auth.email.template.${spec.key}]`);
      expect(toml).toContain(`content_path = "./templates/${spec.file}"`);
      expect(toml).toContain(`subject = "${spec.subject}"`);
    }
  });
});

describe("scripts/apply-auth-templates.ts", () => {
  it("builds the Management API body: mailer_templates_*_content + mailer_subjects_*", () => {
    const body = mod.buildAuthTemplatePatch(templatesDir);
    expect(Object.keys(body).sort()).toEqual(
      [
        "mailer_subjects_confirmation",
        "mailer_subjects_email_change",
        "mailer_subjects_invite",
        "mailer_subjects_magic_link",
        "mailer_subjects_recovery",
        "mailer_templates_confirmation_content",
        "mailer_templates_email_change_content",
        "mailer_templates_invite_content",
        "mailer_templates_magic_link_content",
        "mailer_templates_recovery_content",
      ].sort(),
    );
    expect(body["mailer_templates_confirmation_content"]).toContain("type=email");
  });

  it("refuses a template that still uses {{ .ConfirmationURL }} or has the wrong link", () => {
    const spec = mod.AUTH_TEMPLATES[0] as never;
    expect(() => mod.validateTemplate(spec, '<a href="{{ .ConfirmationURL }}">x</a>')).toThrow(
      /ConfirmationURL/,
    );
    expect(() => mod.validateTemplate(spec, "<p>no link</p>")).toThrow(/missing the expected link/);
  });

  it("PATCHes the auth config with a bearer token and verifies on read-back", async () => {
    const body = {
      mailer_subjects_confirmation: "Confirm",
      mailer_templates_confirmation_content: "<p/>",
    };
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return init?.method === "PATCH" ? new Response("{}", { status: 200 }) : Response.json(body);
    });
    const result = await mod.applyAuthTemplates("abcd1234", "sbp_token", body, fetchImpl);
    expect(result).toEqual({ ok: true });
    expect(calls[0]?.url).toBe("https://api.supabase.com/v1/projects/abcd1234/config/auth");
    expect(calls[0]?.init?.method).toBe("PATCH");
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer sbp_token");
  });

  it("reports an API failure and a read-back mismatch instead of claiming success", async () => {
    const body = { mailer_subjects_confirmation: "Confirm" };
    const rejected = await mod.applyAuthTemplates(
      "ref",
      "t",
      body,
      async () => new Response("nope", { status: 403 }),
    );
    expect(rejected).toMatchObject({ ok: false });
    const stale = await mod.applyAuthTemplates("ref", "t", body, async (_u, init) =>
      init?.method === "PATCH"
        ? new Response("{}")
        : Response.json({ mailer_subjects_confirmation: "Old" }),
    );
    expect(stale).toMatchObject({ ok: false });
    expect((stale as { error: string }).error).toContain("mailer_subjects_confirmation");
  });
});
