import { Card, CardContent, PageHeader, StatusBadge } from "@heyloo/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SupportReplyForm } from "@/components/tenant/support-reply-form";
import { requireTenantSession } from "@/lib/auth/require-tenant-session";

export const metadata: Metadata = { title: "Support ticket — Heyloo" };

export default async function SupportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, tenant } = await requireTenantSession(`/dashboard/support/${id}`);

  const { data: ticket } = await supabase
    .from("support_requests")
    .select("id, subject, body, status, created_at")
    .eq("tenant_id", tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (!ticket) notFound();

  const { data: notes } = await supabase
    .from("support_request_notes")
    .select("id, body, created_at")
    .eq("support_request_id", id)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-4">
      <PageHeader
        title={ticket.subject}
        actions={<StatusBadge variant="ticket" value={ticket.status} />}
      />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <p className="text-xs text-muted-foreground">
              {new Date(ticket.created_at).toLocaleString()}
            </p>
            <p className="mt-1 text-sm">{ticket.body}</p>
          </div>
          {(notes ?? []).map((note) => (
            <div key={note.id} className="border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                {new Date(note.created_at).toLocaleString()}
              </p>
              <p className="mt-1 text-sm">{note.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <SupportReplyForm ticketId={ticket.id} />
    </div>
  );
}
