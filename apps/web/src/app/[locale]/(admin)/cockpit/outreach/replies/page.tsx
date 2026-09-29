"use client";

import { DataState, PageHeader, type ReplyData, ReplyFeedItem } from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";
import { failureMessage, type RawReply, SUCCESS_MESSAGE, toReplyData } from "./replies";

export default function RepliesPage() {
  const queryClient = useQueryClient();
  const query = useAdminQuery<{ replies: RawReply[] }>("replies", [], "admin-outreach/replies");

  async function onAction(reply: ReplyData, action: string) {
    // `POST admin-outreach/replies/:id/actions` with `{ action }` — the id is in the path.
    const res = await fetch(`/api/admin/admin-outreach/replies/${reply.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      toast.success(SUCCESS_MESSAGE[action] ?? "Action applied");
      void queryClient.invalidateQueries({ queryKey: ["admin", "replies"] });
      return;
    }
    const body: unknown = await res.json().catch(() => null);
    toast.error(failureMessage(res.status, body));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Replies"
        description="Inbound replies to outreach: send the demo link to interested leads, or suppress anyone who asks to stop."
      />
      <DataState
        query={query}
        empty={{
          title: "No replies yet",
          isEmpty: (data) => (data?.replies?.length ?? 0) === 0,
        }}
        render={(data) => (
          <div className="space-y-2">
            {(data.replies ?? []).map((raw) => {
              const reply = toReplyData(raw);
              return (
                <ReplyFeedItem
                  key={reply.id}
                  reply={reply}
                  onAction={(action) => onAction(reply, action)}
                />
              );
            })}
          </div>
        )}
      />
    </div>
  );
}
