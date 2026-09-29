import { z } from "zod";

/**
 * QA-1 F-13: the write-side schema for `tenants.widget_enabled` +
 * `tenants.widget_settings`, shared by the Website widget page (inline
 * errors before a round trip) and `POST /api/tenant/settings/widget` (the
 * real boundary). The page used to write whatever the form held straight to
 * the table: a non-hex accent, every mode unticked (the widget then renders
 * nothing), case-different or wildcard origins that can never match the
 * request `Origin` header.
 *
 * Origins are matched EXACTLY and case-sensitively against the browser's
 * `Origin` header (`lib/widget/settings-schema.ts#isOriginAllowed`), and a
 * browser always sends the scheme and host lower-cased, so an origin is
 * stored normalized (`URL.origin`): lower-case, no path, no trailing slash,
 * default port dropped.
 */

export const WIDGET_ACCENT_DEFAULT = "#d96a3f";

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** A normalized https origin, or a human reason it can't be used. */
export function normalizeWidgetOrigin(
  raw: string,
): { ok: true; origin: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.includes("*")) {
    return {
      ok: false,
      message: "Wildcards aren't supported — add each domain (e.g. https://www.example.com).",
    };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: "Enter a full https:// origin, e.g. https://example.com." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, message: "Only https:// domains are allowed." };
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    return {
      ok: false,
      message: "Enter just the domain, e.g. https://example.com (no path, query or login).",
    };
  }
  return { ok: true, origin: url.origin };
}

const zOrigin = z.string().transform((value, ctx) => {
  const result = normalizeWidgetOrigin(value);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.message });
    return z.NEVER;
  }
  return result.origin;
});

const zAccent = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .refine((value) => HEX_COLOR.test(value), "Use a 6-digit hex colour such as #d96a3f.");

export const widgetSettingsWriteSchema = z.object({
  allowed_origins: z
    .array(zOrigin)
    .max(50, "That's a lot of domains — keep it to 50 or fewer.")
    .transform((origins) => [...new Set(origins)]),
  accent: zAccent,
  position: z.enum(["bottom-right", "bottom-left"]),
  greeting: z
    .string()
    .max(200, "Keep the greeting to 200 characters or fewer.")
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : null;
    }),
  modes: z
    .array(z.enum(["voice", "chat"]))
    .min(1, "Turn on at least one of Chat or Voice, or the widget won't show.")
    .transform((modes) => [...new Set(modes)]),
});

export type WidgetSettingsWrite = z.output<typeof widgetSettingsWriteSchema>;

/** `POST /api/tenant/settings/widget`: the on/off switch and/or the settings, at least one. */
export const widgetRequestSchema = z
  .object({
    widget_enabled: z.boolean().optional(),
    widget_settings: widgetSettingsWriteSchema.optional(),
  })
  .refine(
    (value) => value.widget_enabled !== undefined || value.widget_settings !== undefined,
    "Nothing to save.",
  );
