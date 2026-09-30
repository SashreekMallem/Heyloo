"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { saveErrorMessage, sendJson } from "@/lib/settings/client";
import { ReadOnlyNote } from "@/lib/settings/read-only-note";
import {
  normalizeWidgetOrigin,
  WIDGET_ACCENT_DEFAULT,
  widgetSettingsWriteSchema,
} from "@/lib/settings/widget-settings";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCanWriteSettings } from "@/lib/tenant/tenant-context";

type Position = "bottom-right" | "bottom-left";
type Mode = "voice" | "chat";

interface WidgetSettingsForm {
  widgetEnabled: boolean;
  widgetPublicKey: string | null;
  allowedOrigins: string[];
  accent: string;
  position: Position;
  greeting: string;
  modes: Mode[];
}

interface UsageRow {
  aiRepliesLast30Days: number;
}

const DEFAULT_ACCENT = WIDGET_ACCENT_DEFAULT;

/** The bottom tab bar (and so the fixed preview launcher's collision) exists below Tailwind's `md`. */
const SMALL_SCREEN_QUERY = "(max-width: 767px)";

function useSmallScreen(): boolean {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(SMALL_SCREEN_QUERY);
    const update = () => setSmall(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return small;
}

type TenantWidgetRow = {
  widget_enabled: boolean | null;
  widget_settings: unknown;
  widget_public_key: string | null;
};

function deriveWidgetForm(row: TenantWidgetRow): WidgetSettingsForm {
  const settings = (row.widget_settings ?? {}) as {
    allowed_origins?: string[];
    accent?: string | null;
    position?: Position;
    greeting?: string | null;
    modes?: Mode[];
  };
  return {
    widgetEnabled: row.widget_enabled ?? false,
    widgetPublicKey: row.widget_public_key ?? null,
    allowedOrigins: settings.allowed_origins ?? [],
    accent: settings.accent ?? DEFAULT_ACCENT,
    position: settings.position ?? "bottom-right",
    greeting: settings.greeting ?? "",
    modes: settings.modes && settings.modes.length > 0 ? settings.modes : ["chat"],
  };
}

export function WebsiteWidgetClient({ tenantId }: { tenantId: string }) {
  const query = useTenantQuery(tenantId, "tenants", ["website-widget"], async () => {
    const { data } = await supabaseBrowserClient
      .from("tenants")
      .select("widget_enabled, widget_settings, widget_public_key")
      .eq("id", tenantId)
      .maybeSingle();
    return data;
  });

  const usageQuery = useTenantQuery(
    tenantId,
    "usage_daily",
    ["website-widget-usage"],
    async (): Promise<UsageRow> => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data } = await supabaseBrowserClient
        .from("usage_daily")
        .select("text_messages_out")
        .eq("tenant_id", tenantId)
        .gte("date", since.toISOString().slice(0, 10));
      const total = (data ?? []).reduce((sum, row) => sum + (row.text_messages_out ?? 0), 0);
      return { aiRepliesLast30Days: total };
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Website widget"
        description="Add a floating Voice + Chat button to your own website, powered by the same AI that answers your phone."
      />
      <DataState
        query={query}
        empty={{ title: "Couldn't load your widget settings", description: "Please refresh." }}
        render={(data) =>
          // DataState's own `isEmpty` check (data == null) already gates
          // this branch at runtime; this is just satisfying the static
          // type, which still includes `null` because `.maybeSingle()`
          // can return it.
          data && <WidgetSettingsPanel tenantId={tenantId} initial={data} usageQuery={usageQuery} />
        }
      />
    </div>
  );
}

