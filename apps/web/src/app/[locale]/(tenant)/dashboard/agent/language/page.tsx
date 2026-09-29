"use client";

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
import { SAVED_NEEDS_PUBLISH, saveErrorMessage, sendJson } from "@/lib/settings/client";
import { publishStatusQueryKey } from "@/lib/settings/publish-status";
import { CALL_LANGUAGES } from "@/lib/settings/schemas";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

const LABELS: Record<(typeof CALL_LANGUAGES)[number], string> = {
  en: "English",
  es: "Español (Spanish)",
};

/**
 * Agent → Language (SETTINGS-1). Spanish is live (VERIFY-DEPLOY proved a
 * full Spanish booking end to end), so it is selectable now. The call
 * language is baked into the published agent, so saving goes through
 * `POST /api/tenant/settings/language` (which stamps the change) and then
 * refreshes `AgentPublishStatus`, which shows "Changes pending" until the
 * owner publishes.
 */
export default function LanguageTabPage() {
  const tenantId = useCurrentTenantId();
  const query = useQuery({
    queryKey: ["tenant", tenantId, "tenants", "language"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("tenants")
        .select("language_config")
        .eq("id", tenantId as string)
        .maybeSingle();
      const primary = (data?.language_config as { primary?: string } | undefined)?.primary;
      return primary === "es" ? "es" : "en";
    },
    enabled: !!tenantId,
  });

  if (!tenantId || !query.data) return null;
  return <LanguageForm tenantId={tenantId} initial={query.data} />;
}

function LanguageForm({ tenantId, initial }: { tenantId: string; initial: "en" | "es" }) {
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState<"en" | "es">(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await sendJson<{ changed: boolean }>("/api/tenant/settings/language", {
      primary: language,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(saveErrorMessage(result));
      return;
    }
    toast.success(result.body?.changed ? SAVED_NEEDS_PUBLISH : "No change — already set.");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
    void queryClient.invalidateQueries({ queryKey: publishStatusQueryKey(tenantId) });
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "settings_checklist"] });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-sm text-muted-foreground">
          The language your AI greets callers in and speaks by default — separate from your
          dashboard&apos;s display language.
        </p>
        <Select value={language} onValueChange={(v) => setLanguage(v === "es" ? "es" : "en")}>
          <SelectTrigger className="w-64" aria-label="AI call language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CALL_LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {LABELS[lang]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          After saving, click <strong>Publish changes</strong> at the top of this page — the new
          language reaches callers once your agent is republished.
        </p>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
