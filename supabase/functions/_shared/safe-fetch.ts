// SSRF-1: the one way an edge function fetches a URL that a user, a tenant, a
// scraped lead record or a provider payload supplied. Pure TypeScript (no Deno
// import; the DNS resolver and fetch are injectable) so it runs under Vitest.
//
// Guarantees, per hop (the first request AND every redirect target):
//   - scheme http/https only, no userinfo, explicit port only 80 or 443;
//   - IPv4/IPv6 literals (incl. decimal/octal/hex/short encodings, which the
//     WHATWG URL parser canonicalizes and which are re-checked here) must be
//     public; IPv4-mapped IPv6 and other transition forms are rejected;
//   - internal-looking hostnames (localhost, single-label, *.internal, *.local,
//     cloud metadata names) are rejected;
//   - the hostname is resolved (A + AAAA) and EVERY answer must be public;
//   - redirects are followed manually (max 3) and re-validated;
//   - the response Content-Type must match the caller's allowlist, the body is
//     capped (Content-Length pre-check + streamed cap), and one overall
//     deadline covers every hop and the body read.
//
// RESIDUAL RISKS (also in docs/BUILD_NOTES.md SSRF-1):
//   1. DNS rebinding: `fetch` resolves the name again after we validated it, so
//      an attacker-controlled authoritative server that answers a public IP to
//      us and a private one to the connect could slip through. Edge functions
//      cannot pin a resolved IP for an https request (SNI/cert), so this
//      window stays open. Mitigations: no credentials are ever attached to
//      user-supplied URLs (the callers below send none), the response is
//      never returned raw to the caller (text is stripped and summarized by an
//      LLM), and the Supabase edge network does not expose an internal
//      metadata service on link-local addresses.
//   2. When the runtime has no `Deno.resolveDns`, only literals and
//      known-internal names are blocked (all IP-literal hosts are rejected in
//      that mode); a public-looking name that resolves to a private address
//      is then NOT caught.

export type SafeFetchErrorCode =
  | "invalid_url"
  | "scheme_not_allowed"
  | "port_not_allowed"
  | "userinfo_not_allowed"
  | "ip_encoding_not_allowed"
  | "blocked_address"
  | "blocked_hostname"
  | "dns_failed"
  | "too_many_redirects"
  | "bad_redirect"
  | "content_type_not_allowed"
  | "response_too_large"
  | "timeout"
  | "network_error";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  constructor(code: SafeFetchErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

/** Resolves a hostname's `A` or `AAAA` records; returns [] when none exist. */
export type DnsResolver = (hostname: string, type: "A" | "AAAA") => Promise<string[]>;

export interface SafeFetchOptions {
  /** Allowed response media types: exact (`text/html`) or wildcard (`text/*`). */
  allowedContentTypes: readonly string[];
  /** Max response body bytes (default 5 MB). */
  maxBytes?: number;
  /** Overall deadline across every hop and the body read (default 10 s). */
  timeoutMs?: number;
  /** Max redirects followed (default 3). */
  maxRedirects?: number;
  /** DNS resolver; default `Deno.resolveDns` when the runtime has it, else none. */
  resolver?: DnsResolver | null;
  /** Injected for tests; default global `fetch`. */
  fetchImpl?: typeof fetch;
}

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_REDIRECTS = 3;

/** Content types for scraping a public web page. */
export const HTML_CONTENT_TYPES: readonly string[] = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
];

/** Content types for a JSON API (adapter/provider clients) incl. plain-text error pages. */
export const JSON_API_CONTENT_TYPES: readonly string[] = [
  "application/json",
  "application/problem+json",
  "application/x-www-form-urlencoded",
  "text/*",
];

/** Provider-hosted call recordings: audio/binary, up to 64 MB, 60 s. */
export const RECORDING_FETCH_OPTIONS: SafeFetchOptions = {
  allowedContentTypes: ["audio/*", "video/*", "application/octet-stream", "binary/octet-stream"],
  maxBytes: 64 * 1024 * 1024,
  timeoutMs: 60_000,
};

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

function parseIPv4Strict(s: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts: number[] = [];
  for (let i = 1; i <= 4; i += 1) {
    const raw = m[i] as string;
    // A leading zero is the octal spelling (`0177.0.0.1`): never canonical.
    if (raw.length > 1 && raw.startsWith("0")) return null;
    const n = Number(raw);
    if (n > 255) return null;
    parts.push(n);
  }
  return parts as [number, number, number, number];
}

/** True when the IPv4 address is NOT a public unicast address. */
function isBlockedIPv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 (unspecified, "this network")
  if (a === 10) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast 224/4, reserved 240/4, broadcast
  return false;
}

function parseIPv6(input: string): number[] | null {
  let s = input;
  if (s.includes("%") || s.length === 0) return null;
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4 = parseIPv4Strict(s.slice(lastColon + 1));
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${(
      (v4[2] << 8) | v4[3]
    ).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (p: string | undefined): string[] =>
    p === undefined || p === "" ? [] : p.split(":");
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<string>(fill).fill("0"), ...tail];
  }
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out.push(Number.parseInt(g, 16));
  }
  return out;
}

