import { beforeAll, describe, expect, it } from "vitest";
import { decodeOAuthState, encodeOAuthState, generatePkcePair, generateState } from "./shared";

beforeAll(() => {
  process.env["AIRTABLE_OAUTH_STATE_SECRET"] = "test-secret-do-not-use-in-prod";
});

describe("airtable oauth state cookie", () => {
  it("round-trips tenantId/state/verifier through sign+verify", () => {
    const value = { tenantId: "t1", state: generateState(), verifier: generatePkcePair().verifier };
    const encoded = encodeOAuthState(value);
    expect(decodeOAuthState(encoded)).toEqual(value);
  });

  it("rejects a tampered payload", () => {
    const encoded = encodeOAuthState({ tenantId: "t1", state: "s", verifier: "v" });
    const [payload] = encoded.split(".");
    const tampered = `${Buffer.from(JSON.stringify({ tenantId: "attacker", state: "s", verifier: "v" })).toString("base64url")}.${encoded.split(".")[1]}`;
    void payload;
    expect(decodeOAuthState(tampered)).toBeNull();
  });

  it("returns null for missing/malformed cookie values", () => {
    expect(decodeOAuthState(undefined)).toBeNull();
    expect(decodeOAuthState("not-a-valid-cookie")).toBeNull();
  });
});

describe("generatePkcePair", () => {
  it("derives the S256 challenge from the verifier deterministically", async () => {
    const { verifier, challenge } = generatePkcePair();
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    expect(challenge).toBe(expected);
  });
});
