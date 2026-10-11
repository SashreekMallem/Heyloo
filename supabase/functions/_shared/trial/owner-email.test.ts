import { describe, expect, it } from "vitest";
import { createLogger } from "../logger.ts";
import type { SqlClient } from "../types.ts";
import { enqueueTrialOwnerEmail } from "./owner-email.ts";

const logger = createLogger();

function makeSql(handler: (text: string) => unknown[] | Error) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    const result = handler(text);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  }) as SqlClient;
  return { sql, calls };
}

const INPUT = {
  tenantId: "t1",
  template: "trial_will_end" as const,
  payload: { ends_on: "Monday, October 12" },
};

describe("enqueueTrialOwnerEmail", () => {
  it("queues one email to the owner's sign-in address and pushes it onto the messages queue", async () => {
    const { sql, calls } = makeSql((text) =>
      text.includes("insert into public.messages_outbound") ? [{ id: "msg_1" }] : [],
    );
    expect(await enqueueTrialOwnerEmail(sql, logger, INPUT)).toBe("msg_1");
    const insert = calls[0] as { text: string; values: unknown[] };
    expect(insert.text).toContain("'email', u.email");
    expect(insert.text).toContain("m.role = 'owner'");
    // once per tenant + template, ever
    expect(insert.text).toContain("not exists");
    expect(insert.text).toContain("mo.template_key =");
    // ...and a concurrent second insert is a no-op (partial unique index)
    expect(insert.text).toContain("on conflict (tenant_id, template_key)");
    expect(insert.text).toContain("do nothing");
    expect(insert.values).toEqual([
      "t1",
      "trial_will_end",
      INPUT.payload,
      "t1",
      "t1",
      "trial_will_end",
    ]);
    expect(calls[1]?.text).toContain("pgmq.send");
    expect(calls[1]?.values).toEqual(["messages_outbound_queue", { message_id: "msg_1" }]);
  });

  it("returns null and queues nothing when it was already sent (or the owner has no email)", async () => {
    const { sql, calls } = makeSql(() => []);
    expect(await enqueueTrialOwnerEmail(sql, logger, INPUT)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("keeps the row when the queue push fails (the stranded-row sweep sends it)", async () => {
    const { sql } = makeSql((text) =>
      text.includes("pgmq.send") ? new Error("pgmq down") : [{ id: "msg_1" }],
    );
    expect(await enqueueTrialOwnerEmail(sql, logger, INPUT)).toBe("msg_1");
  });
});
