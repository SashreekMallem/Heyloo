import type { DemoVerticalId } from "./demo-verticals";
import { type DemoCallGrant, DemoCallGrantError } from "./use-demo-call";
import { parseWebCall } from "./web-call";

/**
 * Asks our own `POST /api/demo/instant` for a web-call token for the picked
 * business type (the Retell secret never reaches the browser). A 429 becomes
 * the "rate-limited" state; a 503 `demo_unavailable` means that business type
 * has no live agent right now ("business-unavailable", the visitor is told to
 * pick another); any other failure, including a body that is not the documented
 * shape, becomes "unavailable" (the visitor is pointed at the phone and `/demo`).
 */
export async function fetchInstantDemoGrant(vertical: DemoVerticalId): Promise<DemoCallGrant> {
  let res: Response;
  try {
    res = await fetch("/api/demo/instant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vertical }),
    });
  } catch {
    throw new DemoCallGrantError("unavailable");
  }
  if (res.status === 429) throw new DemoCallGrantError("rate-limited");
  if (res.status === 503) {
    const failure: unknown = await res.json().catch(() => null);
    const isDemoUnavailable =
      typeof failure === "object" &&
      failure !== null &&
      (failure as Record<string, unknown>)["error"] === "demo_unavailable";
    throw new DemoCallGrantError(isDemoUnavailable ? "business-unavailable" : "unavailable");
  }
  if (!res.ok) throw new DemoCallGrantError("unavailable");

  const body: unknown = await res.json().catch(() => null);
  if (typeof body !== "object" || body === null) throw new DemoCallGrantError("unavailable");
  const token = (body as Record<string, unknown>)["retell_call_token"];
  const maxCallMs = (body as Record<string, unknown>)["max_call_ms"];
  const phone = (body as Record<string, unknown>)["demo_phone_e164"];
  const webCall = parseWebCall((body as Record<string, unknown>)["retell_web_call"]);
  if (typeof token !== "string" || token === "") throw new DemoCallGrantError("unavailable");
  return {
    token,
    ...(typeof maxCallMs === "number" ? { maxCallMs } : {}),
    ...(typeof phone === "string" ? { demoPhone: phone } : {}),
    ...(webCall ? { webCall } : {}),
  };
}
