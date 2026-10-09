import { describe, expect, it } from "vitest";
import { AdapterConnectRequestSchema } from "./schema.ts";

describe("AdapterConnectRequestSchema ezyvet base_url (SSRF-1, CONNECT-SAFE-1)", () => {
  const parse = (base_url: string) =>
    AdapterConnectRequestSchema.safeParse({ action: "paste_key", provider: "ezyvet", base_url });

  it.each(["https://api.ezyvet.com/v1", "https://api.trial.ezyvet.com/v1"])(
    "accepts ezyVet's documented API host %s",
    (url) => {
      expect(parse(url).success).toBe(true);
    },
  );

  it.each([
    "http://clinic.ezyvet.com/api/v1",
    "ftp://x.example.com",
    "file:///etc/passwd",
    "nope",
    // CONNECT-SAFE-1: a public https host that is not ezyVet's would have
    // received our partner client secret.
    "https://evil.example.com",
    "https://clinic.ezyvet.com.evil.example/api/v1",
    // Only the two documented API hosts, not any ezyvet.com subdomain.
    "https://clinic.ezyvet.com/api/v1",
    "https://status.ezyvet.com",
  ])("rejects %s", (url) => {
    expect(parse(url).success).toBe(false);
  });
});
