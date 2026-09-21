"use client";

import { Badge, Button } from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface AgentPublishRow {
  updated_at: string;
  published_at: string | null;
}

/**
 * PUBLISH-1 (docs/BUILD_NOTES.md): the "Publish changes" action ONBOARD-1
 * found missing entirely — sits in `AgentSettingsTabs`' `PageHeader` so
 * it's visible from every agent-settings sub-page (greeting, hours,
 * instructions, …), not just one tab. Reads `agent_configs.updated_at`/
 * `published_at` directly via PostgREST (RLS-scoped, same pattern every
 * other agent tab already uses — `InstructionsTabPage`, `GreetingTabPage`)
 * to show a real status line, and POSTs `/api/tenant/agent/publish` (owner/
 * admin only — the edge function itself enforces the role, this button
 * just surfaces whatever it returns) to trigger a live republish.
 *
 * "Changes pending" is `updated_at > published_at` per this task's own
 * spec — an honest, if approximate, proxy: most `agent_configs` fields
 * (assistant_name, special_instructions, transfer_number, greeting/
 * dynamic_variable overrides) DO need a republish to reach the compiled
 * prompt text, but PUBLISH-1 also made `transfer_number` specifically take
 * effect live without one (compiled flows now reference the live
 * `{{transfer_number}}` dynamic variable) — so this can occasionally show
 * "pending" for a change that's already live. Never the reverse (it never
 * hides a REAL pending change), which is the safer direction for a status
 * line whose worst failure mode should be "prompts you to publish one
 * extra time," not "tells you you're live when you aren't."
 */
export function AgentPublishStatus() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [publishing, setPublishing] = useState(false);

  const query = useQuery({
    queryKey: ["tenant", tenantId, "agent_configs", "publish_status"],
    queryFn: async (): Promise<AgentPublishRow | null> => {
      const { data } = await supabaseBrowserClient
        .from("agent_configs")
        .select("updated_at, published_at")
        .eq("tenant_id", tenantId as string)
        .maybeSingle();
      return data;
    },
    enabled: !!tenantId,
  });

  async function publish() {
    setPublishing(true);
    try {
      const res = await fetch("/api/tenant/agent/publish", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(
          body.error === "forbidden"
            ? "Only an owner or admin can publish agent changes."
            : "Couldn't publish your changes — please try again.",
        );
        return;
      }
      toast.success("Changes published — your agent is live.");
      await queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
    } catch {
      toast.error("Couldn't publish your changes — please try again.");
    } finally {
      setPublishing(false);
    }
  }

  const row = query.data;
  const pending =
    !!row && (!row.published_at || new Date(row.updated_at) > new Date(row.published_at));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={publish} disabled={publishing || query.isLoading} size="sm">
        {publishing ? "Publishing…" : "Publish changes"}
      </Button>
      {row === undefined ? null : row?.published_at ? (
        <span className="text-xs text-muted-foreground">
          Last published {new Date(row.published_at).toLocaleString()}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Never published</span>
      )}
      {pending && <Badge variant="warning">Changes pending</Badge>}
    </div>
  );
}
