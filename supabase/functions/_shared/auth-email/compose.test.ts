import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuthEmailHookPayload, ContentKey } from "./compose.ts";
import {
  AUTH_EMAIL_SUBJECTS,
  buildConfirmLink,
  composeAuthEmails,
  EMITTED_OTP_TYPES,
  isSafeNextPath,
  normalizeSiteUrl,
  renderContent,
  resolveNext,
  zAuthEmailHookPayload,
} from "./compose.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), "utf8");

const SITE = "https://heyloo-voice.vercel.app";
const HASH = "abc123HASH";
const NEW_EMAIL = "new.address@example.com";

function payload(
  type: string,
  overrides: {
    user?: Partial<AuthEmailHookPayload["user"]>;
    data?: Partial<AuthEmailHookPayload["email_data"]>;
  } = {},
): AuthEmailHookPayload {
  return zAuthEmailHookPayload.parse({
    user: { id: "u-1", email: "owner@example.com", ...overrides.user },
    email_data: {
      token: "",
      token_hash: HASH,
      token_new: "",
      token_hash_new: "",
      redirect_to: "",
      email_action_type: type,
      site_url: SITE,
      ...overrides.data,
    },
  });
}

function only(result: ReturnType<typeof composeAuthEmails>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  expect(result.emails).toHaveLength(1);
  return result.emails[0] as (typeof result.emails)[number];
}

/** Whitespace-insensitive HTML comparison: layout indentation is irrelevant, copy and links are not. */
const normalize = (html: string) =>
  html.replace(/\s+/g, " ").replace(/>\s+/g, ">").replace(/\s+</g, "<").trim();

