"use client";

import { Button, Label, Switch } from "@heyloo/ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

export type MarginPeriodChoice = "mtd" | "last_month" | "quarter";

const PERIOD_LABELS: Record<MarginPeriodChoice, string> = {
  mtd: "This month",
  last_month: "Last month",
  quarter: "Quarter",
};

const STORAGE_KEY = "heyloo.cockpit.margin-controls";

interface MarginControlsState {
  period: MarginPeriodChoice;
  includeTest: boolean;
}

const DEFAULT_STATE: MarginControlsState = { period: "mtd", includeTest: false };

function isPeriod(value: unknown): value is MarginPeriodChoice {
  return value === "mtd" || value === "last_month" || value === "quarter";
}

/** Reads the saved choice: the URL (`?period=&include_test=1`, so a link or reload keeps it) wins over this tab's sessionStorage. Never throws. */
function readInitialState(): MarginControlsState {
  const state = { ...DEFAULT_STATE };
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null") as {
      period?: unknown;
      includeTest?: unknown;
    } | null;
    if (stored && isPeriod(stored.period)) state.period = stored.period;
    if (stored && typeof stored.includeTest === "boolean") state.includeTest = stored.includeTest;
  } catch {
    // storage blocked or corrupt: fall through to the defaults
  }
  const params = new URLSearchParams(window.location.search);
  const urlPeriod = params.get("period");
  if (isPeriod(urlPeriod)) state.period = urlPeriod;
  if (params.has("include_test")) state.includeTest = params.get("include_test") === "1";
  return state;
}

/** Mirrors the choice into sessionStorage and the address bar (replaceState: no history entry, no re-render of the route). */
function persistState(state: MarginControlsState): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore: persistence is a convenience
  }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("period", state.period);
    if (state.includeTest) url.searchParams.set("include_test", "1");
    else url.searchParams.delete("include_test");
    window.history.replaceState(window.history.state, "", url);
  } catch {
    // ignore
  }
}

interface MarginControlsContextValue extends MarginControlsState {
  setPeriod: (period: MarginPeriodChoice) => void;
  setIncludeTest: (includeTest: boolean) => void;
}

/**
 * A tiny external store (read with `useSyncExternalStore`) rather than
 * `useState` + a mount effect: the server snapshot is always the defaults, so
 * SSR and hydration agree, and the client snapshot (URL / sessionStorage) is
 * picked up right after hydration without a set-state-in-effect.
 */
interface MarginStore {
  getSnapshot: () => MarginControlsState;
  getServerSnapshot: () => MarginControlsState;
  subscribe: (listener: () => void) => () => void;
  update: (patch: Partial<MarginControlsState>) => void;
}

function createMarginStore(): MarginStore {
  let current: MarginControlsState | null = null;
  const listeners = new Set<() => void>();
  const read = (): MarginControlsState => {
    if (current === null) current = readInitialState();
    return current;
  };
  return {
    getSnapshot: read,
    getServerSnapshot: () => DEFAULT_STATE,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(patch) {
      current = { ...read(), ...patch };
      persistState(current);
      for (const listener of listeners) listener();
    },
  };
}

function useMarginStoreState(store: MarginStore): MarginControlsContextValue {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return useMemo(
    () => ({
      ...state,
      setPeriod: (period: MarginPeriodChoice) => store.update({ period }),
      setIncludeTest: (includeTest: boolean) => store.update({ includeTest }),
    }),
    [state, store],
  );
}

const MarginStoreContext = createContext<MarginStore | null>(null);

/**
 * COCKPIT-F20/F13: the period and "include test data" choice used to live in
 * each page's own `useState`, so it reset on every navigation between margin
 * pages. Mounted once by `cockpit/margin/layout.tsx` — a layout stays mounted
 * across its child routes — so the choice follows the admin from Waterfall to
 * Per-customer to a customer's drill-down (which used to disagree with the list
 * about test data), and survives a reload via the URL / sessionStorage.
 */
export function MarginControlsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createMarginStore);
  return <MarginStoreContext.Provider value={store}>{children}</MarginStoreContext.Provider>;
}

/**
 * Shared period + "include test data" state for the margin cockpit pages
 * (COCKPIT-1). Real margins exclude test tenants and test calls by default —
 * the toggle lets an admin see them (e.g. to verify cost capture on the
 * owner's own test calls) without ever mixing them into the real numbers.
 * `qs` is a ready-to-append query string for `admin-cockpit/*` routes.
 * Outside a `MarginControlsProvider` (a test, a stray page) it falls back to
 * page-local state.
 */
export function useMarginControls(opts: { withPeriod?: boolean; withTestToggle?: boolean } = {}) {
  const sharedStore = useContext(MarginStoreContext);
  const [localStore] = useState(createMarginStore);
  const { period, includeTest, setPeriod, setIncludeTest } = useMarginStoreState(
    sharedStore ?? localStore,
  );

  const params = new URLSearchParams();
  if (opts.withPeriod) params.set("period", period);
  if (includeTest && opts.withTestToggle !== false) params.set("include_test", "1");
  const qs = params.toString();

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      {opts.withPeriod && (
        <div className="flex gap-2">
          {(Object.keys(PERIOD_LABELS) as MarginPeriodChoice[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "outline"}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </Button>
          ))}
        </div>
      )}
      {opts.withTestToggle !== false && (
        <div className="flex items-center gap-2">
          <Switch
            id="include-test-data"
            checked={includeTest}
            onCheckedChange={setIncludeTest}
            aria-label="Include test data"
          />
          <Label htmlFor="include-test-data" className="text-small text-muted-foreground">
            Include test data
          </Label>
        </div>
      )}
    </div>
  );

  return { period, includeTest, qs: qs ? `?${qs}` : "", controls };
}
