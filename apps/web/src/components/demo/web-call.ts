/**
 * How the browser must join a Retell web call, beyond the access token.
 * `create-web-call` answers with the call's `transport` ("gateway"), its
 * `call_id` and the ICE servers to use, and the web SDK's gateway transport
 * needs the first two (docs/VERIFY.md SITE-3). The edge function forwards them
 * as `retell_web_call`; this file turns that untrusted JSON into the shape the
 * hook hands to the SDK. Hand-rolled (no zod) because it ships in the home
 * page's initial chunk.
 */
export interface DemoWebCall {
  callId?: string;
  transport?: "gateway" | "livekit";
  iceServers?: { urls: string | string[]; username?: string; credential?: string }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function parseIceServers(value: unknown): DemoWebCall["iceServers"] {
  if (!Array.isArray(value)) return undefined;
  const out: NonNullable<DemoWebCall["iceServers"]> = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) continue;
    const urls = entry["urls"];
    const validUrls =
      typeof urls === "string" || (Array.isArray(urls) && urls.every((u) => typeof u === "string"));
    if (!validUrls) continue;
    const server: NonNullable<DemoWebCall["iceServers"]>[number] = {
      urls: urls as string | string[],
    };
    if (typeof entry["username"] === "string") server.username = entry["username"];
    if (typeof entry["credential"] === "string") server.credential = entry["credential"];
    out.push(server);
  }
  return out.length > 0 ? out : undefined;
}

/** `undefined` when there is nothing usable: the SDK then joins with the token alone. */
export function parseWebCall(raw: unknown): DemoWebCall | undefined {
  if (!isRecord(raw)) return undefined;
  const call: DemoWebCall = {};
  if (typeof raw["call_id"] === "string" && raw["call_id"] !== "") call.callId = raw["call_id"];
  if (raw["transport"] === "gateway" || raw["transport"] === "livekit") {
    call.transport = raw["transport"];
  }
  const iceServers = parseIceServers(raw["ice_servers"]);
  if (iceServers) call.iceServers = iceServers;
  return Object.keys(call).length > 0 ? call : undefined;
}
