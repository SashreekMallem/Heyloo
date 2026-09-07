import { describe, expect, it } from "vitest";
import { signOAuthState, verifyOAuthState } from "./state.js";

const SECRET = "state-secret";

describe("signOAuthState / verifyOAuthState", () => {
  it("round-trips a signed state and recovers the exact payload", async () => {
    const state = await signOAuthState(SECRET, {
      tenantId: "t1",
      provider: "square",
      nonce: "abc",
    });
    const result = await verifyOAuthState(SECRET, state);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.tenantId).toBe("t1");
      expect(result.payload.provider).toBe("square");
      expect(result.payload.nonce).toBe("abc");
    }
  });

  it("rejects a tampered state (fail closed)", async () => {
    const state = await signOAuthState(SECRET, {
      tenantId: "t1",
      provider: "square",
      nonce: "abc",
    });
    const lastChar = state.slice(-1);
    const flipped = lastChar === "0" ? "1" : "0";
    const tampered = `${state.slice(0, -1)}${flipped}`;
    const result = await verifyOAuthState(SECRET, tampered);
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a state signed with a different secret", async () => {
    const state = await signOAuthState(SECRET, {
      tenantId: "t1",
      provider: "square",
      nonce: "abc",
    });
    const result = await verifyOAuthState("wrong-secret", state);
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a malformed state string", async () => {
    const result = await verifyOAuthState(SECRET, "not-a-valid-state");
    expect(result).toEqual({ valid: false, reason: "malformed" });
  });

  it("rejects a state older than the 15-minute window (replay protection)", async () => {
    const state = await signOAuthState(SECRET, {
      tenantId: "t1",
      provider: "square",
      nonce: "abc",
    });
    const farFuture = () => Date.now() + 20 * 60 * 1000;
    const result = await verifyOAuthState(SECRET, state, farFuture);
    expect(result).toEqual({ valid: false, reason: "expired" });
  });
});
