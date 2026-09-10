"use client";

import {
  Button,
  Card,
  CardContent,
  DataState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { toast } from "sonner";
import { useAdminQuery } from "@/lib/hooks/use-admin-query";

interface TicketDetail {
  ticket: {
    id: string;
    tenant_name: string;
    tenant_vertical: string | null;
    subject: string;
    body: string;
    status: string;
    priority: string;
    created_at: string;
  };
  notes: Array<{ id: string; body: string; created_at: string; author_id: string }>;
}

const STATUSES = ["open", "pending", "resolved", "closed"] as const;

export default function AdminSupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const query = useAdminQuery<TicketDetail>(
    "support_request",
    [id],
    `admin-support-requests/${id}`,
  );

  async function setStatus(status: string) {
    const res = await fetch(`/api/admin/admin-support-requests/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      toast.success("Status updated");
      void queryClient.invalidateQueries({ queryKey: ["admin", "support_request", id] });
    } else {
      toast.error("Couldn't update status — please try again.");
    }
  }

  async function sendReply() {
    if (!reply.trim()) return;
    setSubmitting(true);
    const res = await fetch(`/api/admin/admin-support-requests/${id}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: reply }),
    });
    setSubmitting(false);
    if (res.ok) {
      setReply("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "support_request", id] });
    } else {
      toast.error("Couldn't send reply — please try again.");
    }
  }

  return (
    <DataState
      query={query}
      empty={{ title: "Ticket not found", isEmpty: (d) => !d?.ticket }}
      render={(data) => (
        <div className="max-w-2xl space-y-6">
          <PageHeader
            title={data.ticket.subject}
            description={
              <>
                {data.ticket.tenant_name}
                {data.ticket.tenant_vertical ? ` · ${data.ticket.tenant_vertical}` : ""}
              </>
            }
            actions={
              <Select value={data.ticket.status} onValueChange={setStatus}>
                <SelectTrigger className="w-36 capitalize" aria-label="Ticket status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div>
                <p className="text-xs text-muted-foreground">
                  {new Date(data.ticket.created_at).toLocaleString()}
                </p>
                <p className="mt-1 text-sm">{data.ticket.body}</p>
              </div>
              {(data.notes ?? []).map((note) => (
                <div key={note.id} className="border-t border-border pt-4">
                  <p className="text-xs text-muted-foreground">
                    {new Date(note.created_at).toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm">{note.body}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply to the tenant…"
            />
            <Button onClick={sendReply} disabled={submitting || !reply.trim()}>
              Send reply
            </Button>
          </div>
        </div>
      )}
    />
  );
}
