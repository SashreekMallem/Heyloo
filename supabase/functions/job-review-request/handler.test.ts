import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.js";
import { sendOneReviewRequest } from "./handler.js";

describe("sendOneReviewRequest", () => {
  it("inserts a review_request message and enqueues it", async () => {
    const calls: unknown[][] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push([strings.join(" "), ...values]);
      return Promise.resolve([{ id: "msg_1" }]);
    }) as SqlClient;
    const sent = await sendOneReviewRequest(sql, {
      booking_id: "b1",
      tenant_id: "t1",
      customer_id: "c1",
      customer_phone: "+15551234567",
      review_url: "https://g.page/r/example/review",
    });
    expect(sent).toBe(true);
    expect(
      calls.some((c) => (c[0] as string).includes("insert into public.messages_outbound")),
    ).toBe(true);
    expect(calls.some((c) => (c[0] as string).includes("pgmq.send"))).toBe(true);
  });

  it("returns false when the insert yields no row", async () => {
    const sql = (() => Promise.resolve([])) as SqlClient;
    const sent = await sendOneReviewRequest(sql, {
      booking_id: "b1",
      tenant_id: "t1",
      customer_id: "c1",
      customer_phone: "+15551234567",
      review_url: "https://g.page/r/example/review",
    });
    expect(sent).toBe(false);
  });
});