describe("templates stay in step with supabase/templates/*.html", () => {
  const cases: Array<{
    file: string;
    key: ContentKey;
    type: (typeof EMITTED_OTP_TYPES)[number] | null;
  }> = [
    { file: "confirmation", key: "confirmation", type: "email" },
    { file: "recovery", key: "recovery", type: "recovery" },
    { file: "invite", key: "invite", type: "invite" },
    { file: "magic_link", key: "magic_link", type: "magiclink" },
    { file: "email_change", key: "email_change_new", type: "email_change" },
    { file: "reauthentication", key: "reauthentication", type: null },
  ];

  it.each(cases)("$file.html renders identically to the hook's HTML", ({ file, key, type }) => {
    const template = read(`supabase/templates/${file}.html`)
      .replaceAll("{{ .SiteURL }}", SITE)
      .replaceAll("{{ .TokenHash }}", HASH)
      .replaceAll("{{ .NewEmail }}", NEW_EMAIL)
      .replaceAll("{{ .Token }}", "123456");
    const link =
      type === null ? undefined : buildConfirmLink(SITE, HASH, type, resolveNext(type, "", SITE));
    const rendered = renderContent(key, {
      newEmail: NEW_EMAIL,
      code: "123456",
      ...(link ? { link } : {}),
    });
    expect(normalize(rendered.html)).toBe(normalize(template));
  });

  it("wires reauthentication.html into config.toml relative to the project root", () => {
    const toml = read("supabase/config.toml");
    // Supabase resolves content_path from the project root (see the other templates).
    expect(toml).toMatch(
      /\[auth\.email\.template\.reauthentication\][^[]*content_path = "\.\/supabase\/templates\/reauthentication\.html"/,
    );
    expect(read("supabase/templates/reauthentication.html")).toContain("{{ .Token }}");
  });

  it("uses the same subjects as supabase/config.toml", () => {
    const toml = read("supabase/config.toml");
    const pairs: Array<[string, ContentKey]> = [
      ["confirmation", "confirmation"],
      ["recovery", "recovery"],
      ["invite", "invite"],
      ["magic_link", "magic_link"],
      ["email_change", "email_change_new"],
      ["reauthentication", "reauthentication"],
    ];
    for (const [section, key] of pairs) {
      const block = new RegExp(
        `\\[auth\\.email\\.template\\.${section}\\]\\s*\\nsubject = "([^"]*)"`,
      ).exec(toml);
      expect(block?.[1], section).toBe(AUTH_EMAIL_SUBJECTS[key]);
    }
  });
});

describe("/auth/confirm accepts every type the hook emits", () => {
  it("VALID_TYPES in the route covers EMITTED_OTP_TYPES", () => {
    const source = read("apps/web/src/app/auth/confirm/route.ts");
    const match = /VALID_TYPES = new Set<EmailOtpType>\(\[([\s\S]*?)\]\)/.exec(source);
    expect(match).not.toBeNull();
    const accepted = [...(match?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    for (const type of EMITTED_OTP_TYPES) expect(accepted).toContain(type);
  });
});

describe("links for each email_action_type", () => {
  it("signup -> type=email, resumes signup", () => {
    const email = only(composeAuthEmails(payload("signup")));
    const link = `${SITE}/auth/confirm?token_hash=${HASH}&type=email&next=/signup/resume`;
    expect(email).toMatchObject({ slot: "primary", to: "owner@example.com" });
    expect(email.subject).toBe("Confirm your Heyloo account");
    expect(email.text).toContain(link);
    expect(email.html).toContain(link.replaceAll("&", "&amp;"));
  });

  it("recovery -> type=recovery, lands on the password page", () => {
    const email = only(composeAuthEmails(payload("recovery")));
    expect(email.text).toContain(
      `${SITE}/auth/confirm?token_hash=${HASH}&type=recovery&next=/reset-password/confirm`,
    );
    expect(email.subject).toBe("Reset your Heyloo password");
  });

  it("invite -> type=invite, lands on the dashboard", () => {
    const email = only(composeAuthEmails(payload("invite")));
    expect(email.text).toContain(
      `${SITE}/auth/confirm?token_hash=${HASH}&type=invite&next=/dashboard`,
    );
  });

  it("magiclink -> type=magiclink", () => {
    const email = only(composeAuthEmails(payload("magiclink")));
    expect(email.text).toContain(
      `${SITE}/auth/confirm?token_hash=${HASH}&type=magiclink&next=/dashboard`,
    );
  });

  it("email (OTP) -> the 6-digit code AND a type=email link", () => {
    const email = only(composeAuthEmails(payload("email", { data: { token: "482913" } })));
    expect(email.text).toContain("Your code: 482913");
    expect(email.html).toContain("482913");
    expect(email.text).toContain(`type=email&next=/signup/resume`);
  });

  it("reauthentication -> the code only, no link", () => {
    const email = only(
      composeAuthEmails(payload("reauthentication", { data: { token: "654321" } })),
    );
    expect(email.text).toContain("Your code: 654321");
    expect(email.html).toContain("654321");
    expect(email.html).not.toContain("/auth/confirm");
    expect(email.text).not.toContain("http");
    expect(email.subject).toBe("Your Heyloo verification code");
  });

  it("reauthentication without a code is refused", () => {
    expect(composeAuthEmails(payload("reauthentication"))).toMatchObject({ ok: false });
  });
});

describe("email_change", () => {
  it("Secure Email Change: two emails with the REVERSED hash mapping", () => {
    const result = composeAuthEmails(
      payload("email_change", {
        user: { email: "old@example.com", new_email: NEW_EMAIL },
        data: {
          token: "111111",
          token_hash: "HASH_FOR_NEW_ADDRESS",
          token_new: "222222",
          token_hash_new: "HASH_FOR_CURRENT_ADDRESS",
        },
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.emails).toHaveLength(2);
    const current = result.emails.find((e) => e.slot === "current");
    const next = result.emails.find((e) => e.slot === "new");
    expect(current?.to).toBe("old@example.com");
    expect(current?.text).toContain("token_hash=HASH_FOR_CURRENT_ADDRESS&type=email_change");
    expect(current?.text).not.toContain("HASH_FOR_NEW_ADDRESS");
    expect(current?.subject).toBe("Approve your Heyloo email change");
    expect(next?.to).toBe(NEW_EMAIL);
    expect(next?.text).toContain("token_hash=HASH_FOR_NEW_ADDRESS&type=email_change");
    expect(next?.text).not.toContain("HASH_FOR_CURRENT_ADDRESS");
    expect(next?.subject).toBe("Confirm your new Heyloo email address");
    expect(next?.html).toContain(NEW_EMAIL);
  });

  it("Secure Email Change off: one email to the new address, whichever pair is set", () => {
    for (const data of [
      { token_hash: "ONLY_HASH" },
      { token_hash: "", token_hash_new: "ONLY_HASH" },
    ]) {
      const email = only(
        composeAuthEmails(
          payload("email_change", {
            user: { email: "old@example.com", new_email: NEW_EMAIL },
            data,
          }),
        ),
      );
      expect(email).toMatchObject({ slot: "new", to: NEW_EMAIL });
      expect(email.text).toContain("token_hash=ONLY_HASH&type=email_change&next=/dashboard");
    }
  });

  it("needs a valid new address", () => {
    expect(composeAuthEmails(payload("email_change", { user: { new_email: "" } }))).toMatchObject({
      ok: false,
    });
  });
});

describe("next path", () => {
  it("honours the app's own redirect_to (/auth/confirm?next=...)", () => {
    const email = only(
      composeAuthEmails(
        payload("invite", {
          data: { redirect_to: `${SITE}/auth/confirm?next=%2Fdashboard%2Fteam` },
        }),
      ),
    );
    expect(email.text).toContain("&type=invite&next=/dashboard/team");
  });

  it("keeps a query string in next encoded", () => {
    expect(buildConfirmLink(SITE, HASH, "invite", "/dashboard?tab=team&x=1")).toBe(
      `${SITE}/auth/confirm?token_hash=${HASH}&type=invite&next=/dashboard%3Ftab%3Dteam%26x%3D1`,
    );
  });

  it.each([
    ["another origin", "https://evil.example/auth/confirm?next=/dashboard"],
    ["a protocol-relative next", `${SITE}/auth/confirm?next=//evil.example`],
    ["a backslash next", `${SITE}/auth/confirm?next=/\\evil.example`],
    ["an absolute next", `${SITE}/auth/confirm?next=https://evil.example`],
    ["a loop into /auth/", `${SITE}/auth/confirm?next=/auth/confirm`],
    ["a non-confirm path", `${SITE}/somewhere?next=/dashboard/x`],
    ["garbage", "not a url"],
  ])("ignores redirect_to with %s and uses the default", (_name, redirect) => {
    expect(resolveNext("invite", redirect, SITE)).toBe("/dashboard");
    expect(resolveNext("email", redirect, SITE)).toBe("/signup/resume");
  });

  it("isSafeNextPath", () => {
    expect(isSafeNextPath("/dashboard")).toBe(true);
    expect(isSafeNextPath("dashboard")).toBe(false);
    expect(isSafeNextPath("//x")).toBe(false);
    expect(isSafeNextPath("/a b")).toBe(false);
    expect(isSafeNextPath("/a\nb")).toBe(false);
    expect(isSafeNextPath("")).toBe(false);
    expect(isSafeNextPath(`/${"a".repeat(600)}`)).toBe(false);
  });
});

describe("inputs and failures", () => {
  it("normalizeSiteUrl accepts http(s) only and drops trailing slashes", () => {
    expect(normalizeSiteUrl("https://app.example.com/")).toBe("https://app.example.com");
    expect(normalizeSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeSiteUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeSiteUrl("https://user:pw@app.example.com")).toBeNull();
    expect(normalizeSiteUrl("")).toBeNull();
  });

  it("refuses a link email with no token hash or no usable site_url", () => {
    expect(composeAuthEmails(payload("signup", { data: { token_hash: "" } }))).toMatchObject({
      ok: false,
    });
    expect(composeAuthEmails(payload("signup", { data: { site_url: "" } }))).toMatchObject({
      ok: false,
    });
  });

  it("refuses an unknown action type and a user with no email", () => {
    expect(composeAuthEmails(payload("teleport"))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("unsupported email_action_type"),
    });
    expect(composeAuthEmails(payload("signup", { user: { email: "" } }))).toMatchObject({
      ok: false,
    });
  });

  it("tolerates nulls from GoTrue for unset token fields", () => {
    const parsed = zAuthEmailHookPayload.parse({
      user: { id: "u", email: "a@b.co", new_email: null },
      email_data: {
        token: null,
        token_hash: "h",
        token_new: null,
        token_hash_new: null,
        redirect_to: null,
        email_action_type: "recovery",
        site_url: SITE,
      },
    });
    expect(composeAuthEmails(parsed).ok).toBe(true);
  });

  it("sends a plain-text alternative with no markup", () => {
    const email = only(composeAuthEmails(payload("recovery")));
    expect(email.text).not.toMatch(/<[a-z]/i);
    expect(email.text).toContain("Choose a new password:");
    expect(email.text.startsWith("Heyloo\n\nReset your password")).toBe(true);
  });

  it("security notifications get a short notice with no link", () => {
    const email = only(composeAuthEmails(payload("password_changed_notification")));
    expect(email.subject).toBe("Your Heyloo password was changed");
    expect(email.html).not.toContain("/auth/confirm");
  });

  it("email_changed_notification goes to the OLD address, never the new one", () => {
    // user.email is already the NEW address when this fires (GoTrue sends the
    // notice to email_data.old_email so the rightful owner learns of the change).
    const result = composeAuthEmails(
      payload("email_changed_notification", {
        user: { email: "attacker@example.net" },
        data: { old_email: "owner@example.com" },
      }),
    );
    const email = only(result);
    expect(email.to).toBe("owner@example.com");
    expect(email.text).toContain("from owner@example.com to attacker@example.net");
    expect(email.html).not.toContain("/auth/confirm");
  });

  it("email_changed_notification without a usable old_email sends nothing", () => {
    for (const old_email of ["", "not-an-email"]) {
      const result = composeAuthEmails(
        payload("email_changed_notification", { data: { old_email } }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("escapes address text in the email_changed_notification body", () => {
    const email = only(
      composeAuthEmails(
        payload("email_changed_notification", {
          user: { email: "o'brien@example.net" },
          data: { old_email: "owner@example.com" },
        }),
      ),
    );
    expect(email.html).not.toContain("o'brien");
    expect(email.html).toContain("o&#39;brien@example.net");
  });
});
