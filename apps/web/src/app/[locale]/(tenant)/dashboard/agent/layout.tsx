import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AgentSettingsTabs } from "@/components/tenant/agent-settings-tabs";

// SETTINGS-1: the Overview (this route's own page) is now real content, so
// it needs a title; each tab's own layout.tsx still overrides it.
export const metadata: Metadata = { title: "Agent settings — Heyloo" };

export default function AgentSettingsLayout({ children }: { children: ReactNode }) {
  return <AgentSettingsTabs>{children}</AgentSettingsTabs>;
}
