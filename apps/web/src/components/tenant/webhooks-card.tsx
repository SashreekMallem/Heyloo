"use client";

import {
  OUTBOUND_EVENT_LABELS,
  OUTBOUND_EVENT_TYPES,
  OUTBOUND_MAX_DESTINATIONS,
  type OutboundDeliveryStatus,
  type OutboundEventType,
  type TenantWebhooksRequest,
  zOutboundDestinationName,
  zOutboundDestinationUrl,
} from "@heyloo/canonical-types";
import type {
  OutboundDeliveryRow,
  OutboundDestinationRow,
  OutboundEventRow,
} from "@heyloo/supabase-client";
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
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  DataState,
  Input,
  Label,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { type SaveResult, sendJson } from "@/lib/settings/client";
import { supabaseBrowserClient } from "@/lib/supabase/browser";
import { useCanWriteSettings } from "@/lib/tenant/tenant-context";

/** Never `signing_secret_id`: owners cannot read it (column grant), and the UI has no use for it. */
const DESTINATION_COLUMNS =
  "id, name, url, event_types, enabled, disabled_reason, consecutive_failures, last_success_at, last_failure_at, last_error, created_at";
const DELIVERY_COLUMNS =
  "id, destination_id, event_id, status, attempt_count, next_attempt_at, last_status_code, last_error, delivered_at, created_at";
const DELIVERY_LOG_LIMIT = 50;
const DELIVERY_LOG_REFRESH_MS = 15_000;

/** The destination columns the card reads (`DESTINATION_COLUMNS`). */
export type WebhookDestination = Pick<
  OutboundDestinationRow,
  | "id"
  | "name"
  | "url"
  | "event_types"
  | "enabled"
  | "disabled_reason"
  | "consecutive_failures"
  | "last_success_at"
  | "last_failure_at"
  | "last_error"
  | "created_at"
>;

/** One delivery-log row: `DELIVERY_COLUMNS` plus its event's type (separate query, no embedded select). */
export type WebhookDeliveryLogRow = Pick<
  OutboundDeliveryRow,
  | "id"
  | "destination_id"
  | "status"
  | "attempt_count"
  | "next_attempt_at"
  | "last_status_code"
  | "last_error"
  | "delivered_at"
  | "created_at"
> & { event_type: OutboundEventRow["event_type"] | null };

const DELIVERY_STATUS_META: Record<
  OutboundDeliveryStatus,
  { label: string; variant: "secondary" | "success" | "warning" | "destructive" | "outline" }
