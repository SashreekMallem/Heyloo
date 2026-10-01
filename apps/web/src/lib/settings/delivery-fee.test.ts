import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeDeliveryFeeCents, type DeliveryFeePolicy, formatDollars } from "./delivery-fee";

// Vitest runs with the app (apps/web) as cwd.
const DENO_FILE = resolve(process.cwd(), "../../supabase/functions/_shared/delivery-fee.ts");

const CASES: Array<[DeliveryFeePolicy, number | null]> = [
  [{ baseCents: 300, perMileCents: 100, includedMiles: 2 }, 6],
  [{ baseCents: 300, perMileCents: 100, includedMiles: 2 }, 1.2],
  [{ baseCents: 300, perMileCents: 100, includedMiles: 2 }, 2.01],
  [{ baseCents: 300, perMileCents: 100, includedMiles: 2 }, null],
  [{ baseCents: 0, perMileCents: 250, includedMiles: 0 }, 1.2],
  [{ baseCents: 0, perMileCents: 75, includedMiles: 0 }, 1.01],
  [{ baseCents: 0, perMileCents: 10, includedMiles: 0.1 }, 0.3],
  [{ baseCents: null, perMileCents: null, includedMiles: null }, 9],
  [{ baseCents: 499, perMileCents: null, includedMiles: 1 }, 30],
  [{ baseCents: 199, perMileCents: 149, includedMiles: 3.5 }, 17.37],
  [{ baseCents: -100, perMileCents: -5, includedMiles: -3 }, 4],
];

describe("computeDeliveryFeeCents (portal copy, DELIVERY-1)", () => {
  it("base + ceil(per_mile * max(0, miles - included)), in integer cents", () => {
    expect(
      computeDeliveryFeeCents({ baseCents: 300, perMileCents: 100, includedMiles: 2 }, 6),
    ).toBe(700);
    expect(
      computeDeliveryFeeCents({ baseCents: 0, perMileCents: 250, includedMiles: 0 }, 1.2),
    ).toBe(300);
    expect(
      computeDeliveryFeeCents({ baseCents: 300, perMileCents: 100, includedMiles: 2 }, null),
    ).toBe(300);
    expect(formatDollars(500)).toBe("$5.00");
  });

  it("matches the voice agent's formula (supabase/functions/_shared/delivery-fee.ts) on every case", async () => {
    const deno = (await import(/* @vite-ignore */ DENO_FILE)) as {
      computeDeliveryFeeCents: typeof computeDeliveryFeeCents;
    };
    for (const [policy, miles] of CASES) {
      expect(computeDeliveryFeeCents(policy, miles), JSON.stringify([policy, miles])).toBe(
        deno.computeDeliveryFeeCents(policy, miles),
      );
    }
  });

  it("the function bodies are the same text (drift guard)", () => {
    const body = (src: string) => {
      const start = src.indexOf("export function computeDeliveryFeeCents");
      const end = src.indexOf("\n}\n", start);
      return src
        .slice(start, end)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("//"))
        .join("\n");
    };
    const web = readFileSync(resolve(process.cwd(), "src/lib/settings/delivery-fee.ts"), "utf8");
    expect(body(web)).toBe(body(readFileSync(DENO_FILE, "utf8")));
  });
});
