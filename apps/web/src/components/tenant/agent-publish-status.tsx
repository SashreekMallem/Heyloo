"use client";

import { Badge, Button } from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { PublishStatusResponse } from "@/app/api/tenant/agent/publish-status/route";
import { PUBLISH_REASON_TEXT, publishStatusQueryKey } from "@/lib/settings/publish-status";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

/**
 * PUBLISH-1 (docs/BUILD_NOTES.md): the "Publish changes" action, in
 * `AgentSettingsTabs`' `PageHeader` so it's visible from every
 * agent-settings sub-page. POSTs `/api/tenant/agent/publish` (owner/admin
 * only — the edge function enforces the role) to trigger a live republish.
 *
 * SETTINGS-1: "Changes pending" now comes from
 * `GET /api/tenant/agent/publish-status` (`lib/settings/publish-status.ts`)
 * instead of `agent_configs.updated_at > published_at`. The old signal lit
 * up for edits that are already live on the next call (assistant name,
 * transfer number, vertical details, FAQ) and missed the call-language
 * change, which lives on `tenants` and really does need a publish — as
 * does an agent compiled before today's live-setting tokens existed. The
 * reason is shown next to the badge so the owner knows WHY.
 */
export function AgentPublishStatus() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [publishing, setPublishing] = useState(false);

  const query = useQuery({
    queryKey: publishStatusQueryKey(tenantId),
    queryFn: async (): Promise<PublishStatusResponse | null> => {
      const res = await fetch("/api/tenant/agent/publish-status");
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<PublishStatusResponse>;
      return Array.isArray(body.reasons) ? (body as PublishStatusResponse) : null;
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
      await queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "settings_checklist"] });
    } catch {
      toast.error("Couldn't publish your changes — please try again.");
    } finally {
      setPublishing(false);
    }
  }

  const status = query.data;
  const reasonText = status?.pending
    ? status.reasons.map((reason) => PUBLISH_REASON_TEXT[reason]).join(" ")
    : null;

  return (
    <div className="flex max-w-xl flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap items-center gap-3">
        {status?.pending && <Badge variant="warning">Changes pending</Badge>}
        {status === undefined || status === null ? null : status.publishedAt ? (
          <span className="text-xs text-muted-foreground">
            Last published {new Date(status.publishedAt).toLocaleString()}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Never published</span>
        )}
        <Button onClick={publish} disabled={publishing || query.isLoading} size="sm">
          {publishing ? "Publishing…" : "Publish changes"}
        </Button>
      </div>
      {reasonText && <p className="text-xs text-muted-foreground sm:text-right">{reasonText}</p>}
    </div>
  );
}
