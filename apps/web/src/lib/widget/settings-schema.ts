import { z } from "zod";

/**
 * Runtime Zod validator for `tenants.widget_settings` (BACKEND_SPEC.md
 * §13.2's jsonb shape) — CLAUDE.md Rule 1: DB stores it typed-but-loose
 * jsonb, the runtime validates it at the boundary, same posture as
 * `agent_configs.dynamic_variable_overrides`. Kept local to `apps/web`
 * (not `packages/canonical-types`) since only this cluster's routes read
 * this column today.
 */
export const zWidgetPosition = z.enum(["bottom-right", "bottom-left"]);
export const zWidgetMode = z.enum(["voice", "chat"]);

export const zWidgetSettings = z.object({
  allowed_origins: z.array(z.string()).default([]),
  accent: z.string().nullable().default(null),
  position: zWidgetPosition.default("bottom-right"),
  greeting: z.string().nullable().default(null),
  modes: z.array(zWidgetMode).default(["chat"]),
});
export type WidgetSettings = z.infer<typeof zWidgetSettings>;

const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  allowed_origins: [],
  accent: null,
  position: "bottom-right",
  greeting: null,
  modes: ["chat"],
};

/** Never throws — an unparseable/legacy jsonb value degrades to the safe
 * "widget effectively disabled" default (empty `allowed_origins`, so no
 * `Origin` can ever pass the allowlist check) rather than a 500. */
export function parseWidgetSettings(value: unknown): WidgetSettings {
  const result = zWidgetSettings.safeParse(value);
  return result.success ? result.data : DEFAULT_WIDGET_SETTINGS;
}

/** Case-sensitive, scheme-and-host-and-port exact match against the
 * request's `Origin` header — no wildcard/subdomain matching (BACKEND_SPEC
 * §13.2: "checked server-side against the Origin header"; a tenant that
 * wants both `https://example.com` and `https://www.example.com` lists
 * both explicitly). */
export function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.indexOf(origin) !== -1;
}
