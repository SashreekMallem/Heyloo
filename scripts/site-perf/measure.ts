#!/usr/bin/env node
/**
 * Site perf budget runner (WEBSITE_CREATIVE_BRIEF.md's "Performance is
 * part of premium" STANDARD; thresholds in `./budgets.ts`).
 *
 * Builds `apps/web` for production, starts it, measures each route in
 * `ROUTE_BUDGETS` with a real Chromium (via Playwright, CPU-throttled to
 * approximate "a mid-range laptop" rather than this runner's own
 * cloud-grade CPU), and exits non-zero — printing exactly which
 * route/metric failed and by how much — if any budget is missed.
 *
 * Deliberately dependency-free at the package.json level (same
 * convention as `scripts/ci/*.ts` — plain `node:*` builtins): rather
 * than adding `@playwright/test` as a new dependency somewhere (out of
 * this task's package.json ownership, and `scripts/` isn't a pnpm
 * workspace member — see `pnpm-workspace.yaml`), this resolves and
 * dynamically imports the copy `apps/web` ALREADY depends on
 * (`@playwright/test@1.63.0`, the same one the `e2e` CI job installs a
 * browser for) via `node:module`'s `createRequire` anchored at
 * `apps/web/package.json` — the exact mechanism Node itself uses to
 * resolve a bare specifier from a given directory, so this works
 * identically in CI and locally regardless of pnpm's hoisting layout.
 *
 * Run: `node --experimental-strip-types scripts/site-perf/measure.ts`
 * (matches `scripts/ci/*.ts`'s own invocation convention). Needs the
 * Playwright Chromium browser installed first:
 * `pnpm --filter web exec playwright install chromium`.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CPU_THROTTLE_RATE, ROUTE_BUDGETS, type RouteBudget } from "./budgets.ts";
import { collectWebVitals } from "./web-vitals-probe.ts";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const WEB_DIR = path.join(REPO_ROOT, "apps/web");
// Fixed (not env-overridable): this isn't a turbo task, so a new env var
// here would need declaring in turbo.json's `env`/`passThroughEnv` for
// correct cache-key behavior (turbo.json isn't this task's ownership) —
// a free, unlikely-to-collide port is simpler than opening that up.
const PORT = 4319;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * Same "unreachable placeholder" values `.github/workflows/ci.yml`'s
 * `e2e` job already sets for `next build`/`next start` (see
 * `apps/web/src/lib/env.ts`) — a production build/boot needs *some*
 * value for these, never a real project. Only applied when the caller
 * hasn't already set them (so a real local `.env.local` still wins).
 */
const BUILD_ENV_DEFAULTS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
  SIGNUP_DRAFT_SECRET: "ci-placeholder-secret-not-for-prod",
  APP_BASE_URL: ORIGIN,
};

/**
 * `@playwright/test`'s published `index.js` is CJS with a single
 * `module.exports = {...}` (no named-export markers cjs-module-lexer can
 * synthesize) — confirmed by inspecting what a dynamic `import()` of its
 * resolved path actually yields (CLAUDE.md Rule 1): every named export
 * this module "has" under a normal static `import { chromium } from
 * "@playwright/test"` (which Next/TS's bundler-aware resolution handles
 * for us elsewhere) collapses here to a single `default` key holding the
 * real exports object — `import("...").then(({chromium}) => ...)` silently
 * destructures `undefined` instead of throwing, so this went unnoticed
 * until `chromium.launch()` failed at runtime. Unwrap `.default` here,
 * once, so every call site can keep destructuring `{ chromium }` like the
 * static-import shape it's typed against.
 */
async function resolvePlaywright() {
  const webRequire = createRequire(path.join(WEB_DIR, "package.json"));
  const entry = webRequire.resolve("@playwright/test");
  const mod = (await import(entry)) as { default: typeof import("@playwright/test") };
  return mod.default;
}

function run(
  command: string,
  args: string[],
  extraEnv: Record<string, string> = {},
  cwd: string = WEB_DIR,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: { ...BUILD_ENV_DEFAULTS, ...process.env, ...extraEnv },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

/** Starts `next start -p PORT` detached (so it outlives this function) and resolves once it's actually answering. */
async function startServer() {
  // NOT `pnpm run start -- -p PORT`: confirmed against this repo's pnpm
  // (CLAUDE.md Rule 1 — verified by running it directly, not assumed) that
  // the `--` separator is forwarded to the underlying `next start` script
  // literally instead of being stripped, so Next's CLI parses the arg
  // right after it (`-p`) as the positional `[directory]` argument and
  // fails with "Invalid project directory provided, no such directory:
  // .../apps/web/-p" — the server then never starts and this function's
  // own poll loop below times out after 60s with a misleading "did not
  // start" error that hides the real cause. `pnpm exec next start -p
  // PORT` calls the `next` binary directly with no script-passthrough
  // involved, so there's no `--` to mishandle.
  const child = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
    cwd: WEB_DIR,
    stdio: "inherit",
    env: { ...BUILD_ENV_DEFAULTS, ...process.env },
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(ORIGIN);
      if (res.ok || res.status < 500) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`apps/web did not start on ${ORIGIN} within 60s`);
}

