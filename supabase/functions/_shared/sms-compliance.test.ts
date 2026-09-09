import { describe, expect, it } from "vitest";
import { classifyInboundSms } from "./sms-compliance.ts";

describe("classifyInboundSms", () => {
  it.each(["STOP", "stop", "  Stop  ", "STOPALL", "UNSUBSCRIBE", "Cancel", "End", "Quit"])(
    "classifies %s as stop",
    (body) => {
      expect(classifyInboundSms(body)).toBe("stop");
    },
  );

  it.each(["START", "start", "YES", "UnStop"])("classifies %s as start", (body) => {
    expect(classifyInboundSms(body)).toBe("start");
  });

  it.each(["HELP", "help", "Info"])("classifies %s as help", (body) => {
    expect(classifyInboundSms(body)).toBe("help");
  });

  it("classifies everything else as other, including messages that merely contain a keyword", () => {
    expect(classifyInboundSms("please stop calling me at night")).toBe("other");
    expect(classifyInboundSms("what time do you open tomorrow?")).toBe("other");
  });

  it("treats null/undefined/empty as other", () => {
    expect(classifyInboundSms(null)).toBe("other");
    expect(classifyInboundSms(undefined)).toBe("other");
    expect(classifyInboundSms("")).toBe("other");
  });
});
