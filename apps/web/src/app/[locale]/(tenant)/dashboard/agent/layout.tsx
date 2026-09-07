import type { ReactNode } from "react";
import { AgentSettingsTabs } from "@/components/tenant/agent-settings-tabs";

export default function AgentSettingsLayout({ children }: { children: ReactNode }) {
  return <AgentSettingsTabs>{children}</AgentSettingsTabs>;
}