function WidgetSettingsPanel({
  tenantId,
  initial,
  usageQuery,
}: {
  tenantId: string;
  initial: TenantWidgetRow;
  usageQuery: ReturnType<typeof useTenantQuery<UsageRow>>;
}) {
  const queryClient = useQueryClient();
  const canWrite = useCanWriteSettings();
  const smallScreen = useSmallScreen();
  // Seeded once, straight from the already-loaded row, when this panel
  // mounts — DataState only renders it once `query.data` exists, so there
  // is no null gap to bridge with a setState-in-effect (a cascading-render
  // anti-pattern the React Compiler lint rule flags).
  const [form, setForm] = useState<WidgetSettingsForm>(() => deriveWidgetForm(initial));
  const [newOrigin, setNewOrigin] = useState("");
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [accentError, setAccentError] = useState<string | null>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const previewScriptOrigin = typeof window !== "undefined" ? window.location.origin : "";

  // Live preview — mounts the REAL built widget script against the
  // current, possibly-unsaved form state via `data-preview-config`
  // (`packages/widget/src/types.ts`'s `WidgetPreviewConfig`), which skips
  // every network call and disables real send/call actions
  // (`renderWithConfig`'s `isPreview` branch). Re-injects a fresh
  // `<script>` element (removing the previous widget host first) whenever
  // the relevant fields change, debounced, since the widget script has no
  // "update config" API of its own — each mount is fire-and-forget on
  // load.
  // QA-1 F-12: the real widget's launcher is `position: fixed` at the
  // bottom of the viewport, which on a phone sits on the bottom tab bar's
  // "More" button. Below `md` the preview isn't mounted at all.
  useEffect(() => {
    if (smallScreen) {
      document.getElementById("heyloo-widget-host")?.remove();
      return;
    }
    const timer = setTimeout(() => {
      document.getElementById("heyloo-widget-host")?.remove();
      document.querySelectorAll("script[data-heyloo-widget-preview]").forEach((n) => {
        n.remove();
      });
      const script = document.createElement("script");
      script.src = "/widget.js";
      script.async = true;
      script.setAttribute("data-heyloo-widget-preview", "1");
      script.setAttribute(
        "data-preview-config",
        JSON.stringify({
          business_name: "Your business",
          accent: form.accent,
          position: form.position,
          greeting: form.greeting || null,
          modes: form.modes.length > 0 ? form.modes : ["chat"],
        }),
      );
      document.body.appendChild(script);
    }, 400);
    return () => clearTimeout(timer);
  }, [form, smallScreen]);

  useEffect(() => {
    return () => {
      document.getElementById("heyloo-widget-host")?.remove();
      document.querySelectorAll("script[data-heyloo-widget-preview]").forEach((n) => {
        n.remove();
      });
    };
  }, []);

  /** Validates with the same schema as the route, so a bad value is caught inline before a round trip. */
  async function save(next: WidgetSettingsForm) {
    const parsed = widgetSettingsWriteSchema.safeParse({
      allowed_origins: next.allowedOrigins,
      accent: next.accent,
      position: next.position,
      greeting: next.greeting,
      modes: next.modes,
    });
    if (!parsed.success) {
      const issues = parsed.error.issues;
      setAccentError(issues.find((i) => i.path[0] === "accent")?.message ?? null);
      toast.error(issues[0]?.message ?? "Please check the widget settings.");
      return;
    }
    setAccentError(null);
    setSaving(true);
    const result = await sendJson("/api/tenant/settings/widget", {
      widget_settings: parsed.data,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(saveErrorMessage(result));
      return;
    }
    // Show what was actually stored (normalized origins, lower-cased accent).
    setForm({
      ...next,
      allowedOrigins: parsed.data.allowed_origins,
      accent: parsed.data.accent,
      greeting: parsed.data.greeting ?? "",
      modes: parsed.data.modes,
    });
    toast.success("Saved");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
  }

  async function setEnabled(checked: boolean) {
    const previous = form.widgetEnabled;
    setForm({ ...form, widgetEnabled: checked });
    const result = await sendJson("/api/tenant/settings/widget", { widget_enabled: checked });
    if (!result.ok) {
      setForm((current) => ({ ...current, widgetEnabled: previous }));
      toast.error(saveErrorMessage(result));
      return;
    }
    toast.success("Saved");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
  }

  async function rotateKey() {
    setConfirmRotate(false);
    setRotating(true);
    const result = await sendJson<{ widget_public_key?: string }>(
      "/api/tenant/settings/widget/rotate-key",
      {},
    );
    setRotating(false);
    const nextKey = result.body?.widget_public_key;
    if (!result.ok || !nextKey) {
      toast.error(
        result.error === "owner_or_admin_required"
          ? saveErrorMessage(result)
          : "Couldn't generate a key — please try again.",
      );
      return;
    }
    setForm((current) => ({ ...current, widgetPublicKey: nextKey }));
    toast.success("New key generated — update your site's snippet with the new one.");
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "tenants"] });
  }

  function toggleMode(mode: Mode, checked: boolean) {
    const modes = checked
      ? [...new Set([...form.modes, mode])]
      : form.modes.filter((m) => m !== mode);
    setForm({ ...form, modes });
  }

  function addOrigin() {
    if (!newOrigin.trim()) return;
    const normalized = normalizeWidgetOrigin(newOrigin);
    if (!normalized.ok) {
      toast.error(normalized.message);
      return;
    }
    if (form.allowedOrigins.includes(normalized.origin)) {
      toast.error("That domain is already allowed.");
      return;
    }
    setForm({ ...form, allowedOrigins: [...form.allowedOrigins, normalized.origin] });
    setNewOrigin("");
  }

  function removeOrigin(origin: string) {
    setForm({ ...form, allowedOrigins: form.allowedOrigins.filter((o) => o !== origin) });
  }

  const snippet = form.widgetPublicKey
    ? `<script src="${previewScriptOrigin}/widget.js" data-key="${form.widgetPublicKey}" async></script>`
    : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <ReadOnlyNote />
        <Card>
          <CardHeader>
            <CardTitle>Install on your site</CardTitle>
            <CardDescription>
              Paste this one line before the closing <code>&lt;/body&gt;</code> tag of your website.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3">
              <div>
                <p className="text-sm font-medium">Widget enabled</p>
                <p className="text-xs text-muted-foreground">
                  Turn off to hide the widget on your site immediately.
                </p>
              </div>
              <Switch
                checked={form.widgetEnabled}
                onCheckedChange={(checked) => void setEnabled(checked)}
                aria-label="Widget enabled"
                disabled={!canWrite}
              />
            </div>

            {snippet ? (
              <div className="space-y-2">
                <Label htmlFor="widget-snippet">Embed snippet</Label>
                <div className="flex items-start gap-2">
                  <code
                    id="widget-snippet"
                    className="block flex-1 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs"
                  >
                    {snippet}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copy snippet"
                    onClick={() => {
                      void navigator.clipboard?.writeText(snippet);
                      toast.success("Snippet copied");
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Generate a public key to get your embed snippet.
              </p>
            )}

            {canWrite && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rotating}
                onClick={() => (form.widgetPublicKey ? setConfirmRotate(true) : void rotateKey())}
              >
                <RefreshCw className="mr-2 size-4" />
                {form.widgetPublicKey ? "Rotate key" : "Generate key"}
              </Button>
            )}
            {form.widgetPublicKey && (
              <p className="text-xs text-muted-foreground">
                Rotating replaces the key — update the snippet on your site after rotating, or the
                old snippet will stop working.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Allowed domains</CardTitle>
            <CardDescription>
              Only pages on these exact domains can load your widget — anyone else who copies your
              key can&apos;t embed it elsewhere.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="https://example.com"
                aria-label="Allowed domain"
                disabled={!canWrite}
                value={newOrigin}
                onChange={(e) => setNewOrigin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addOrigin();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addOrigin} disabled={!canWrite}>
                <Plus className="mr-2 size-4" />
                Add
              </Button>
            </div>
            {form.allowedOrigins.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No domains added yet — the widget won&apos;t load anywhere until you add one.
              </p>
            ) : (
              <ul className="space-y-2">
                {form.allowedOrigins.map((origin) => (
                  <li
                    key={origin}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <span className="truncate font-mono text-sm">{origin}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${origin}`}
                      disabled={!canWrite}
                      onClick={() => removeOrigin(origin)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <Button type="button" size="sm" disabled={saving} onClick={() => void save(form)}>
                Save domains
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>How the button and panel look on your site.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.modes.includes("chat")}
                  disabled={!canWrite}
                  onChange={(e) => toggleMode("chat", e.target.checked)}
                  className="size-4"
                />
                Chat
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.modes.includes("voice")}
                  disabled={!canWrite}
                  onChange={(e) => toggleMode("voice", e.target.checked)}
                  className="size-4"
                />
                Voice (web call)
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="widget-position">Position</Label>
                <Select
                  value={form.position}
                  onValueChange={(v) => setForm({ ...form, position: v as Position })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="widget-position">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottom-right">Bottom right</SelectItem>
                    <SelectItem value="bottom-left">Bottom left</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="widget-accent">Accent color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="widget-accent"
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(form.accent) ? form.accent : DEFAULT_ACCENT}
                    onChange={(e) => setForm({ ...form, accent: e.target.value })}
                    disabled={!canWrite}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-border p-1"
                    aria-label="Accent color picker"
                  />
                  <Input
                    value={form.accent}
                    aria-label="Accent color (hex)"
                    aria-invalid={!!accentError}
                    disabled={!canWrite}
                    onChange={(e) => {
                      setAccentError(null);
                      setForm({ ...form, accent: e.target.value });
                    }}
                  />
                </div>
                {accentError && <p className="text-xs text-destructive">{accentError}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="widget-greeting">Greeting message</Label>
              <Textarea
                id="widget-greeting"
                placeholder="Hi! How can we help?"
                value={form.greeting}
                onChange={(e) => setForm({ ...form, greeting: e.target.value })}
                rows={2}
                maxLength={200}
                disabled={!canWrite}
              />
            </div>

            {canWrite && (
              <Button type="button" disabled={saving} onClick={() => void save(form)}>
                Save appearance
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Last 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataState
              query={usageQuery}
              empty={{ title: "No usage yet", description: "" }}
              render={(usage) => (
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">
                    {usage.aiRepliesLast30Days}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    AI text replies sent (SMS + widget chat combined)
                  </span>
                </div>
              )}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Voice-call usage from the widget will appear here in a future update.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>
              Try the real widget below, in this corner of the page. Voice and chat are disabled in
              preview — connect it on your live site to test them for real.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              ref={previewHostRef}
              className="flex h-40 items-center justify-center rounded-md border border-dashed border-border p-3 text-center text-sm text-muted-foreground"
            >
              {smallScreen
                ? "The live preview needs a wider screen — open this page on a tablet or computer to try it."
                : `Look for the button in the bottom ${form.position === "bottom-left" ? "left" : "right"} corner of this page.`}
            </div>
            {form.modes.length === 0 && (
              <Badge variant="warning" className="mt-3">
                No mode enabled — the widget won&apos;t render at all.
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>
      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the widget key?</AlertDialogTitle>
            <AlertDialogDescription>
              The widget on your website stops working right away, until you paste the new snippet
              into your site. Only rotate if your key has leaked or you&apos;re about to update the
              snippet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void rotateKey()}>Rotate key</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
