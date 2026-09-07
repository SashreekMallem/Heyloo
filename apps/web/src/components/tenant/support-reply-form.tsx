"use client";

import { supportTicketReplySchema } from "@heyloo/canonical-types";
import { Button, Textarea } from "@heyloo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";

export function SupportReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const parsed = supportTicketReplySchema.safeParse({ ticket_id: ticketId, body });
    if (!parsed.success) {
      toast.error("Reply cannot be empty.");
      return;
    }
    setSubmitting(true);
    const {
      data: { user },
    } = await supabaseBrowserClient.auth.getUser();
    if (!user) {
      setSubmitting(false);
      toast.error("Your session expired — please refresh and try again.");
      return;
    }
    const { error } = await supabaseBrowserClient.from("support_request_notes").insert({
      support_request_id: ticketId,
      body: parsed.data.body,
      visible_to_tenant: true,
      author_id: user.id,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Couldn't send your reply — please try again.");
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a reply…"
      />
      <Button onClick={submit} disabled={submitting}>
        Send reply
      </Button>
    </div>
  );
}
