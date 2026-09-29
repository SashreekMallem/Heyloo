import type { Metadata } from "next";

// Generated mirror (UI Preview Mode, docs/DESIGN_SYSTEM.md §UI Preview
// Mode) — re-exports the REAL page unmodified; no forked logic here.
// SETTINGS-1: the real `/dashboard/agent` is now the agent Overview
// (Settings checklist) rather than a redirect, so this mirror re-exports
// it like every other mirror instead of redirecting.
export { default } from "@/app/[locale]/(tenant)/dashboard/agent/page";

export const metadata: Metadata = { title: "Agent — Heyloo" };
