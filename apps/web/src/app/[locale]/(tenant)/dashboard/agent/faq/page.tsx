"use client";

import { Button, Card, CardContent, FAQEditor, type FaqItemData } from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

export default function FaqTabPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<FaqItemData[]>([]);
  const [loaded, setLoaded] = useState(false);

  useQuery({
    queryKey: ["tenant", tenantId, "agent_configs", "faq"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("agent_configs")
        .select("dynamic_variable_overrides")
        .eq("tenant_id", tenantId as string)
        .maybeSingle();
      const overrides = (data?.dynamic_variable_overrides ?? {}) as { faq_items?: FaqItemData[] };
      setItems(overrides.faq_items ?? []);
      setLoaded(true);
      return data;
    },
    enabled: !!tenantId,
  });

  async function save() {
    const { data: current } = await supabaseBrowserClient
      .from("agent_configs")
      .select("dynamic_variable_overrides")
      .eq("tenant_id", tenantId as string)
      .maybeSingle();
    const overrides = (current?.dynamic_variable_overrides ?? {}) as Record<string, unknown>;
    const { error } = await supabaseBrowserClient
      .from("agent_configs")
      .update({ dynamic_variable_overrides: { ...overrides, faq_items: items } })
      .eq("tenant_id", tenantId as string);
    if (error) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success("Saved — updating your AI, ~30s");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "agent_configs"] });
  }

  if (!loaded) return null;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <FAQEditor items={items} onChange={setItems} />
        <Button onClick={save}>Save</Button>
      </CardContent>
    </Card>
  );
}
