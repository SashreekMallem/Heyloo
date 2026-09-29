import { CARRIERS } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { CARRIER_CODES, dialableNumber } from "./carrier-codes";

const render = (carrier: (typeof CARRIERS)[number], mode: "conditional" | "full") =>
  CARRIER_CODES[carrier][mode].map((c) => c.code.replace("{number}", "6105383920"));

describe("carrier forwarding codes (QA-1 F-2)", () => {
  it("AT&T uses the GSM conditional codes, not Verizon's *71/*73", () => {
    expect(render("att", "conditional")).toEqual(["*004*6105383920*11#", "##004#"]);
  });

  it("Verizon keeps *71 / *73 and uses *72 for all calls", () => {
    expect(render("verizon", "conditional")).toEqual(["*716105383920", "*73"]);
    expect(render("verizon", "full")).toEqual(["*726105383920", "*73"]);
  });

  it("T-Mobile uses **004* with a # terminator", () => {
    expect(render("tmobile", "conditional")).toEqual(["**004*6105383920#", "##004#"]);
  });

  it("AT&T and Verizon no longer share codes", () => {
    expect(render("att", "conditional")).not.toEqual(render("verizon", "conditional"));
  });

  it("never embeds a '+' in any code and gives every carrier a cancel code", () => {
    for (const carrier of CARRIERS) {
      for (const mode of ["conditional", "full"] as const) {
        const codes = CARRIER_CODES[carrier][mode];
        expect(codes.some((c) => /cancel/i.test(c.label))).toBe(true);
        expect(codes.some((c) => c.code.includes("+"))).toBe(false);
      }
    }
  });

  it("dialableNumber strips +1 to 10 digits and leaves other countries alone", () => {
    expect(dialableNumber("+16105383920")).toBe("6105383920");
    expect(dialableNumber("+442079460958")).toBe("+442079460958");
  });
});
