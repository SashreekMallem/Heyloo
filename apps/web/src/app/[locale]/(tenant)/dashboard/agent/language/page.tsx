"use client";

import { AGENT_LANGUAGES } from "@heyloo/canonical-types";
import {
  Button,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

const LABELS: Record<string, string> = { en: "English", es: "Español (coming soon)" };

export default function LanguageTabPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState("en");
  const [loaded, setLoaded] = useState(false);

  useQuery({
    queryKey: ["tenant", tenantId, "tenants", "language"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("tenants")
        .select("language_config")
        .eq("id", tenantId as string)
        .maybeSingle();
      setLanguage((data?.language_config as { primary?: string } | undefined)?.primary ?? "en");
      setLoaded(true);
      return data;
    },
    enabled: !!tenantId,
  });

  async function save() {
    const { error } = await supabaseBrowserClient
      .from("tenants")
      .update({ language_config: { primary: language, bilingual: false } })
      .eq("id", tenantId as string);
    if (error) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success("Saved — updating your AI, ~30s");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
  }

  if (!loaded) return null;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-sm text-muted-foreground">
          This is your AI&apos;s spoken call language — separate from your dashboard&apos;s display
          language.
        </p>
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className="w-64" aria-label="AI call language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGENT_LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang} disabled={lang !== "en"}>
                {LABELS[lang]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={save}>Save</Button>
      </CardContent>
    </Card>
  );
}
