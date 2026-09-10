import "server-only";

import { isPreviewModeEnabled } from "./guard";
import { installPreviewFetchMock } from "./mock-fetch";

/**
 * Import this module FIRST (before any other import) in every server
 * component that needs the preview fetch mock installed — in practice
 * just `apps/web/src/app/[locale]/(preview)/layout.tsx`, since ES module
 * evaluation order guarantees this side effect runs before any nested
 * layout/page under that route group is evaluated for a given request.
 * Guarded by `isPreviewModeEnabled()` too, not just the route group's own
 * `assertPreviewEnabled()` call — belt and suspenders against ever
 * patching `fetch` in a real request.
 */
if (isPreviewModeEnabled()) {
  installPreviewFetchMock();
}