/**
 * IPv6 is an allow-list: only global unicast 2000::/3 is accepted, minus the
 * carve-outs below. That rejects ::, ::1, IPv4-mapped/compatible (::/8), NAT64
 * 64:ff9b::/96, ULA fc00::/7, link-local fe80::/10 and multicast ff00::/8 in
 * one rule.
 */
function isBlockedIPv6(g: number[]): boolean {
  const g0 = g[0] as number;
  const g1 = g[1] as number;
  if ((g0 & 0xe000) !== 0x2000) return true;
  if (g0 === 0x2001 && g1 < 0x0200) return true; // 2001::/23 (Teredo, ORCHID, IETF)
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2002) return true; // 6to4 (embeds an arbitrary IPv4)
  if (g0 === 0x3fff && g1 < 0x1000) return true; // documentation 3fff::/20
  return false;
}

/** True when `ip` (any textual IPv4/IPv6 form) is not a public unicast address. */
export function isBlockedIp(ip: string): boolean {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const v4 = parseIPv4Strict(bare);
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(bare);
  if (v6) return isBlockedIPv6(v6);
  return true; // not parseable as an address: never treat as public
}

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".corp",
  ".private",
];

function isInternalHostname(host: string): boolean {
  if (host === "localhost" || host === "metadata") return true;
  if (!host.includes(".")) return true; // single-label names are LAN/search-domain names
  return BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

// ---------------------------------------------------------------------------
// URL / host validation
// ---------------------------------------------------------------------------

function defaultResolver(): DnsResolver | null {
  const deno = (globalThis as { Deno?: { resolveDns?: unknown } }).Deno;
  if (!deno || typeof deno.resolveDns !== "function") return null;
  const resolveDns = deno.resolveDns as (h: string, t: "A" | "AAAA") => Promise<string[]>;
  return (hostname, type) => resolveDns.call(deno, hostname, type);
}

async function resolveAll(host: string, resolver: DnsResolver): Promise<string[]> {
  const answers: string[] = [];
  let anyOk = false;
  let lastError: unknown;
  for (const type of ["A", "AAAA"] as const) {
    try {
      answers.push(...(await resolver(host, type)));
      anyOk = true;
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      // "No record of this type" is a normal answer (an A-only host), not a failure.
      if (name === "NotFound") anyOk = true;
      else lastError = err;
    }
  }
  if (!anyOk) throw new SafeFetchError("dns_failed", String((lastError as Error)?.message ?? ""));
  return answers;
}

/**
 * Validates one hop's URL (scheme, userinfo, port, host literal/name, DNS).
 * Returns the parsed URL. Throws `SafeFetchError`.
 */
export async function assertPublicUrl(
  input: string | URL,
  resolver: DnsResolver | null = defaultResolver(),
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("scheme_not_allowed", url.protocol);
  }
  if (url.username !== "" || url.password !== "") throw new SafeFetchError("userinfo_not_allowed");
  // `URL.port` is "" for the scheme's default port; anything else must be 80/443.
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    throw new SafeFetchError("port_not_allowed", url.port);
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "") throw new SafeFetchError("invalid_url");

  // IPv6 literal (URL.hostname keeps the brackets).
  if (hostname.startsWith("[")) {
    if (isBlockedIp(hostname)) throw new SafeFetchError("blocked_address", "ipv6 literal");
    if (!resolver) throw new SafeFetchError("blocked_address", "ip literal without dns");
    return url;
  }

  const trimmed = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;

  // IPv4 literal. The URL parser already canonicalized decimal/octal/hex/short
  // spellings (`2130706433`, `0177.0.0.1`, `0x7f.1`) to dotted-quad.
  const v4 = parseIPv4Strict(trimmed);
  if (v4) {
    if (isBlockedIPv4(v4)) throw new SafeFetchError("blocked_address", "ipv4 literal");
    if (!resolver) throw new SafeFetchError("blocked_address", "ip literal without dns");
    return url;
  }
  // WHATWG: a host whose last label is numeric/0x-hex is an IPv4 spelling. If it
  // survived canonicalization it is an encoding we do not understand: reject.
  const lastLabel = trimmed.slice(trimmed.lastIndexOf(".") + 1);
  if (/^(0x[0-9a-f]*|\d+)$/i.test(lastLabel)) {
    throw new SafeFetchError("ip_encoding_not_allowed", trimmed);
  }

  if (isInternalHostname(trimmed)) throw new SafeFetchError("blocked_hostname", trimmed);

  if (resolver) {
    const answers = await resolveAll(trimmed, resolver);
    if (answers.length === 0) throw new SafeFetchError("dns_failed", "no address records");
    for (const ip of answers) {
      if (isBlockedIp(ip)) throw new SafeFetchError("blocked_address", "resolved to non-public");
    }
  }
  return url;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function mediaType(header: string | null): string {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function contentTypeAllowed(type: string, allowed: readonly string[]): boolean {
  return allowed.some((a) => {
    const rule = a.toLowerCase();
    return rule.endsWith("/*") ? type.startsWith(rule.slice(0, -1)) : type === rule;
  });
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new SafeFetchError("response_too_large", `content-length ${declared}`);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SafeFetchError("response_too_large", `> ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Fetches a URL supplied by an untrusted party. Returns a buffered `Response`
 * (final hop's status/headers, body already capped and type-checked); its
 * `.url` is not set. Throws `SafeFetchError` on any policy violation.
 */
export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  opts: SafeFetchOptions,
): Promise<Response> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolver = opts.resolver === undefined ? defaultResolver() : opts.resolver;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;
  const onUpstreamAbort = () => controller.abort();
  upstreamSignal?.addEventListener("abort", onUpstreamAbort);

  try {
    // `body`/`headers`/`method`/`redirect`/`signal` are managed per hop below.
    const {
      body: initBody,
      headers: initHeaders,
      method: initMethod,
      signal: _s,
      redirect: _r,
      ...passthrough
    } = init;
    let method = (initMethod ?? "GET").toUpperCase();
    let body = initBody;
    let headers = new Headers(initHeaders);
    let current = await assertPublicUrl(input, resolver);

    for (let hop = 0; ; hop += 1) {
      let res: Response;
      try {
        res = await fetchImpl(current.toString(), {
          ...passthrough,
          method,
          headers,
          ...(body !== undefined && body !== null ? { body } : {}),
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) throw new SafeFetchError("timeout");
        throw new SafeFetchError("network_error", (err as Error)?.message);
      }

      if (REDIRECT_STATUSES.has(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        const location = res.headers.get("location");
        if (!location) throw new SafeFetchError("bad_redirect", "missing location");
        if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects");
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new SafeFetchError("bad_redirect", "unparseable location");
        }
        next = await assertPublicUrl(next, resolver);
        if (next.origin !== current.origin) {
          // Never forward credentials to another origin.
          headers = new Headers(headers);
          headers.delete("authorization");
          headers.delete("cookie");
          headers.delete("proxy-authorization");
        }
        if (
          res.status === 303 ||
          ((res.status === 301 || res.status === 302) && method === "POST")
        ) {
          method = "GET";
          body = undefined;
          headers = new Headers(headers);
          headers.delete("content-type");
          headers.delete("content-length");
        }
        current = next;
        continue;
      }

      if (NULL_BODY_STATUSES.has(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        return new Response(null, { status: res.status, headers: res.headers });
      }

      const type = mediaType(res.headers.get("content-type"));
      const emptyBody = res.headers.get("content-length") === "0";
      if (!(emptyBody && type === "") && !contentTypeAllowed(type, opts.allowedContentTypes)) {
        await res.body?.cancel().catch(() => undefined);
        throw new SafeFetchError("content_type_not_allowed", type || "(none)");
      }

      let bytes: Uint8Array;
      try {
        bytes = await readCapped(res, maxBytes);
      } catch (err) {
        if (err instanceof SafeFetchError) throw err;
        if (controller.signal.aborted) throw new SafeFetchError("timeout");
        throw new SafeFetchError("network_error", (err as Error)?.message);
      }
      const outHeaders = new Headers(res.headers);
      outHeaders.delete("content-encoding"); // already decoded by fetch
      outHeaders.delete("content-length");
      return new Response(bytes.slice().buffer, {
        status: res.status,
        statusText: res.statusText,
        headers: outHeaders,
      });
    }
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", onUpstreamAbort);
  }
}

/** `safeFetch` shaped like `fetch`, for injection into provider clients. */
export function makeSafeFetch(opts: SafeFetchOptions): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : input;
    return safeFetch(target, init ?? {}, opts);
  }) as typeof fetch;
}

export interface SafeFetchTextResult {
  ok: boolean;
  status: number;
  text: string;
}

/** Fetches a public web page as text (HTML/plain by default). Throws `SafeFetchError`. */
export async function safeFetchText(
  url: string,
  opts: Partial<SafeFetchOptions> & { headers?: Record<string, string> } = {},
): Promise<SafeFetchTextResult> {
  const { headers, ...rest } = opts;
  const res = await safeFetch(url, headers ? { headers } : {}, {
    allowedContentTypes: HTML_CONTENT_TYPES,
    ...rest,
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/** Fetches a public binary asset. Throws `SafeFetchError`. */
export async function safeFetchBytes(
  url: string,
  opts: SafeFetchOptions,
): Promise<{ ok: boolean; status: number; bytes: ArrayBuffer }> {
  const res = await safeFetch(url, {}, opts);
  return { ok: res.ok, status: res.status, bytes: await res.arrayBuffer() };
}
