"use client";

import { Button, Label, Switch } from "@heyloo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { tenantQueryKey, useTenantQuery } from "@/lib/hooks/use-tenant-query";
import { ChimeScheduler, createAudioContext, isAlerting, playChime } from "@/lib/live/chime";
import { readAcks, readPref, writeAcks, writePref } from "@/lib/live/device-store";
import { formatTimeInZone, shortOrderNumber } from "@/lib/live/format";
import {
  type Acks,
  ackKey,
  createdWithin,
  diffNewIds,
  EMPTY_SEEN,
  isBookingNew,
  isMessageNew,
  pendingAlerts,
  type SeenIds,
} from "@/lib/live/new-items";
import { withOrderRestored, withOrderStatus } from "@/lib/live/order-status";
import { enqueuePrint } from "@/lib/live/print";
import {
  fetchLiveBookings,
  fetchLiveMessages,
  fetchLiveOrders,
  LIVE_WINDOW_MS,
} from "@/lib/live/queries";
import { buildTicketHtml } from "@/lib/live/ticket";
import type {
  LiveBooking,
  LiveMessage,
  LiveOrder,
  LiveOrdersResult,
  OrderStatus,
} from "@/lib/live/types";
import { useWakeLock } from "@/lib/live/use-wake-lock";
import {
  type RealtimeConnectionStatus,
  useTenantRealtimeStatus,
} from "@/lib/realtime/tenant-realtime-provider";
import { BookingsFeed } from "./bookings-feed";
import { MessagesFeed } from "./messages-feed";
import { OrdersBoard } from "./orders-board";
import { StartOverlay } from "./start-overlay";

/** Polling fallback: realtime broadcasts can drop, and the provider gives up after 4 retries. */
export const LIVE_REFETCH_MS = 15_000;
const CLOCK_TICK_MS = 15_000;

type Kind = "orders" | "bookings" | "messages";

interface Arrivals {
  orders: ReadonlySet<string>;
  bookings: ReadonlySet<string>;
  messages: ReadonlySet<string>;
  /** Bumps on every arrival so the chime replays at once for a second item. */
  seq: number;
}

const NO_ARRIVALS: Arrivals = {
  orders: new Set(),
  bookings: new Set(),
  messages: new Set(),
  seq: 0,
};

const ARRIVAL_TEXT: Record<Kind, (n: number) => string> = {
  orders: (n) => (n === 1 ? "New order" : `${n} new orders`),
  bookings: (n) => (n === 1 ? "New booking" : `${n} new bookings`),
  messages: (n) => (n === 1 ? "New message" : `${n} new messages`),
};

const REALTIME_TEXT: Record<RealtimeConnectionStatus, { label: string; dot: string }> = {
  connected: { label: "Live", dot: "bg-success" },
  connecting: { label: "Connecting…", dot: "bg-warning animate-pulse" },
  reconnecting: { label: "Reconnecting…", dot: "bg-warning animate-pulse" },
  offline: { label: "Checking every 15 s", dot: "bg-destructive" },
};

function sectionState(query: { isPending: boolean; isError: boolean; data: unknown }) {
  if (query.isPending) return "loading" as const;
  if (query.isError && query.data === undefined) return "error" as const;
  return "ready" as const;
}

function ignoreRejection(run: () => Promise<unknown> | undefined): void {
  try {
    void Promise.resolve(run()).catch(() => undefined);
  } catch {
    // The API is missing in this browser.
  }
}

