"use client";

import { supportTicketCreateSchema } from "@heyloo/canonical-types";
import {
  Button,
  DataState,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  StatusBadge,
  Textarea,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

interface TicketRow {
  id: string;
  subject: string;
  status: string;
  updated_at: string;
}

const columns: ColumnDef<TicketRow, unknown>[] = [
  { accessorKey: "subject", header: "Subject" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge variant="ticket" value={row.original.status} />,
  },
  {
    accessorKey: "updated_at",
    header: "Last updated",
    cell: ({ row }) => new Date(row.original.updated_at).toLocaleString(),
  },
];

export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportPageContent />
    </Suspense>
  );
}

function SupportPageContent() {
  const tenantId = useCurrentTenantId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(() => Boolean(searchParams.get("call_id")));
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const query = useQuery({
    queryKey: ["tenant", tenantId, "support_requests"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("support_requests")
        .select("id, subject, status, updated_at")
        .eq("tenant_id", tenantId as string)
        .order("updated_at", { ascending: false });
      return (data ?? []) as TicketRow[];
    },
    enabled: !!tenantId,
  });

  async function createTicket() {
    const parsed = supportTicketCreateSchema.safeParse({
      subject,
      body,
      call_id: searchParams.get("call_id") ?? undefined,
    });
    if (!parsed.success) {
      toast.error("Subject and description are required.");
      return;
    }
    const { error } = await supabaseBrowserClient.from("support_requests").insert({
      tenant_id: tenantId as string,
      subject: parsed.data.subject,
      body: parsed.data.body,
      call_id: parsed.data.call_id ?? null,
    });
    if (error) {
      toast.error("Couldn't create the ticket — please try again.");
      return;
    }
    toast.success("Ticket created");
    setDialogOpen(false);
    setSubject("");
    setBody("");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "support_requests"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Support</h1>
        <Button onClick={() => setDialogOpen(true)}>New ticket</Button>
      </div>

      <DataState
        query={query}
        empty={{ title: "No support tickets", description: "Need help? Start one below." }}
        render={(tickets) => (
          <DataTable
            columns={columns}
            data={tickets}
            onRowClick={(row) => router.push(`/dashboard/support/${row.id}`)}
            renderMobileCard={(row) => (
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{row.subject}</p>
                <StatusBadge variant="ticket" value={row.status} className="mt-1" />
              </div>
            )}
          />
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New support ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <Textarea
              placeholder="Describe the issue"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={createTicket}>Create ticket</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