interface MeasuredRoute {
  budget: RouteBudget;
  lcpMs: number;
  cls: number;
  initialJsBytesGz: number;
}

async function measureRoute(
  browserType: Awaited<ReturnType<typeof resolvePlaywright>>["chromium"],
  budget: RouteBudget,
): Promise<MeasuredRoute> {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const cdp = await page.context().newCDPSession(page);
    // "a mid-range laptop", not this CI runner's own cloud-grade CPU.
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE_RATE });

    // Real wire-transfer byte accounting via CDP's `Network.loadingFinished`
    // `encodedDataLength` — NOT a `response.headers()["content-length"]`
    // sum (what this used to do): confirmed by curling a real `next
    // start` chunk with `Accept-Encoding: gzip` (CLAUDE.md Rule 1) that
    // Next's production server answers every same-origin JS chunk as
    // `Transfer-Encoding: chunked` + `Content-Encoding: gzip` with NO
    // `Content-Length` header at all whenever the request declares gzip
    // support — which every real browser, Chromium included, always
    // does — so the old `Content-Length`-sum silently totalled ~0 bytes
    // for every real script response (a Home-route run reported "1.5KB"
    // total, when the actual initial JS is far larger) and the budget
    // check would PASS regardless of actual payload size, defeating its
    // entire purpose without ever erroring. `encodedDataLength` is what
    // Chrome DevTools' own Network panel and Lighthouse report as
    // "transferred size" — actual bytes over the wire, encoding included
    // — and is populated unconditionally, with no dependence on which
    // response headers a given server happens to send.
    let jsBytes = 0;
    const scriptRequestIds = new Set<string>();
    cdp.on("Network.responseReceived", (event) => {
      const { requestId, response, type } = event as {
        requestId: string;
        response: { url: string };
        type: string;
      };
      // same-origin only — no third-party script counts against this budget
      if (type === "Script" && response.url.startsWith(ORIGIN)) {
        scriptRequestIds.add(requestId);
      }
    });
    cdp.on("Network.loadingFinished", (event) => {
      const { requestId, encodedDataLength } = event as {
        requestId: string;
        encodedDataLength: number;
      };
      if (scriptRequestIds.has(requestId)) jsBytes += encodedDataLength;
    });
    await cdp.send("Network.enable");

    await page.addInitScript(collectWebVitals);
    await page.goto(`${ORIGIN}${budget.path}`, { waitUntil: "load" });
    // LCP can still finalize briefly after `load` (fonts/late paints);
    // CLS likewise settles once initial hydration/layout has quieted
    // down. A short, fixed settle window (no user interaction, so no
    // new "initial JS" fetches start during it) rather than a fragile
    // network-idle heuristic.
    await page.waitForTimeout(1500);

    const vitals = await page.evaluate(
      () => (window as unknown as { __heylooPerf: { lcp: number; cls: number } }).__heylooPerf,
    );

    return { budget, lcpMs: vitals.lcp, cls: vitals.cls, initialJsBytesGz: jsBytes };
  } finally {
    await browser.close();
  }
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function report(results: MeasuredRoute[]): boolean {
  let allPassed = true;
  for (const r of results) {
    const checks: Array<{ name: string; pass: boolean; actual: string; budget: string }> = [
      {
        name: "LCP",
        pass: r.lcpMs <= r.budget.lcpMs,
        actual: `${Math.round(r.lcpMs)}ms`,
        budget: `${r.budget.lcpMs}ms`,
      },
      {
        name: "CLS",
        pass: r.cls <= r.budget.cls,
        actual: r.cls.toFixed(3),
        budget: r.budget.cls.toFixed(3),
      },
      {
        name: "Initial JS (gz)",
        pass: r.initialJsBytesGz <= r.budget.initialJsBytesGz,
        actual: formatBytes(r.initialJsBytesGz),
        budget: formatBytes(r.budget.initialJsBytesGz),
      },
    ];
    console.log(`\n${r.budget.label} (${r.budget.path})`);
    for (const c of checks) {
      if (!c.pass) allPassed = false;
      console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}: ${c.actual} (budget ${c.budget})`);
    }
  }
  return allPassed;
}

async function main() {
  console.log(`Building apps/web (production)...`);
  // Build apps/web's workspace dependencies first (their `dist/` is what
  // `next build` resolves via package.json `main`); a fresh clone / CI
  // runner has none of them yet. `^...` = dependencies only, not web itself.
  await run("pnpm", ["exec", "turbo", "run", "build", "--filter=@heyloo/web^..."], {}, REPO_ROOT);
  await run("pnpm", ["run", "build"]);

  console.log(`Starting apps/web on ${ORIGIN}...`);
  const server = await startServer();

  try {
    const { chromium } = await resolvePlaywright();
    const results: MeasuredRoute[] = [];
    for (const budget of ROUTE_BUDGETS) {
      results.push(await measureRoute(chromium, budget));
    }

    const passed = report(results);
    if (!passed) {
      console.error("\nSite perf budget FAILED — see FAIL rows above.");
      process.exitCode = 1;
    } else {
      console.log("\nAll routes within budget.");
    }
  } finally {
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
