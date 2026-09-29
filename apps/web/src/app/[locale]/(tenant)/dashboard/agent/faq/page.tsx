"use client";

import { Button, Card, CardContent, FAQEditor, type FaqItemData } from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { SAVED_NEXT_CALL, saveErrorMessage, sendJson } from "@/lib/settings/client";
import { countFaqItemsAgentReads, FAQ_LIVE_MAX_CHARS } from "@/lib/settings/faq-budget";
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
 * `POST /api/tenant/agent/faq`. SETTINGS-2: the AI now answers from it — the
 * call-time reader sends a bounded, sanitized slice of the list (see
 * `lib/settings/faq-budget.ts`), so this page says how much of it is read.
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
    toast.success(SAVED_NEXT_CALL);
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
  }

  const filled = items.filter((item) => item.question.trim() && item.answer.trim());
  const filledCount = filled.length;
  const readCount = countFaqItemsAgentReads(items);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-sm text-muted-foreground">
          Your AI answers callers and texters from these questions, in its own words, starting from
          the next call. If a question isn&apos;t here it says so and offers to take a message. Put
          the most important ones first: it reads up to {FAQ_LIVE_MAX_CHARS.toLocaleString()}{" "}
          characters of them.
        </p>
        <FAQEditor items={items} onChange={setItems} />
        {readCount < filledCount && (
          <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
            Your AI currently reads the first {readCount} of your {filledCount} questions — shorten
            some answers or remove less important questions to fit the rest.
          </p>
        )}
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
