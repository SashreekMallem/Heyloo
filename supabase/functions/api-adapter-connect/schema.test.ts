import { describe, expect, it } from "vitest";
import { AdapterConnectRequestSchema } from "./schema.ts";

describe("AdapterConnectRequestSchema ezyvet base_url (SSRF-1)", () => {
  const parse = (base_url: string) =>
    AdapterConnectRequestSchema.safeParse({ action: "paste_key", provider: "ezyvet", base_url });

  it("accepts an https URL", () => {
    expect(parse("https://clinic.ezyvet.com/api/v1").success).toBe(true);
  });

  it.each(["http://clinic.ezyvet.com/api/v1", "ftp://x.example.com", "file:///etc/passwd", "nope"])(
    "rejects %s",
    (url) => {
      expect(parse(url).success).toBe(false);
    },
  );
});