export function LiveScreen({
  tenantId,
  businessName,
  vertical,
  timeZone,
}: {
  tenantId: string;
  businessName: string;
  vertical: string;
  timeZone: string;
}) {
  const queryClient = useQueryClient();
  const realtime = useTenantRealtimeStatus();
  const [started, setStarted] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [autoPrint, setAutoPrint] = useState(false);
  const [acks, setAcks] = useState<Record<string, number>>({});
  const [audioState, setAudioState] = useState<string>("unknown");
  const [arrivals, setArrivals] = useState<Arrivals>(NO_ARRIVALS);
  const [announcement, setAnnouncement] = useState("");
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const wake = useWakeLock(started);

  const audioRef = useRef<AudioContext | null>(null);
  const seenRef = useRef<Record<Kind, SeenIds>>({
    orders: EMPTY_SEEN,
    bookings: EMPTY_SEEN,
    messages: EMPTY_SEEN,
  });

  /**
   * Diffs a fresh load against everything seen so far (the first load is the
   * silent baseline). `isArrival` drops unseen rows that are not actually
   * new (they are still remembered as seen, so they never count later).
   */
  const track = useCallback(
    <T extends { id: string }>(
      kind: Kind,
      rows: readonly T[],
      isArrival: (row: T) => boolean = () => true,
    ) => {
      const { seen, fresh } = diffNewIds(
        seenRef.current[kind],
        rows.map((r) => r.id),
      );
      seenRef.current[kind] = seen;
      if (fresh.length === 0) return;
      const freshIds = new Set(fresh);
      const arrived = rows.filter((r) => freshIds.has(r.id) && isArrival(r)).map((r) => r.id);
      if (arrived.length === 0) return;
      setArrivals((prev) => ({
        ...prev,
        [kind]: new Set([...prev[kind], ...arrived]),
        seq: prev.seq + 1,
      }));
      setAnnouncement(ARRIVAL_TEXT[kind](arrived.length));
    },
    [],
  );

  /**
   * Status changes still in flight. A poll or realtime refetch that lands
   * before the PATCH finishes keeps showing the optimistic status instead
   * of flicking the card back.
   */
  const pendingStatusRef = useRef(new Map<string, OrderStatus>());

  const pollOptions = { refetchInterval: LIVE_REFETCH_MS, refetchIntervalInBackground: true };
  const ordersKey = tenantQueryKey(tenantId, "orders", "live");
  const ordersQuery = useTenantQuery(
    tenantId,
    "orders",
    ["live"],
    async () => {
      const result = await fetchLiveOrders(tenantId);
      track("orders", result.orders);
      let orders = result.orders;
      for (const [id, status] of pendingStatusRef.current) {
        orders = withOrderStatus(orders, id, status);
      }
      return { ...result, orders };
    },
    pollOptions,
  );
  const bookingsQuery = useTenantQuery(
    tenantId,
    "bookings",
    ["live", timeZone],
    async () => {
      const bookings = await fetchLiveBookings(tenantId, timeZone);
      // Only a booking made in the live window is an arrival: at tenant
      // midnight the "today" window moves on and pulls in bookings made
      // days ago, which must not ring.
      const fetchedAt = Date.now();
      track("bookings", bookings, (b) => createdWithin(b.createdAt, fetchedAt, LIVE_WINDOW_MS));
      return bookings;
    },
    pollOptions,
  );
  const messagesQuery = useTenantQuery(
    tenantId,
    "call_logs",
    ["live"],
    async () => {
      const messages = await fetchLiveMessages(tenantId);
      track("messages", messages);
      return messages;
    },
    pollOptions,
  );

  const orders = ordersQuery.data?.orders ?? [];
  const bookings = bookingsQuery.data ?? [];
  const messages = messagesQuery.data ?? [];
  const isRestaurant = vertical === "restaurant";
  const showOrders = isRestaurant || (ordersQuery.data?.hasRecentOrders ?? false);

  /** What still needs attention, by the same rules the "New" badges use. */
  const pendingAt = (ackState: Acks, nowMs: number) =>
    pendingAlerts({
      orders,
      bookings,
      messages,
      arrivedBookings: arrivals.bookings,
      arrivedMessages: arrivals.messages,
      acks: ackState,
      nowMs,
      windowMs: LIVE_WINDOW_MS,
    });
  // Before Start there is no clock yet, and nothing rings anyway.
  const pending = pendingAt(acks, now?.getTime() ?? 0);
  const alerting = isAlerting({ started, soundOn, ...pending });

  // Chime: rings at once when the screen starts with orders waiting or when
  // something arrives, then every 10 s until it's handled.
  const schedulerRef = useRef<ChimeScheduler | null>(null);
  const lastSeqRef = useRef(0);
  useEffect(() => {
    schedulerRef.current ??= new ChimeScheduler(() => {
      if (audioRef.current) playChime(audioRef.current);
    });
    const arrived = arrivals.seq !== lastSeqRef.current;
    lastSeqRef.current = arrivals.seq;
    schedulerRef.current.update(alerting, arrived);
  }, [alerting, arrivals.seq]);

  useEffect(
    () => () => {
      schedulerRef.current?.stop();
      const ctx = audioRef.current;
      audioRef.current = null;
      if (ctx) void ctx.close().catch(() => undefined);
    },
    [],
  );

  // Clock + "4 min ago" ages.
  useEffect(() => {
    if (!started) return;
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [started]);

  // Mobile browsers can suspend audio while the tab is in the background.
  useEffect(() => {
    if (!started) return;
    const onVisibility = () => {
      const ctx = audioRef.current;
      if (document.visibilityState === "visible" && ctx && ctx.state !== "running") {
        void ctx.resume().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [started]);

  const printOrder = useCallback(
    async (order: LiveOrder) => {
      const outcome = await enqueuePrint(buildTicketHtml(order, { businessName, timeZone }));
      if (outcome === "blocked") {
        toast.error(
          `Couldn't print ${shortOrderNumber(order.id)}. Allow pop-ups for this site, then try again.`,
        );
      }
    },
    [businessName, timeZone],
  );

  // Auto-print each new order once, as soon as its row has loaded.
  const autoPrintHandledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const loaded = ordersQuery.data?.orders;
    if (!loaded) return;
    for (const id of arrivals.orders) {
      if (autoPrintHandledRef.current.has(id)) continue;
      const order = loaded.find((o) => o.id === id);
      if (!order) continue;
      autoPrintHandledRef.current.add(id);
      if (started && autoPrint) void printOrder(order);
    }
  }, [arrivals.orders, ordersQuery.data, started, autoPrint, printOrder]);

  async function advanceOrder(order: LiveOrder, next: OrderStatus) {
    const number = shortOrderNumber(order.id);
    setBusyIds((prev) => new Set([...prev, order.id]));
    pendingStatusRef.current.set(order.id, next);
    await queryClient.cancelQueries({ queryKey: ordersKey });
    queryClient.setQueryData<LiveOrdersResult>(ordersKey, (old) =>
      old ? { ...old, orders: withOrderStatus(old.orders, order.id, next) } : old,
    );
    let failed = false;
    try {
      const res = await fetch(`/api/tenant/orders/${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json().catch(() => null);
      const smsQueued =
        !!body &&
        typeof body === "object" &&
        (body as { sms_queued?: unknown }).sms_queued === true;
      if (next === "ready" && smsQueued)
        toast.success(`${number} is ready. We texted the customer.`);
    } catch {
      failed = true;
    }
    pendingStatusRef.current.delete(order.id);
    if (failed) {
      // Undo only this order: other cards may have changed meanwhile.
      queryClient.setQueryData<LiveOrdersResult>(ordersKey, (old) =>
        old ? { ...old, orders: withOrderRestored(old.orders, order) } : old,
      );
      toast.error(`Couldn't update ${number}. Please try again.`);
    }
    setBusyIds((prev) => {
      const rest = new Set(prev);
      rest.delete(order.id);
      return rest;
    });
    void queryClient.invalidateQueries({ queryKey: ordersKey });
  }

  function acknowledge(keys: string[]) {
    if (keys.length === 0) return;
    const at = Date.now();
    const next = { ...acks };
    for (const key of keys) next[key] = at;
    setAcks(next);
    writeAcks(tenantId, next);
  }

  function start() {
    const ctx = audioRef.current ?? createAudioContext();
    audioRef.current = ctx;
    const sound = readPref("sound");
    const storedAcks = readAcks(tenantId);
    if (ctx) {
      ctx.addEventListener("statechange", () => setAudioState(ctx.state));
      void ctx
        .resume()
        .then(() => setAudioState(ctx.state))
        .catch(() => setAudioState(ctx.state));
      // A sound check on start, unless the alert chime is about to ring anyway.
      const atStart = pendingAt(storedAcks, Date.now());
      const willAlert = isAlerting({ started: true, soundOn: sound, ...atStart });
      if (sound && !willAlert) playChime(ctx, 0.3);
    } else {
      setAudioState("unavailable");
    }
    wake.request();
    ignoreRejection(() => document.documentElement.requestFullscreen?.());
    setSoundOn(sound);
    setAutoPrint(readPref("autoPrint"));
    setAcks(storedAcks);
    setNow(new Date());
    setStarted(true);
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    writePref("sound", next);
    const ctx = audioRef.current;
    if (next && ctx) {
      void ctx.resume().catch(() => undefined);
      // The alert itself rings right away when something is pending; a
      // sound check on top of it would play two chimes at once.
      if (!isAlerting({ started, soundOn: true, ...pending })) playChime(ctx, 0.3);
    }
  }

  function resumeAudio() {
    const ctx = audioRef.current;
    if (ctx) {
      void ctx
        .resume()
        .then(() => setAudioState(ctx.state))
        .catch(() => undefined);
    }
  }

  function toggleAutoPrint(next: boolean) {
    setAutoPrint(next);
    writePref("autoPrint", next);
  }

  function exitFullscreen() {
    if (document.fullscreenElement) ignoreRejection(() => document.exitFullscreen?.());
  }

  if (!started || !now) {
    return <StartOverlay businessName={businessName} onStart={start} />;
  }

  const nowMs = now.getTime();
  const bookingIsNew = (b: LiveBooking) => isBookingNew(b, acks, nowMs, LIVE_WINDOW_MS);
  const messageIsNew = (m: LiveMessage) => isMessageNew(m, acks);
  const realtimeText = REALTIME_TEXT[realtime];

  const ordersPanel = showOrders ? (
    <OrdersBoard
      orders={orders}
      now={now}
      busyIds={busyIds}
      state={sectionState(ordersQuery)}
      onAdvance={(order, next) => void advanceOrder(order, next)}
      onPrint={(order) => void printOrder(order)}
    />
  ) : null;
  const bookingsPanel = (
    <BookingsFeed
      bookings={bookings}
      isNew={bookingIsNew}
      now={now}
      timeZone={timeZone}
      state={sectionState(bookingsQuery)}
      onAcknowledge={(b) => acknowledge([ackKey.booking(b.id)])}
      onAcknowledgeAll={() =>
        acknowledge(bookings.filter(bookingIsNew).map((b) => ackKey.booking(b.id)))
      }
    />
  );
  const messagesPanel = (
    <MessagesFeed
      messages={messages}
      isNew={messageIsNew}
      now={now}
      state={sectionState(messagesQuery)}
      onAcknowledge={(m) => acknowledge([ackKey.message(m.id)])}
      onAcknowledgeAll={() =>
        acknowledge(messages.filter(messageIsNew).map((m) => ackKey.message(m.id)))
      }
    />
  );

  return (
    <div className="flex min-h-svh flex-col bg-muted/30 text-foreground">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background px-4 py-2">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <h1 className="truncate font-display text-lg font-semibold">{businessName}</h1>
          <p className="text-xs text-muted-foreground">Live screen</p>
        </div>
        <p className="font-display text-2xl font-semibold tabular-nums">
          <span className="sr-only">Time </span>
          {formatTimeInZone(now, timeZone)}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${realtimeText.dot}`} />
          {realtimeText.label}
        </p>
        <Button
          type="button"
          variant={soundOn ? "secondary" : "outline"}
          aria-pressed={soundOn}
          onClick={toggleSound}
        >
          {soundOn ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          Sound
        </Button>
        {showOrders && (
          <div className="flex items-center gap-2">
            <Switch id="live-auto-print" checked={autoPrint} onCheckedChange={toggleAutoPrint} />
            <Label htmlFor="live-auto-print">Auto-print new orders</Label>
          </div>
        )}
        <Button asChild variant="ghost">
          <Link href="/dashboard" onClick={exitFullscreen}>
            <LogOut aria-hidden="true" />
            Exit
          </Link>
        </Button>
      </header>

      <div className="space-y-1 px-4 pt-2 text-sm text-muted-foreground empty:hidden">
        {showOrders && autoPrint && (
          <p>
            Auto-print is on. For printing without a dialog, run Chrome with --kiosk-printing on the
            counter computer.
          </p>
        )}
        {(wake.state === "unsupported" || wake.state === "unavailable") && (
          <p>
            This browser can&apos;t keep the screen on. Set your device&apos;s auto-lock to Never.
          </p>
        )}
        {audioState === "unavailable" && <p>This browser can&apos;t play the alert sound.</p>}
      </div>
      {soundOn && (audioState === "suspended" || audioState === "interrupted") && (
        <div className="px-4 pt-2">
          <Button type="button" variant="destructive" className="w-full" onClick={resumeAudio}>
            Sound is paused by the browser. Tap to turn it back on.
          </Button>
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <main className="flex-1 p-4">
        {isRestaurant ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            {ordersPanel}
            <div className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
              {bookingsPanel}
              {messagesPanel}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {bookingsPanel}
              {messagesPanel}
            </div>
            {ordersPanel}
          </div>
        )}
      </main>
    </div>
  );
}
