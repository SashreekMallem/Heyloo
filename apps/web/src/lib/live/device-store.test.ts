import { afterEach, describe, expect, it, vi } from "vitest";
import { readAcks, readPref, writeAcks, writePref } from "./device-store";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("live screen device store (LIVE-1)", () => {
  it("defaults to sound on and auto-print off, and remembers changes", () => {
    expect(readPref("sound")).toBe(true);
    expect(readPref("autoPrint")).toBe(false);
    writePref("autoPrint", true);
    writePref("sound", false);
    expect(readPref("autoPrint")).toBe(true);
    expect(readPref("sound")).toBe(false);
  });

  it("keeps acknowledgements per tenant and drops ones older than 48 hours", () => {
    const now = Date.now();
    writeAcks("t1", { "booking:a": now - 1_000, "message:b": now - 49 * 3_600_000 });
    expect(readAcks("t1", now)).toEqual({ "booking:a": now - 1_000 });
    expect(readAcks("t2", now)).toEqual({});
  });

  it("ignores corrupt stored acknowledgements", () => {
    window.localStorage.setItem("heyloo.live.t1.acks", "{not json");
    expect(readAcks("t1")).toEqual({});
    window.localStorage.setItem("heyloo.live.t1.acks", JSON.stringify(["a"]));
    expect(readAcks("t1")).toEqual({});
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writePref("sound", false)).not.toThrow();
    expect(readPref("sound")).toBe(true);
    expect(() => writeAcks("t1", { a: 1 })).not.toThrow();
    expect(readAcks("t1")).toEqual({});
  });
});