> = {
  pending: { label: "Queued", variant: "secondary" },
  sending: { label: "Sending", variant: "secondary" },
  retrying: { label: "Retrying", variant: "warning" },
  delivered: { label: "Delivered", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

const EVENT_GROUPS: { title: string; types: OutboundEventType[] }[] = [
  { title: "Bookings", types: ["booking.created", "booking.updated", "booking.cancelled"] },
  { title: "Orders", types: ["order.created", "order.updated", "order.cancelled"] },
  { title: "Messages", types: ["message.taken"] },
];

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function eventLabel(type: string | null): string {
  if (!type) return "Event";
  return OUTBOUND_EVENT_LABELS[type as keyof typeof OUTBOUND_EVENT_LABELS] ?? type;
}

/** One line of owner-facing health for a destination. */
export function destinationHealth(d: WebhookDestination): {
  text: string;
  tone: "muted" | "ok" | "warning" | "danger";
} {
  if (!d.enabled && d.disabled_reason === "gone_410") {
    return {
      text: "Turned off: the receiving app said the URL is gone. Check the URL in that app, then turn this back on.",
      tone: "danger",
    };
  }
  if (!d.enabled) return { text: "Turned off — nothing is sent here.", tone: "muted" };
  if (d.consecutive_failures > 0 && d.last_failure_at) {
    const reason = d.last_error ? `${d.last_error}, ` : "";
    return {
      text: `Not delivering (${reason}last tried ${formatWhen(d.last_failure_at)}). Heyloo keeps retrying for about 2 days.`,
      tone: "warning",
    };
  }
  if (d.last_success_at) {
    return { text: `Working — last delivered ${formatWhen(d.last_success_at)}.`, tone: "ok" };
  }
  return { text: "Nothing sent yet — use Send test to check it.", tone: "muted" };
}

const HEALTH_CLASS: Record<ReturnType<typeof destinationHealth>["tone"], string> = {
  muted: "text-muted-foreground",
  ok: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

const READ_ONLY_TEXT = {
  owner_or_admin_required: "Only your account owner or an admin can change where events are sent.",
  read_only_session: "This support session is read-only — turn on edit mode to change webhooks.",
} as const;

type WebhookWriteDenial = keyof typeof READ_ONLY_TEXT;

/**
 * Owner-facing text for a failed `/api/tenant/webhooks` call. Error codes are
 * the `api-tenant-webhooks` ones; `url_not_allowed` carries its own
 * owner-safe `message` (why the address was refused).
 */
export function webhookErrorMessage(
  result: Pick<SaveResult, "status" | "error"> & { body?: unknown },
): string {
  if (result.status === 401) return "Your session expired — sign in again.";
  if (result.error === "read_only_session") return READ_ONLY_TEXT.read_only_session;
  if (result.status === 403) return "Only an owner or admin can change webhooks.";
  if (result.status === 404) return "That destination no longer exists — refresh the page.";
  if (result.error === "url_not_allowed") {
    return readString(result.body, "message") ?? "That web address isn't allowed.";
  }
  if (result.status === 400 || result.status === 422) {
    return "Check the name and URL — the URL must start with https://.";
  }
  if (result.error === "destination_limit") {
    return `You can have up to ${OUTBOUND_MAX_DESTINATIONS} destinations.`;
  }
  if (result.error === "destination_disabled") {
    return "Turn this destination back on first, then retry.";
  }
  if (result.error === "not_retryable") {
    return "This delivery can't be retried — it already went through or is on its way.";
  }
  if (result.status === 0 || result.status === 503 || result.status === 504) {
    return "Webhooks are unavailable right now — please try again in a minute.";
  }
  return "Couldn't save — please try again.";
}

/** Adds `https://` when the owner pasted a bare host; never downgrades an explicit scheme. */
export function normalizeWebhookUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function postWebhookAction(action: TenantWebhooksRequest): Promise<SaveResult> {
  return sendJson("/api/tenant/webhooks", action);
}

function readString(body: unknown, key: string): string | null {
  if (body === null || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * `GET /api/tenant/webhooks`: the edge function's own write rule for this
 * session. `null` when it can't be read (offline, preview) — the card then
 * falls back to the layout's `canWrite` hint and the POST still re-checks.
 */
async function fetchWebhooksAccess(): Promise<{ denial: WebhookWriteDenial | null } | null> {
  try {
    const res = await fetch("/api/tenant/webhooks", { cache: "no-store" });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (body === null || typeof body !== "object") return null;
    const canManage = (body as Record<string, unknown>)["can_manage"];
    if (canManage === true) return { denial: null };
    if (canManage !== false) return null;
    return {
      denial:
        readString(body, "reason") === "read_only_session"
          ? "read_only_session"
          : "owner_or_admin_required",
    };
  } catch {
    return null;
  }
}

/**
 * OUTBOUND-1 — Integrations → "Send bookings & orders to any app": signed
 * webhooks (Standard Webhooks) to Zapier, Make, n8n or any HTTPS endpoint.
 * Reads go straight to Postgres through RLS (`outbound_destinations`,
 * `outbound_deliveries`, `outbound_events`, always with an explicit tenant
 * filter); every write goes through `POST /api/tenant/webhooks` (owner/admin,
 * proxied to the `api-tenant-webhooks` edge function). The signing secret is
 * only ever in component state right after create/rotate, never stored here.
 */
export function WebhooksCard({ tenantId }: { tenantId: string }) {
  // The layout's hint also admits platform admins and read-only support
  // sessions, which `api-tenant-webhooks` refuses; the route answers with
  // that function's own rule so the card never offers a write that 403s.
  const layoutCanWrite = useCanWriteSettings();
  const access = useTenantQuery(tenantId, "webhooks_access", [], fetchWebhooksAccess, {
    enabled: layoutCanWrite,
    staleTime: 5 * 60_000,
  });
  const denial: WebhookWriteDenial | null = layoutCanWrite
    ? (access.data?.denial ?? null)
    : "owner_or_admin_required";
  const canWrite = denial === null;
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; secret: string } | null>(null);
  // One entry per in-flight row (destination or delivery id): finishing one
  // action never re-enables another row's buttons while its own call runs.
  // The ref is the synchronous guard; the state copy drives rendering.
  const inFlight = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [confirm, setConfirm] = useState<{
    kind: "delete" | "rotate";
    destination: WebhookDestination;
  } | null>(null);

  const destinations = useTenantQuery<WebhookDestination[]>(
    tenantId,
    "outbound_destinations",
    [],
    async () => {
      const { data, error } = await supabaseBrowserClient
        .from("outbound_destinations")
        .select(DESTINATION_COLUMNS)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true });
      if (error) throw new Error("failed_to_load_webhooks");
      return data ?? [];
    },
  );

  const deliveries = useTenantQuery<WebhookDeliveryLogRow[]>(
    tenantId,
    "outbound_deliveries",
    [],
    async () => {
      const { data, error } = await supabaseBrowserClient
        .from("outbound_deliveries")
        .select(DELIVERY_COLUMNS)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(DELIVERY_LOG_LIMIT);
      if (error) throw new Error("failed_to_load_deliveries");
      const rows = data ?? [];
      const eventIds = [...new Set(rows.map((r) => r.event_id))];
      const eventTypes = new Map<string, OutboundEventRow["event_type"]>();
      if (eventIds.length > 0) {
        const events = await supabaseBrowserClient
          .from("outbound_events")
          .select("id, event_type")
          .eq("tenant_id", tenantId)
          .in("id", eventIds);
        for (const e of events.data ?? []) {
          eventTypes.set(e.id, e.event_type);
        }
      }
      return rows.map(({ event_id, ...row }) => ({
        ...row,
        event_type: eventTypes.get(event_id) ?? null,
      }));
    },
    { refetchInterval: DELIVERY_LOG_REFRESH_MS },
  );

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "outbound_destinations"] });
    void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "outbound_deliveries"] });
  }

  function setRowPending(key: string, on: boolean) {
    if (on) inFlight.current.add(key);
    else inFlight.current.delete(key);
    setPendingKeys(new Set(inFlight.current));
  }

  async function run(key: string, action: TenantWebhooksRequest): Promise<SaveResult | null> {
    // Same row already busy (e.g. a second rotate): drop it rather than race
    // two answers — a late older rotate would reveal a secret that no longer works.
    if (inFlight.current.has(key)) return null;
    setRowPending(key, true);
    try {
      const result = await postWebhookAction(action);
      if (!result.ok) {
        toast.error(webhookErrorMessage(result));
        return null;
      }
      return result;
    } finally {
      setRowPending(key, false);
      refresh();
    }
  }

  async function setEnabled(destination: WebhookDestination, enabled: boolean) {
    const result = await run(destination.id, { action: "update", id: destination.id, enabled });
    if (result) {
      toast.success(
        enabled
          ? `${destination.name} is on — new events will be sent.`
          : `${destination.name} is off — nothing is sent until you turn it back on.`,
      );
    }
  }

  async function sendTest(destination: WebhookDestination) {
    const result = await run(destination.id, { action: "send_test", id: destination.id });
    if (!result) return;
    const body = (result.body ?? {}) as { ok?: unknown; status_code?: unknown; error?: unknown };
    if (body.ok === true) {
      toast.success(`Test delivered to ${destination.name}.`);
    } else {
      const reason =
        typeof body.error === "string"
          ? body.error
          : typeof body.status_code === "number"
            ? `HTTP ${body.status_code}`
            : "no answer";
      toast.error(`Test to ${destination.name} failed: ${reason}.`);
    }
  }

  async function confirmAction() {
    if (!confirm) return;
    const { kind, destination } = confirm;
    setConfirm(null);
    if (kind === "delete") {
      const result = await run(destination.id, { action: "delete", id: destination.id });
      if (result) toast.success(`${destination.name} deleted.`);
      return;
    }
    const result = await run(destination.id, { action: "rotate_secret", id: destination.id });
    const secret = result ? readString(result.body, "signing_secret") : null;
    if (result && secret) {
      setRevealed({ name: destination.name, secret });
      toast.success("New signing secret created.");
    } else if (result) {
      toast.error("The secret was changed but couldn't be shown — rotate again to see it.");
    }
  }

  async function retry(delivery: WebhookDeliveryLogRow) {
    const result = await run(delivery.id, { action: "retry", delivery_id: delivery.id });
    if (result) toast.success("Queued — Heyloo will try again within a minute.");
  }

  const destinationList = destinations.data ?? [];
  const atLimit = destinationList.length >= OUTBOUND_MAX_DESTINATIONS;
  const namesById = new Map(destinationList.map((d) => [d.id, d.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send bookings &amp; orders to any app</CardTitle>
        <CardDescription>
          Heyloo sends each new booking, order and message the moment it happens to Zapier, Make,
          n8n or any app that accepts webhooks. In Zapier, use the “Webhooks by Zapier” Catch Hook
          trigger — it&apos;s a premium Zapier app, so it needs a paid Zapier plan. In Make, use a
          Custom webhook; in n8n, a Webhook node&apos;s production URL.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {denial && (
          <Callout tone="info" role="note" data-testid="read-only-note">
            {READ_ONLY_TEXT[denial]}
          </Callout>
        )}

        {revealed && (
          <SecretReveal
            name={revealed.name}
            secret={revealed.secret}
            onDone={() => setRevealed(null)}
          />
        )}

        <section aria-labelledby="webhook-destinations-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="webhook-destinations-heading" className="text-sm font-medium">
              Destinations
            </h3>
            {canWrite && !adding && (
              <Button size="sm" onClick={() => setAdding(true)} disabled={atLimit}>
                Add destination
              </Button>
            )}
          </div>
          {canWrite && atLimit && (
            <p className="text-xs text-muted-foreground">
              You can have up to {OUTBOUND_MAX_DESTINATIONS} destinations — delete one to add
              another.
            </p>
          )}
          {adding && (
            <AddDestinationForm
              onCancel={() => setAdding(false)}
              onCreated={(name, secret) => {
                setAdding(false);
                refresh();
                if (secret) setRevealed({ name, secret });
              }}
            />
          )}
          <DataState
            query={destinations}
            empty={{
              title: "No destinations yet",
              description:
                "Add the webhook URL from Zapier, Make, n8n or your own app to start sending events.",
            }}
            loadingSkeleton={<div className="h-16 animate-pulse rounded-md bg-muted" />}
            render={(rows) => (
              <ul className="space-y-3">
                {rows.map((destination) => (
                  <DestinationItem
                    key={destination.id}
                    destination={destination}
                    canWrite={canWrite}
                    busy={pendingKeys.has(destination.id)}
                    onToggle={(enabled) => void setEnabled(destination, enabled)}
                    onTest={() => void sendTest(destination)}
                    onRotate={() => setConfirm({ kind: "rotate", destination })}
                    onDelete={() => setConfirm({ kind: "delete", destination })}
                  />
                ))}
              </ul>
            )}
          />
        </section>

        <section aria-labelledby="webhook-deliveries-heading" className="space-y-3">
          <h3 id="webhook-deliveries-heading" className="text-sm font-medium">
            Recent deliveries
          </h3>
          <DataState
            query={deliveries}
            empty={{
              title: "Nothing sent yet",
              description: "Each booking, order, message or test you send shows up here.",
            }}
            loadingSkeleton={<div className="h-24 animate-pulse rounded-md bg-muted" />}
            render={(rows) => (
              <Table scrollLabel="Recent webhook deliveries">
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Last error</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((delivery) => {
                    const meta = DELIVERY_STATUS_META[delivery.status] ?? {
                      label: delivery.status,
                      variant: "outline" as const,
                    };
                    const canRetry =
                      canWrite && (delivery.status === "failed" || delivery.status === "retrying");
                    return (
                      <TableRow key={delivery.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatWhen(delivery.created_at)}
                        </TableCell>
                        <TableCell>{eventLabel(delivery.event_type)}</TableCell>
                        <TableCell>
                          {namesById.get(delivery.destination_id) ?? "Removed destination"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell>{delivery.attempt_count}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {deliveryErrorText(delivery)}
                        </TableCell>
                        <TableCell>
                          {canRetry && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pendingKeys.has(delivery.id)}
                              onClick={() => void retry(delivery)}
                            >
                              Retry
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          />
        </section>
      </CardContent>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "delete"
                ? `Delete ${confirm.destination.name}?`
                : `Make a new signing secret for ${confirm?.destination.name ?? "this destination"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "delete"
                ? "Heyloo stops sending events to this URL right away, and its delivery history is removed."
                : "The old secret stops working right away. If your app checks signatures, paste the new secret into it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmAction()}>
              {confirm?.kind === "delete" ? "Delete" : "Make new secret"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function deliveryErrorText(delivery: WebhookDeliveryLogRow): string {
  if (delivery.status === "delivered") return "—";
  const error =
    delivery.last_error ??
    (delivery.last_status_code !== null ? `HTTP ${delivery.last_status_code}` : null);
  if (delivery.status === "retrying") {
    const next = `next try ${formatWhen(delivery.next_attempt_at)}`;
    return error ? `${error} · ${next}` : next;
  }
  return error ?? "—";
}

function DestinationItem({
  destination,
  canWrite,
  busy,
  onToggle,
  onTest,
  onRotate,
  onDelete,
}: {
  destination: WebhookDestination;
  canWrite: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const health = destinationHealth(destination);
  // Defensive: a malformed row (preview fixtures synthesize unknown tables) must not crash the card.
  const events = (Array.isArray(destination.event_types) ? destination.event_types : [])
    .map((t) => eventLabel(t))
    .join(", ");
  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{destination.name}</p>
          <p className="truncate text-xs text-muted-foreground" title={destination.url}>
            {hostOf(destination.url)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            {destination.enabled ? "On" : "Off"}
          </span>
          <Switch
            aria-label={`Send events to ${destination.name}`}
            checked={destination.enabled}
            disabled={!canWrite || busy}
            onCheckedChange={(checked) => onToggle(checked)}
          />
        </div>
      </div>
      <p className={`text-xs ${HEALTH_CLASS[health.tone]}`}>{health.text}</p>
      <p className="text-xs text-muted-foreground">Sends: {events}</p>
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onTest}>
            Send test
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRotate}>
            New signing secret
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

function AddDestinationForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (name: string, secret: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [types, setTypes] = useState<Set<OutboundEventType>>(() => new Set(OUTBOUND_EVENT_TYPES));
  const [errors, setErrors] = useState<{ name?: string; url?: string; types?: string }>({});
  const [saving, setSaving] = useState(false);

  function toggleType(type: OutboundEventType, checked: boolean) {
    setTypes((current) => {
      const next = new Set(current);
      if (checked) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Same schemas the route and the edge function apply (canonical contract).
    const parsedName = zOutboundDestinationName.safeParse(name);
    const parsedUrl = zOutboundDestinationUrl.safeParse(normalizeWebhookUrl(url));
    const nextErrors: typeof errors = {};
    if (!parsedName.success) {
      nextErrors.name = parsedName.error.issues[0]?.message ?? "Give this destination a name";
    }
    if (!parsedUrl.success) {
      nextErrors.url =
        parsedUrl.error.issues[0]?.message ?? "Enter a web address that starts with https://";
    }
    if (types.size === 0) nextErrors.types = "Pick at least one event to send.";
    setErrors(nextErrors);
    if (!parsedName.success || !parsedUrl.success || types.size === 0) return;
    const trimmedName = parsedName.data;
    const normalizedUrl = parsedUrl.data;

    setSaving(true);
    try {
      const result = await postWebhookAction({
        action: "create",
        name: trimmedName,
        url: normalizedUrl,
        event_types: OUTBOUND_EVENT_TYPES.filter((t) => types.has(t)),
      });
      if (!result.ok) {
        toast.error(webhookErrorMessage(result));
        return;
      }
      toast.success(`${trimmedName} added — use Send test to check it.`);
      onCreated(trimmedName, readString(result.body, "signing_secret"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="space-y-4 rounded-md border border-border p-4"
      noValidate
      aria-label="Add a webhook destination"
    >
      <div className="space-y-1.5">
        <Label htmlFor="webhook-name">Name</Label>
        <Input
          id="webhook-name"
          value={name}
          maxLength={80}
          placeholder="Zapier – new orders"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "webhook-name-error" : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {errors.name && (
          <p id="webhook-name-error" className="text-xs text-destructive" role="alert">
            {errors.name}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="webhook-url">Webhook URL</Label>
        <Input
          id="webhook-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={url}
          placeholder="https://hooks.zapier.com/hooks/catch/…"
          aria-invalid={errors.url ? true : undefined}
          aria-describedby={errors.url ? "webhook-url-error" : undefined}
          onChange={(e) => setUrl(e.target.value)}
        />
        {errors.url && (
          <p id="webhook-url-error" className="text-xs text-destructive" role="alert">
            {errors.url}
          </p>
        )}
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Send these events</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {EVENT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{group.title}</p>
              {group.types.map((type) => {
                const id = `webhook-event-${type.replace(".", "-")}`;
                return (
                  <div key={type} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={types.has(type)}
                      onCheckedChange={(checked) => toggleType(type, checked === true)}
                    />
                    <Label htmlFor={id} className="font-normal">
                      {OUTBOUND_EVENT_LABELS[type]}
                    </Label>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {errors.types && (
          <p className="text-xs text-destructive" role="alert">
            {errors.types}
          </p>
        )}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          Add destination
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SecretReveal({
  name,
  secret,
  onDone,
}: {
  name: string;
  secret: string;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function copySecret() {
    try {
      // Throws too when `navigator.clipboard` is missing (non-secure context).
      await navigator.clipboard.writeText(secret);
      toast.success("Secret copied");
    } catch {
      // Never claim a copy that didn't happen: the secret is shown only once.
      inputRef.current?.focus();
      inputRef.current?.select();
      toast.error("Couldn't copy — the secret is selected, copy it with Ctrl+C (⌘C on a Mac).");
    }
  }

  return (
    <Callout tone="warning" title={`Signing secret for ${name}`} role="status">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            readOnly
            value={secret}
            aria-label="Signing secret"
            className="font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Copy signing secret"
            onClick={() => void copySecret()}
          >
            <Copy className="size-4" />
          </Button>
        </div>
        <p className="text-xs">
          Copy it now — it won&apos;t be shown again. Your app can use it to check that each request
          really came from Heyloo (the Standard Webhooks <code>webhook-signature</code> header).
          Zapier, Make and n8n don&apos;t need it to receive events.
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Done, I&apos;ve saved it
        </Button>
      </div>
    </Callout>
  );
}
