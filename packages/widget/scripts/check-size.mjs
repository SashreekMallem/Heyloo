#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Enforces the "<25KB gz" budget (BUILD_PLAN ownership brief) on the
// ALWAYS-LOADED main bundle only — `voice-runtime.js` is lazy-loaded on
// demand (see `tsup.config.ts`'s docstring) and deliberately excluded from
// this budget; it carries `retell-client-js-sdk`, which alone is far over
// 25KB gz.
import { gzipSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
// tsup names iife output "<entry>.global.js" (see tsup.config.ts's docstring).
const target = path.join(here, "..", "dist", "widget.global.js");
const BUDGET_BYTES = 25 * 1024;

if (!existsSync(target)) {
  console.error(`check-size: ${target} does not exist — run "pnpm build" first.`);
  process.exit(1);
}

const raw = readFileSync(target);
const gz = gzipSync(raw, { level: 9 });
const kb = (gz.byteLength / 1024).toFixed(2);
const budgetKb = (BUDGET_BYTES / 1024).toFixed(0);

if (gz.byteLength > BUDGET_BYTES) {
  console.error(`check-size: widget.js is ${kb}KB gzipped — over the ${budgetKb}KB budget.`);
  process.exit(1);
}

console.log(`check-size: widget.js is ${kb}KB gzipped (budget ${budgetKb}KB) — OK.`);
