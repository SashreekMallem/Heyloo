import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHIME_REPEAT_MS, ChimeScheduler, isAlerting, playChime } from "./chime";

describe("isAlerting (LIVE-1)", () => {
  const base = { started: true, soundOn: true, waitingOrders: 0, unacknowledgedArrivals: 0 };

  it("rings for any order still waiting, or an unacknowledged booking / message", () => {
    expect(isAlerting({ ...base, waitingOrders: 1 })).toBe(true);
    expect(isAlerting({ ...base, unacknowledgedArrivals: 2 })).toBe(true);
  });

  it("is silent with nothing pending, with sound off, or before the screen is started", () => {
    expect(isAlerting(base)).toBe(false);
    expect(isAlerting({ ...base, waitingOrders: 1, soundOn: false })).toBe(false);
    expect(isAlerting({ ...base, waitingOrders: 1, started: false })).toBe(false);
  });
});

describe("ChimeScheduler (LIVE-1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plays at once, then every 10 s while alerting", () => {
    const play = vi.fn();
    const scheduler = new ChimeScheduler(play);
    scheduler.update(true, true);
    expect(play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CHIME_REPEAT_MS - 1);
    expect(play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(play).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(CHIME_REPEAT_MS * 3);
    expect(play).toHaveBeenCalledTimes(5);
    scheduler.stop();
  });

  it("stops repeating once nothing needs attention", () => {
    const play = vi.fn();
    const scheduler = new ChimeScheduler(play);
    scheduler.update(true);
    scheduler.update(false);
    expect(scheduler.running).toBe(false);
    vi.advanceTimersByTime(CHIME_REPEAT_MS * 5);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("does not restart the cycle on a re-render that brings no new arrival", () => {
    const play = vi.fn();
    const scheduler = new ChimeScheduler(play);
    scheduler.update(true, true);
    vi.advanceTimersByTime(4_000);
    scheduler.update(true, false);
    scheduler.update(true, false);
    expect(play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6_000);
    expect(play).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("replays immediately for a second arrival and restarts the 10 s cycle", () => {
    const play = vi.fn();
    const scheduler = new ChimeScheduler(play);
    scheduler.update(true, true);
    vi.advanceTimersByTime(7_000);
    scheduler.update(true, true);
    expect(play).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3_000);
    expect(play).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(7_000);
    expect(play).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it("an arrival while not alerting (e.g. sound off) plays nothing", () => {
    const play = vi.fn();
    const scheduler = new ChimeScheduler(play);
    scheduler.update(false, true);
    vi.advanceTimersByTime(CHIME_REPEAT_MS * 2);
    expect(play).not.toHaveBeenCalled();
  });

  it("honors a custom interval", () => {
    const play = vi.fn();
    const scheduler = new ChimeScheduler(play, 1_000);
    scheduler.update(true);
    vi.advanceTimersByTime(3_000);
    expect(play).toHaveBeenCalledTimes(4);
    scheduler.stop();
  });
});

describe("playChime (LIVE-1)", () => {
  it("schedules two oscillator tones on the context, with no audio file", () => {
    const param = () => ({
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    });
    const oscillators: { frequency: ReturnType<typeof param>; start: unknown; stop: unknown }[] =
      [];
    const ctx = {
      state: "running",
      currentTime: 1,
      destination: {},
      resume: vi.fn(async () => undefined),
      createOscillator: vi.fn(() => {
        const gainNode = { connect: vi.fn() };
        const osc = {
          type: "",
          frequency: param(),
          connect: vi.fn(() => gainNode),
          start: vi.fn(),
          stop: vi.fn(),
        };
        oscillators.push(osc);
        return osc;
      }),
      createGain: vi.fn(() => ({ gain: param(), connect: vi.fn() })),
    };
    playChime(ctx as unknown as AudioContext);
    expect(oscillators).toHaveLength(2);
    expect(oscillators[0]?.frequency.setValueAtTime).toHaveBeenCalledWith(880, expect.any(Number));
    expect(oscillators[1]?.frequency.setValueAtTime).toHaveBeenCalledWith(
      1318.5,
      expect.any(Number),
    );
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it("tries to resume a suspended context before playing", () => {
    const ctx = {
      state: "suspended",
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => undefined),
      createOscillator: vi.fn(() => ({
        type: "",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(() => ({ connect: vi.fn() })),
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      })),
    };
    playChime(ctx as unknown as AudioContext);
    expect(ctx.resume).toHaveBeenCalled();
  });
});
