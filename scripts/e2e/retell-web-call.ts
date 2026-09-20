/**
 * Drives a REAL Retell web call end-to-end, headlessly, with no human
 * dialing a phone (CALL-5, docs/BUILD_PLAN.md item 2): mints a web-call
 * `access_token` via the internal `api-admin-create-web-call` edge
 * function, opens a minimal local HTML page in Playwright Chromium that
 * loads the Retell web SDK from jsDelivr's `+esm` bundling endpoint
 * (`retell-client-js-sdk` needs its `eventemitter3`/`livekit-client` CJS
 * deps bundled to run from a bare `<script type="module">` — jsDelivr's
 * `/+esm` suffix does that automatically; see this file's own comments
 * below for what was checked before picking it), starts the call with
 * fake audio/video devices, keeps it open long enough for the agent to
 * speak, then ends it. Proves the REAL call-event path
 * (voice-events/webhook_events/call_logs) end-to-end, independent of
 * Retell's own batch-test simulator (which never fires voice-events at
 * all) or a human phone call (Twilio/outbound KYC isn't set up yet).
 *
 * Re-runnable: `SUPABASE_URL=... PROVISION_INTERNAL_SECRET=... \
 *   node --experimental-strip-types scripts/e2e/retell-web-call.ts`
 *
 * Required env:
 *   SUPABASE_URL                 e.g. https://qulcubtwqsqgqpfgvorn.supabase.co
 *   PROVISION_INTERNAL_SECRET    same secret api-admin-* functions require
 *                                 as the x-internal-secret header (never
 *                                 print this — read it from env only)
 * Optional env:
 *   TENANT_ID        defaults to the Riverside Auto Repair (TEST) tenant
 *                     (b2efae9d-8309-46d6-a950-31d683616cdc)
 *   CALL_SECONDS      how long to keep the call open (default 35)
 *   PLAYWRIGHT_BROWSERS_PATH  must point at the pre-installed browser
 *                     cache (e.g. /opt/pw-browsers) — this script never
 *                     runs `playwright install`.
 *
 * Requires Node >=22 (native `--experimental-strip-types`, no build step)
 * and the `playwright` package present somewhere in the pnpm store (it is
 * a transitive dependency of `@playwright/test`, used by `apps/web`'s own
 * e2e suite) — resolved dynamically below since no workspace package.json
 * lists `playwright` as a direct dependency.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const PROVISION_INTERNAL_SECRET = requireEnv("PROVISION_INTERNAL_SECRET");
const TENANT_ID = process.env["TENANT_ID"] ?? "b2efae9d-8309-46d6-a950-31d683616cdc";
const CALL_SECONDS = Number(process.env["CALL_SECONDS"] ?? "35");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

/**
 * `retell-client-js-sdk`'s own package.json only ships a UMD build
 * (`dist/index.umd.js`) whose browser-global fallback expects
 * `window.eventemitter3` and `window.livekitClient` to already exist (it
 * does `require(...)` in its CJS branch, which a bare `<script>` tag can't
 * satisfy) — checked live: fetching that file directly and inspecting it
 * confirms the unbundled UMD wrapper. jsDelivr's `/+esm` endpoint
 * (https://cdn.jsdelivr.net/npm/<pkg>/+esm) resolves and bundles a
 * package's dependency graph into one self-contained ES module server
 * side (Rollup + esbuild) — checked live: `retell-client-js-sdk@2.0.8/
 * +esm` pulls in `eventemitter3` and `livekit-client` automatically and
 * exports a working `RetellWebClient`, so a plain `<script type="module">
 * import` is all a page needs. Version pinned to match
 * `packages/widget/package.json`'s own `retell-client-js-sdk` dependency.
 */
const RETELL_SDK_ESM_URL = "https://cdn.jsdelivr.net/npm/retell-client-js-sdk@2.0.8/+esm";

