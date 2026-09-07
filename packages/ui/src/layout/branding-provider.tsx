export interface TenantBranding {
  logoUrl?: string;
  primary?: string;
  accent?: string;
}

/** Very rough perceived-luminance contrast check against a white/near-white surface — good enough to reject an illegible brand color without pulling in a color-math dependency; final authority is a real contrast checker in the (not-yet-specced) branding editor at save time (FRONTEND_SPEC.md §9.3). */
function isReadableOnLightSurface(hex: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return false;
  const value = match[1];
  if (!value) return false;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // Reject colors too close to white (unreadable against the app's light
  // background) or so dark they read as pure black-on-black in dark mode.
  return luminance > 0.08 && luminance < 0.92;
}

/**
 * Server component: emits a `<style>` block mapping `tenants.branding` onto
 * the `--tenant-primary`/`--tenant-accent` custom properties the
 * `.heyloo-tenant-branded` class (packages/ui/src/theme/globals.css)
 * consumes — scoped to the (tenant) root layout only (FRONTEND_SPEC.md
 * §9.3). A color that fails the contrast check falls back to the default
 * palette rather than shipping illegible UI.
 */
export function BrandingProvider({
  branding,
  scopeSelector = ".heyloo-tenant-branded",
}: {
  branding: TenantBranding;
  scopeSelector?: string;
}) {
  const primary =
    branding.primary && isReadableOnLightSurface(branding.primary) ? branding.primary : undefined;
  const accent =
    branding.accent && isReadableOnLightSurface(branding.accent) ? branding.accent : undefined;

  if (!primary && !accent) return null;

  const declarations = [
    primary ? `--tenant-primary: ${primary};` : "",
    accent ? `--tenant-accent: ${accent};` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: static, server-computed CSS custom properties only — no user HTML is ever interpolated here.
    <style dangerouslySetInnerHTML={{ __html: `${scopeSelector} { ${declarations} }` }} />
  );
}
