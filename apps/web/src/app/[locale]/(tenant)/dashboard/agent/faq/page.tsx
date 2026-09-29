"use client";

import { Button, Card, CardContent, FAQEditor, type FaqItemData } from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { NotLiveNote } from "@/components/tenant/settings/not-live-note";
import { SAVED_NOT_LIVE, saveErrorMessage, sendJson } from "@/lib/settings/client";
import { faqRequestSchema } from "@/lib/settings/schemas";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

function readItems(overrides: unknown): FaqItemData[] {
  const raw = (overrides as { faq_items?: unknown } | null)?.faq_items;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is FaqItemData => typeof item === "object" && item !== null)
    .map((item) => ({ question: String(item.question ?? ""), answer: String(item.answer ?? "") }));
}

/**
 * Agent → FAQ (SETTINGS-1): validated per row (`faqItemSchema` — it existed
 * but was never applied, so blank rows were stored) and saved through
 * `POST /api/tenant/agent/faq`. Labeled honestly: nothing on a call reads
 * `faq_items` yet (backend follow-up in docs/BUILD_NOTES.md SETTINGS-1).
 */
export default function FaqTabPage() {
  const tenantId = useCurrentTenantId();
  const query = useQuery({
    queryKey: ["tenant", tenantId, "agent_configs", "faq"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("agent_configs")
        .select("dynamic_variable_overrides")
        .eq("tenant_id", tenantId as string)
        .maybeSingle();
      return readItems(data?.dynamic_variable_overrides ?? null);
    },
    enabled: !!tenantId,
  });

  if (!tenantId || !query.data) return null;
  return <FaqForm tenantId={tenantId} initial={query.data} />;
}

function FaqForm({ tenantId, initial }: { tenantId: string; initial: FaqItemData[] }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<FaqItemData[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    // Fully blank rows are dropped rather than rejected; half-filled rows are errors.
    const kept = items.filter((item) => item.question.trim() || item.answer.trim());
    const parsed = faqRequestSchema.safeParse({ items: kept });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const row = typeof issue?.path[1] === "number" ? ` (question ${issue.path[1] + 1})` : "";
      setError(`${(issue?.message ?? "Check your FAQ").replace(/\.$/, "")}${row}.`);
      return;
    }
    setError(null);
    setSaving(true);
    const result = await sendJson("/api/tenant/agent/faq", parsed.data);
    setSaving(false);
    if (!result.ok) {
      toast.error(saveErrorMessage(result));
      return;
    }
    setItems(parsed.data.items);
    toast.success(SAVED_NOT_LIVE);
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <NotLiveNote>
          Your AI doesn&apos;t answer from this FAQ on calls yet. Your questions and answers are
          kept and will be used automatically once FAQ answers ship.
        </NotLiveNote>
        <FAQEditor items={items} onChange={setItems} />
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