function buildHtml(accessToken: string): string {
  // Kept intentionally minimal — this page exists only to host the SDK's
  // WebRTC session inside a real browser context; nothing here is served
  // to real users.
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>retell-web-call e2e</title></head>
<body>
<pre id="log"></pre>
<script type="module">
  import { RetellWebClient } from "${RETELL_SDK_ESM_URL}";

  const logEl = document.getElementById("log");
  function log(...args) {
    const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    console.log("[e2e]", line);
    logEl.textContent += line + "\\n";
  }

  window.__e2eEvents = [];
  const client = new RetellWebClient();
  for (const evt of ["call_started", "call_ended", "error", "update", "agent_start_talking", "agent_stop_talking"]) {
    client.on(evt, (data) => {
      window.__e2eEvents.push({ evt, data: data ?? null, t: Date.now() });
      log("event:", evt, data ?? "");
    });
  }

  client.startCall({ accessToken: "${accessToken}" })
    .then(() => log("startCall() resolved"))
    .catch((err) => log("startCall() rejected:", String(err)));

  window.__e2eStop = () => client.stopCall();
</script>
</body>
</html>`;
}

interface CreateWebCallResponse {
  access_token?: string;
  call_id?: string;
  agent_id?: string;
  error?: string;
}

/** Dynamically locates the `playwright` package inside the pnpm store —
 * no workspace `package.json` depends on it directly (only
 * `@playwright/test`, which does not re-export `chromium` for
 * programmatic use outside its own test runner). */
async function loadPlaywright(): Promise<typeof import("playwright")> {
  try {
    return await import("playwright");
  } catch {
    // Fall through to a direct pnpm-store resolution below.
  }
  const { execSync } = await import("node:child_process");
  const storeRoot = join(
    execSync("pnpm root -w", { cwd: new URL("../..", import.meta.url).pathname })
      .toString()
      .trim(),
    ".pnpm",
  );
  const { readdirSync } = await import("node:fs");
  const match = readdirSync(storeRoot).find((entry) => entry.startsWith("playwright@"));
  if (!match) {
    throw new Error(
      "Could not resolve the `playwright` package anywhere in the pnpm store. " +
        "It ships as a transitive dependency of apps/web's @playwright/test — run " +
        "`pnpm install` at the repo root first.",
    );
  }
  const modUrl = pathToFileURL(
    join(storeRoot, match, "node_modules", "playwright", "index.mjs"),
  ).href;
  return import(modUrl);
}

async function main(): Promise<void> {
  console.log(`[e2e] requesting a web-call access_token for tenant ${TENANT_ID}...`);
  const tokenRes = await fetch(`${SUPABASE_URL}/functions/v1/api-admin-create-web-call`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": PROVISION_INTERNAL_SECRET },
    body: JSON.stringify({ tenant_id: TENANT_ID }),
  });
  const tokenBody = (await tokenRes.json()) as CreateWebCallResponse;
  if (!tokenRes.ok || !tokenBody.access_token || !tokenBody.call_id) {
    console.error("[e2e] api-admin-create-web-call failed:", tokenRes.status, tokenBody);
    process.exit(1);
  }
  console.log(`[e2e] got call_id=${tokenBody.call_id} agent_id=${tokenBody.agent_id}`);

  const { chromium } = await loadPlaywright();

  const tmpDir = await mkdtemp(join(tmpdir(), "retell-web-call-"));
  const htmlPath = join(tmpDir, "call.html");
  await writeFile(htmlPath, buildHtml(tokenBody.access_token), "utf8");

  console.log("[e2e] launching headless Chromium with fake audio/video devices...");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  try {
    const context = await browser.newContext({ permissions: ["microphone"] });
    const page = await context.newPage();
    page.on("console", (msg) => console.log(`[browser] ${msg.text()}`));
    page.on("pageerror", (err) => console.error("[browser:error]", err));

    await page.goto(pathToFileURL(htmlPath).href);

    console.log(`[e2e] call started — keeping it open for ${CALL_SECONDS}s...`);
    await page.waitForTimeout(CALL_SECONDS * 1000);

    console.log("[e2e] stopping the call...");
    await page.evaluate(() => (window as unknown as { __e2eStop: () => void }).__e2eStop());
    await page.waitForTimeout(2000);

    const events = await page.evaluate(
      () => (window as unknown as { __e2eEvents: unknown[] }).__e2eEvents,
    );
    console.log("[e2e] browser-side SDK events observed:", JSON.stringify(events, null, 2));
  } finally {
    await browser.close();
    await rm(tmpDir, { recursive: true, force: true });
  }

  console.log(
    `[e2e] done. real call_id = ${tokenBody.call_id} — check webhook_events/call_logs for it ` +
      "(call_ended/call_analyzed land a few seconds after this process exits).",
  );
}

main().catch((err) => {
  console.error("[e2e] fatal:", err);
  process.exit(1);
});
