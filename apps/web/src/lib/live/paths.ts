/** The live screen's route (LIVE-1). */
export const LIVE_SCREEN_HREF = "/dashboard/live";

/**
 * True on the live screen, including its UI-preview mirror
 * (`/preview/dashboard/live`), where the tenant shell renders no sidebar,
 * top bar or tab bar. `pathname` comes from `@/i18n/navigation`'s
 * `usePathname`, which has no locale prefix.
 */
export function isLiveScreenPath(pathname: string | null | undefined): boolean {
  return !!pathname && /^(\/preview)?\/dashboard\/live(\/|$)/.test(pathname);
}
