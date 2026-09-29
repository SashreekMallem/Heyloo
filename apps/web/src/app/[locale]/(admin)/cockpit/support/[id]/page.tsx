"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DataState,
  Label,
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
  notes: Array<{
    id: string;
    body: string;
    created_at: string;
    author_id: string;
    /** Who wrote it: a platform admin (the support team) or the tenant's own user. */
    author_role?: "admin" | "tenant";
    /** false = an internal note the tenant never sees. */
    visible_to_tenant?: boolean;
  }>;
}

const STATUSES = ["open", "pending", "resolved", "closed"] as const;

export default function AdminSupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
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
      body: JSON.stringify({ body: reply, visible_to_tenant: !internal }),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success(internal ? "Internal note saved" : "Reply sent to the tenant");
      setReply("");
      setInternal(false);
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
                <div
                  key={note.id}
                  data-testid={`support-note-${note.id}`}
                  className="border-t border-border pt-4"
                >
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {note.author_role === "admin" ? "Support team" : "Tenant"}
                    </span>
                    {note.visible_to_tenant === false && <Badge variant="warning">Internal</Badge>}
                    <span>{new Date(note.created_at).toLocaleString()}</span>
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
              placeholder={
                internal ? "Internal note (the tenant won't see this)…" : "Reply to the tenant…"
              }
              aria-label={internal ? "Internal note" : "Reply to the tenant"}
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="support-internal-note"
                checked={internal}
                onCheckedChange={(checked) => setInternal(checked === true)}
              />
              <Label htmlFor="support-internal-note" className="text-sm font-normal">
                Internal note (not visible to the tenant)
              </Label>
            </div>
            <Button onClick={sendReply} disabled={submitting || !reply.trim()}>
              {internal ? "Save note" : "Send reply"}
            </Button>
          </div>
        </div>
      )}
    />
  );
}
