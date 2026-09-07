"use client";

import { DataState, type ReplyData, ReplyFeedItem } from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

export default function RepliesPage() {
  const queryClient = useQueryClient();
  const query = useAdminQuery<{ replies: ReplyData[] }>("replies", [], "admin-outreach/replies");

  async function onAction(reply: ReplyData, action: string) {
    const res = await fetch("/api/admin/admin-outreach/replies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reply_id: reply.id, action }),
    });
    if (res.ok) {
      toast.success(action === "unsubscribe" ? "Unsubscribed" : "Action applied");
      void queryClient.invalidateQueries({ queryKey: ["admin", "replies"] });
    } else {
      toast.error("Not available yet — backend endpoint pending.");
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Replies</h1>
      <DataState
        query={query}
        empty={{ title: "No replies yet" }}
        render={(data) => (
          <div className="space-y-2">
            {data.replies.map((reply) => (
              <ReplyFeedItem
                key={reply.id}
                reply={reply}
                onAction={(action) => onAction(reply, action)}
              />
            ))}
          </div>
        )}
      />
    </div>
  );
}
