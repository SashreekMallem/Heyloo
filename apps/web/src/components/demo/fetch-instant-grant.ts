import { type DemoCallGrant, DemoCallGrantError } from "./use-demo-call";

/**
 * Asks our own `POST /api/demo/instant` for a web-call token (the Retell
 * secret never reaches the browser). A 429 becomes the "rate-limited" state;
 * any other failure, including a body that is not the documented shape,
 * becomes "unavailable" (the visitor is pointed at the phone and `/demo`).
 */
export async function fetchInstantDemoGrant(): Promise<DemoCallGrant> {
  let res: Response;
  try {
    res = await fetch("/api/demo/instant", { method: "POST" });
  } catch {
    throw new DemoCallGrantError("unavailable");
  }
  if (res.status === 429) throw new DemoCallGrantError("rate-limited");
  if (!res.ok) throw new DemoCallGrantError("unavailable");

  const body: unknown = await res.json().catch(() => null);
  if (typeof body !== "object" || body === null) throw new DemoCallGrantError("unavailable");
  const token = (body as Record<string, unknown>)["retell_call_token"];
  const maxCallMs = (body as Record<string, unknown>)["max_call_ms"];
  const phone = (body as Record<string, unknown>)["demo_phone_e164"];
  if (typeof token !== "string" || token === "") throw new DemoCallGrantError("unavailable");
  return {
    token,
    ...(typeof maxCallMs === "number" ? { maxCallMs } : {}),
    ...(typeof phone === "string" ? { demoPhone: phone } : {}),
  };
}
