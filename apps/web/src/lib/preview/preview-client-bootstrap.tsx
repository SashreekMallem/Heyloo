"use client";

import { isPreviewModeEnabled } from "./guard";
import { installPreviewFetchMock } from "./mock-fetch";

// Module-scope, not inside the component: this runs the moment the
// client bundle for this module evaluates (React's SSR pass for this
// module, then again on hydration) — before any client-component page
// under `/preview/**` gets a chance to call `supabaseBrowserClient` or a
// data hook. `installPreviewFetchMock` is idempotent, so running it twice
// (SSR pass + hydration) is harmless. `NODE_ENV`/`UI_PREVIEW_MODE` are
// both inlined at build time, so this branch is dead code (and the mock
// module is tree-shaken away) in a production bundle.
if (isPreviewModeEnabled()) {
  installPreviewFetchMock();
}

/** Rendered once by `(preview)/layout.tsx` — exists only for the module-scope side effect above; intentionally renders nothing. */
export function PreviewClientBootstrap() {
  return null;
}
