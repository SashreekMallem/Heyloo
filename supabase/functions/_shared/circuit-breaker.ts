import type { Clock } from "./types.js";
import { systemClock } from "./types.js";

/**
 * Per-tool rolling-window circuit breaker for `/voice-tools`
 * (BACKEND_SPEC §7.2, SYSTEM_DESIGN §5): "above threshold (~20%/min) new
 * calls short-circuit to message-taking mode until reset". In-process,
 * per-warm-instance state (BACKEND_SPEC's `DECIDE:` recommendation) — no
 * synchronous shared-counter read on the hot path. Stats are still emitted
 * async (see tool-stats.ts) to feed the cockpit bottleneck view + alerts.
 *
 * One instance is held at module scope per warm Edge Function instance (see
 * voice-tools/index.ts) so state survives across invocations on that
 * instance without any per-request construction cost.
 */

interface Event {
  ts: number;
  ok: boolean;
}

interface ToolState {
  events: Event[];
  openUntil: number | null;
}

export interface CircuitBreakerOptions {
  /** Rolling window length, ms. Default 60s ("~20%/min"). */
  windowMs?: number;
  /** Error-rate fraction (0-1) above which the circuit opens. Default 0.2. */
  errorRateThreshold?: number;
  /** Minimum samples in-window before the error rate is trusted (avoids
   * opening the circuit on e.g. 1 failure out of 1 call). Default 5. */
  minSamples?: number;
  /** How long the circuit stays open before a half-open retry. Default 30s. */
  cooldownMs?: number;
  clock?: Clock;
}

const DEFAULTS: Required<CircuitBreakerOptions> = {
  windowMs: 60_000,
  errorRateThreshold: 0.2,
  minSamples: 5,
  cooldownMs: 30_000,
  clock: systemClock,
};

export interface ToolStats {
  count: number;
  errors: number;
  errorRate: number;
  open: boolean;
}

export class ToolCircuitBreaker {
  private readonly opts: Required<CircuitBreakerOptions>;
  private readonly tools = new Map<string, ToolState>();

  constructor(opts: CircuitBreakerOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  private stateFor(tool: string): ToolState {
    let s = this.tools.get(tool);
    if (!s) {
      s = { events: [], openUntil: null };
      this.tools.set(tool, s);
    }
    return s;
  }

  private prune(state: ToolState, now: number): void {
    const cutoff = now - this.opts.windowMs;
    while (state.events.length > 0 && (state.events[0]?.ts ?? Number.POSITIVE_INFINITY) < cutoff) {
      state.events.shift();
    }
  }

  /** True if new calls to this tool should short-circuit to the graceful
   * fallback instead of executing. Also resolves an expired cooldown into a
   * half-open trial (does not itself count as success/failure). */
  isOpen(tool: string): boolean {
    const now = this.opts.clock().getTime();
    const state = this.stateFor(tool);
    if (state.openUntil !== null) {
      if (now < state.openUntil) return true;
      // Cooldown elapsed: half-open — clear history, allow one trial window.
      state.openUntil = null;
      state.events = [];
    }
    return false;
  }

  recordSuccess(tool: string): void {
    this.record(tool, true);
  }

  recordFailure(tool: string): void {
    this.record(tool, false);
  }

  private record(tool: string, ok: boolean): void {
    const now = this.opts.clock().getTime();
    const state = this.stateFor(tool);
    this.prune(state, now);
    state.events.push({ ts: now, ok });

    if (state.events.length >= this.opts.minSamples) {
      const errors = state.events.filter((e) => !e.ok).length;
      const rate = errors / state.events.length;
      if (rate > this.opts.errorRateThreshold) {
        state.openUntil = now + this.opts.cooldownMs;
      }
    }
  }

  getStats(tool: string): ToolStats {
    const now = this.opts.clock().getTime();
    const state = this.stateFor(tool);
    this.prune(state, now);
    const errors = state.events.filter((e) => !e.ok).length;
    const count = state.events.length;
    return {
      count,
      errors,
      errorRate: count === 0 ? 0 : errors / count,
      open: state.openUntil !== null && now < state.openUntil,
    };
  }
}
