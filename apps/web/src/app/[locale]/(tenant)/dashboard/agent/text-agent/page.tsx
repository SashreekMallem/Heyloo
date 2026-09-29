"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { SAVED_NEXT_TEXT } from "@/lib/settings/client";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

type Tone = "friendly" | "professional" | "concise";

interface TextAgentForm {
  enabled: boolean;
  tone: Tone;
  signOff: string;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

// Quiet hours default ON 21:00-09:00 — exactly what the reminder job
// assumes when nothing is stored (`_shared/quiet-hours.ts`,
// `resolveQuietHoursWindow`: `enabled !== false`). SETTINGS-1: the page
// used to show "off" for a tenant the backend treats as "on".
const DEFAULTS: TextAgentForm = {
  enabled: false,
  tone: "friendly",
  signOff: "",
  quietHoursEnabled: true,
  quietStart: "21:00",
  quietEnd: "09:00",
};

/** The reminder job only reads the HOUR of each bound — store what it honors. */
function toWholeHour(value: string, fallback: string): string {
  const match = /^(\d{2}):\d{2}$/.exec(value);
  return match ? `${match[1]}:00` : fallback;
}

type TenantTextAgentRow = {
  text_agent_enabled: boolean | null;
  text_agent_persona: unknown;
  quiet_hours: unknown;
};

function deriveForm(row: TenantTextAgentRow): TextAgentForm {
  const persona = (row.text_agent_persona ?? {}) as { tone?: Tone; signOff?: string };
  const quiet = (row.quiet_hours ?? {}) as { enabled?: boolean; start?: string; end?: string };
  return {
    enabled: row.text_agent_enabled ?? false,
    tone: persona.tone ?? DEFAULTS.tone,
    signOff: persona.signOff ?? "",
    quietHoursEnabled: quiet.enabled !== false,
    quietStart: quiet.start ?? DEFAULTS.quietStart,
    quietEnd: quiet.end ?? DEFAULTS.quietEnd,
  };
}

/**
 * Text agent settings (BACKEND_SPEC.md §13.2's `tenants.text_agent_enabled`
 * / `text_agent_persona` / `quiet_hours` columns — BUILD_PLAN Cluster W).
 * SETTINGS-2: the text engine (`_shared/text-agent/engine.ts`) now reads the
 * on/off switch (SMS replies) and the persona (`{tone, signOff}`) on every
 * turn. Quiet hours still gate only proactive texts such as reminders, never a
 * reply to a customer who just texted (CHANNELS-2's ratified decision), and the
 * card says so.
 */
export default function TextAgentTabPage() {
  const tenantId = useCurrentTenantId();

  const query = useQuery({
    queryKey: ["tenant", tenantId, "tenants", "text_agent"],
    queryFn: async () => {
      const { data } = await supabaseBrowserClient
        .from("tenants")
        .select("text_agent_enabled, text_agent_persona, quiet_hours")
        .eq("id", tenantId as string)
        .maybeSingle();
      return data;
    },
    enabled: !!tenantId,
  });

  // Gate the form on data being loaded rather than deriving its initial
  // state via a setState-in-effect (a cascading-render anti-pattern) — the
  // inner component below seeds its local state once, straight from these
  // already-loaded row values, the moment it mounts.
  if (!tenantId || !query.data) return null;
  return <TextAgentSettingsCard tenantId={tenantId} initial={query.data} />;
}

function TextAgentSettingsCard({
  tenantId,
  initial,
}: {
  tenantId: string;
  initial: TenantTextAgentRow;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TextAgentForm>(() => deriveForm(initial));
  const [saving, setSaving] = useState(false);

  async function save(next: TextAgentForm) {
    setSaving(true);
    const { error } = await supabaseBrowserClient
      .from("tenants")
      .update({
        text_agent_enabled: next.enabled,
        text_agent_persona: { tone: next.tone, signOff: next.signOff || undefined },
        quiet_hours: {
          enabled: next.quietHoursEnabled,
          start: toWholeHour(next.quietStart, DEFAULTS.quietStart),
          end: toWholeHour(next.quietEnd, DEFAULTS.quietEnd),
        },
      })
      .eq("id", tenantId);
    setSaving(false);
    if (error) {
      toast.error("Couldn't save — please try again.");
      return;
    }
    toast.success(SAVED_NEXT_TEXT);
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Text agent</CardTitle>
          <CardDescription>
            Lets your AI reply to inbound texts and website chat automatically — independent of your
            voice agent, which always keeps answering calls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Text agent enabled</p>
              <p className="text-xs text-muted-foreground">
                Messages always arrive in your Messages inbox either way.
              </p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(checked) => {
                const next = { ...form, enabled: checked };
                setForm(next);
                void save(next);
              }}
              aria-label="Text agent enabled"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Off: texts to your business number still arrive in your inbox, but your AI does not
            reply on its own. On: it replies to each new text. Takes effect from the next message.
            Website chat follows the Website widget switch, not this one. Replies also need your
            carrier approval to finish — see{" "}
            <Link href="/dashboard/texting" className="underline">
              Text messaging
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Persona</CardTitle>
          <CardDescription>
            How your text agent sounds. Used from the next text. The sign-off ends the last reply of
            a conversation, not every message; the AI notice at the start of a chat can&apos;t be
            changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="text-agent-tone">Tone</Label>
            <Select value={form.tone} onValueChange={(v) => setForm({ ...form, tone: v as Tone })}>
              <SelectTrigger id="text-agent-tone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="friendly">Friendly</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="concise">Concise</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="text-agent-signoff">Sign-off (optional)</Label>
            <Textarea
              id="text-agent-signoff"
              placeholder="— The team at Acme"
              value={form.signOff}
              onChange={(e) => setForm({ ...form, signOff: e.target.value })}
              rows={2}
              maxLength={120}
            />
          </div>
          <Button type="button" disabled={saving} onClick={() => void save(form)}>
            Save persona
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quiet hours</CardTitle>
          <CardDescription>
            Appointment reminder texts wait until quiet hours end (on by default, 9 PM – 9 AM your
            time). Whole hours only. Replies to a customer who just texted you are not delayed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Enable quiet hours</p>
            <Switch
              checked={form.quietHoursEnabled}
              onCheckedChange={(checked) => setForm({ ...form, quietHoursEnabled: checked })}
              aria-label="Enable quiet hours"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quiet-start">Starts at</Label>
              <Input
                id="quiet-start"
                type="time"
                step={3600}
                value={form.quietStart}
                onChange={(e) => setForm({ ...form, quietStart: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quiet-end">Ends at</Label>
              <Input
                id="quiet-end"
                type="time"
                step={3600}
                value={form.quietEnd}
                onChange={(e) => setForm({ ...form, quietEnd: e.target.value })}
              />
            </div>
          </div>
          <Button type="button" disabled={saving} onClick={() => void save(form)}>
            Save quiet hours
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
