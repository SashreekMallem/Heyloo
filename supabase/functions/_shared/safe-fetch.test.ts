import { describe, expect, it, vi } from "vitest";
import {
  type DnsResolver,
  HTML_CONTENT_TYPES,
  isBlockedIp,
  makeSafeFetch,
  SafeFetchError,
  type SafeFetchErrorCode,
  safeFetch,
  safeFetchBytes,
  safeFetchText,
} from "./safe-fetch.ts";

const PUBLIC_IP = "93.184.216.34";

/** Resolver answering `map[host]` (A for v4, AAAA for v6); unknown host = NotFound. */
function resolverFor(map: Record<string, string[]>): DnsResolver {
  return async (host, type) => {
    const answers = map[host];
    if (!answers) {
      const err = new Error("not found");
      err.name = "NotFound";
      throw err;
    }
    return answers.filter((a) => (type === "AAAA") === a.includes(":"));
  };
}

const publicResolver = resolverFor({
  "example.com": [PUBLIC_IP],
  "www.example.com": [PUBLIC_IP],
  "menu.example.org": [PUBLIC_IP, "2606:2800:220:1:248:1893:25c8:1946"],
  "evil.example.net": ["10.0.0.5"],
  "mixed.example.net": [PUBLIC_IP, "169.254.169.254"],
  "v6evil.example.net": ["fd00::1"],
});

function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

async function codeOf(p: Promise<unknown>): Promise<SafeFetchErrorCode | "resolved"> {
  try {
    await p;
    return "resolved";
  } catch (err) {
    if (err instanceof SafeFetchError) return err.code;
    throw err;
  }
}

/** A fetch mock returning the queued responses in order (the last one repeats). */
function mockFetch(...responses: Array<Response | (() => Response)>) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.length > 1 ? responses.shift() : responses[0];
    if (!next) throw new Error("no mock response");
    return typeof next === "function" ? next() : next;
  });
  return { fn, impl: fn as unknown as typeof fetch };
}

function opts(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return { allowedContentTypes: HTML_CONTENT_TYPES, resolver: publicResolver, fetchImpl, ...extra };
}

describe("isBlockedIp", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "192.0.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "[::1]",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:8.8.8.8",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "2001:db8::1",
    "2001::1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "100.63.255.255",
    "100.128.0.1",
    "172.15.0.1",
    "172.32.0.1",
    "2606:2800:220:1:248:1893:25c8:1946",
    "2a00:1450:4001:81b::200e",
  ])("allows %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("safeFetch URL policy (network never reached)", () => {
  const blocked: Array<[string, string, SafeFetchErrorCode]> = [
    ["file scheme", "file:///etc/passwd", "scheme_not_allowed"],
    ["ftp scheme", "ftp://example.com/x", "scheme_not_allowed"],
    ["gopher scheme", "gopher://example.com/", "scheme_not_allowed"],
    ["data scheme", "data:text/html,hi", "scheme_not_allowed"],
    ["userinfo", "https://user:pw@example.com/", "userinfo_not_allowed"],
    ["username only", "https://admin@example.com/", "userinfo_not_allowed"],
    ["userinfo host confusion", "http://example.com@127.0.0.1/", "userinfo_not_allowed"],
    ["port 22", "https://example.com:22/", "port_not_allowed"],
    ["port 8080", "http://example.com:8080/", "port_not_allowed"],
    ["port 5432", "https://example.com:5432/", "port_not_allowed"],
    ["loopback", "http://127.0.0.1/", "blocked_address"],
    ["loopback other", "http://127.1.2.3/admin", "blocked_address"],
    ["metadata", "http://169.254.169.254/latest/meta-data/", "blocked_address"],
    ["rfc1918 10/8", "http://10.0.0.1/", "blocked_address"],
    ["rfc1918 172.16", "http://172.16.5.5/", "blocked_address"],
    ["rfc1918 192.168", "http://192.168.0.1/", "blocked_address"],
    ["cgnat", "http://100.64.1.1/", "blocked_address"],
    ["multicast", "http://224.0.0.1/", "blocked_address"],
    ["unspecified", "http://0.0.0.0/", "blocked_address"],
    ["ipv6 loopback", "http://[::1]/", "blocked_address"],
    ["ipv6 unspecified", "http://[::]/", "blocked_address"],
    ["ipv6 ula", "http://[fd00::1]/", "blocked_address"],
    ["ipv6 link-local", "http://[fe80::1]/", "blocked_address"],
    ["ipv6 multicast", "http://[ff02::1]/", "blocked_address"],
    ["ipv4-mapped loopback", "http://[::ffff:127.0.0.1]/", "blocked_address"],
    ["ipv4-mapped metadata hex", "http://[::ffff:a9fe:a9fe]/", "blocked_address"],
    ["ipv4-mapped public", "http://[::ffff:8.8.8.8]/", "blocked_address"],
    ["decimal ip", "http://2130706433/", "blocked_address"],
    ["decimal metadata", "http://2852039166/", "blocked_address"],
    ["octal ip", "http://0177.0.0.1/", "blocked_address"],
    ["octal full", "http://017700000001/", "blocked_address"],
    ["hex ip", "http://0x7f000001/", "blocked_address"],
    ["hex dotted", "http://0x7f.0x0.0x0.0x1/", "blocked_address"],
    ["short form", "http://127.1/", "blocked_address"],
    ["localhost", "http://localhost/", "blocked_hostname"],
    ["localhost trailing dot", "http://localhost./", "blocked_hostname"],
    ["sub.localhost", "http://app.localhost/", "blocked_hostname"],
    ["metadata.google.internal", "http://metadata.google.internal/", "blocked_hostname"],
    ["single label", "http://intranet/", "blocked_hostname"],
    ["double trailing dot", "http://localhost../", "invalid_url"],
    ["double trailing dot ip", "http://127.0.0.1../", "invalid_url"],
    ["empty middle label", "http://example..com/", "invalid_url"],
    ["internal double dot", "http://svc.internal../", "invalid_url"],
    ["wildcard dns (nip.io)", "http://127.0.0.1.nip.io/", "blocked_hostname"],
    ["wildcard dns (localtest.me)", "http://localtest.me/", "blocked_hostname"],
    ["fullwidth digits", "http://\uff11\uff12\uff17.0.0.1/", "blocked_address"],
    ["percent-encoded ip", "http://%31%32%37.0.0.1/", "blocked_address"],
    ["ideographic dots", "http://127\u30020\u30020\u30021/", "blocked_address"],
    [".local", "http://printer.local/", "blocked_hostname"],
    ["resolves private", "https://evil.example.net/", "blocked_address"],
    ["resolves mixed", "https://mixed.example.net/", "blocked_address"],
    ["resolves private v6", "https://v6evil.example.net/", "blocked_address"],
    ["nxdomain", "https://nx.example.invalid/", "dns_failed"],
    ["garbage", "not a url", "invalid_url"],
  ];

  it.each(blocked)("%s -> %s", async (_name, url, expected) => {
    const { fn, impl } = mockFetch(html("x"));
    expect(await codeOf(safeFetch(url, {}, opts(impl)))).toBe(expected);
    expect(fn).not.toHaveBeenCalled();
  });

  it("without a DNS resolver rejects every IP literal, even public ones", async () => {
    const { fn, impl } = mockFetch(html("x"));
    const noDns = { allowedContentTypes: HTML_CONTENT_TYPES, resolver: null, fetchImpl: impl };
    expect(await codeOf(safeFetch("http://8.8.8.8/", {}, noDns))).toBe("blocked_address");
    expect(await codeOf(safeFetch("http://[2606:2800:220:1::1]/", {}, noDns))).toBe(
      "blocked_address",
    );
    expect(await codeOf(safeFetch("http://localhost/", {}, noDns))).toBe("blocked_hostname");
    expect(fn).not.toHaveBeenCalled();
  });

  it("fails closed when only ONE of the A/AAAA lookups errors", async () => {
    const { fn, impl } = mockFetch(html("x"));
    const halfBroken: DnsResolver = async (_h, type) => {
      if (type === "AAAA") throw new Error("servfail");
      return [PUBLIC_IP];
    };
    expect(
      await codeOf(safeFetch("https://example.com/", {}, opts(impl, { resolver: halfBroken }))),
    ).toBe("dns_failed");
    expect(fn).not.toHaveBeenCalled();
  });

  it("the overall timeout covers a resolver that never answers", async () => {
    const { fn, impl } = mockFetch(html("x"));
    const hang: DnsResolver = () => new Promise<string[]>(() => undefined);
    expect(
      await codeOf(
        safeFetch("https://example.com/", {}, opts(impl, { resolver: hang, timeoutMs: 20 })),
      ),
    ).toBe("timeout");
    expect(fn).not.toHaveBeenCalled();
  });

  it("fails closed when the resolver errors (not NotFound)", async () => {
    const { impl } = mockFetch(html("x"));
    const broken: DnsResolver = async () => {
      throw new Error("resolver exploded");
    };
    expect(
      await codeOf(safeFetch("https://example.com/", {}, opts(impl, { resolver: broken }))),
    ).toBe("dns_failed");
  });
});

describe("safeFetch allowed requests", () => {
  it("fetches a public URL (mocked) and returns a buffered response", async () => {
    const { fn, impl } = mockFetch(html("<p>hello</p>"));
    const res = await safeFetch("https://example.com/menu", {}, opts(impl));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<p>hello</p>");
    expect(fn.mock.calls[0]?.[0]).toBe("https://example.com/menu");
    expect(fn.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("allows explicit ports 80 and 443 and a public IP literal when DNS is available", async () => {
    const { fn, impl } = mockFetch(() => html("ok"));
    await safeFetch("http://example.com:80/", {}, opts(impl));
    await safeFetch("http://example.com:443/", {}, opts(impl));
    await safeFetch("https://8.8.8.8/", {}, opts(impl));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("safeFetchText returns ok/status/text and forwards headers", async () => {
    const { fn, impl } = mockFetch(html("<b>menu</b>"));
    const out = await safeFetchText("https://example.com/", {
      resolver: publicResolver,
      fetchImpl: impl,
      headers: { "user-agent": "t" },
    });
    expect(out).toEqual({ ok: true, status: 200, text: "<b>menu</b>" });
    expect(new Headers(fn.mock.calls[0]?.[1]?.headers).get("user-agent")).toBe("t");
  });

  it("makeSafeFetch behaves like fetch and enforces the policy", async () => {
    const { impl } = mockFetch(html("x"));
    const f = makeSafeFetch(opts(impl));
    expect((await f("https://example.com/")).status).toBe(200);
    expect(await codeOf(f("http://169.254.169.254/"))).toBe("blocked_address");
  });

  it("makeSafeFetch keeps a Request's method, headers and body", async () => {
    const { fn, impl } = mockFetch(html("x"));
    const f = makeSafeFetch(opts(impl));
    await f(
      new Request("https://example.com/p", {
        method: "POST",
        body: "payload",
        headers: { "content-type": "text/plain", "x-trace": "1" },
      }),
    );
    const init = fn.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("x-trace")).toBe("1");
    expect(init?.body).toBeDefined();
    expect(await codeOf(f(new Request("http://127.0.0.1/")))).toBe("blocked_address");
  });

  it("safeFetchBytes returns the bytes for an allowed audio type", async () => {
    const { impl } = mockFetch(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } }),
    );
    const out = await safeFetchBytes("https://example.com/a.wav", {
      allowedContentTypes: ["audio/*"],
      resolver: publicResolver,
      fetchImpl: impl,
    });
    expect(new Uint8Array(out.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("safeFetch redirects", () => {
  const redirect = (status: number, location?: string) =>
    new Response(null, { status, ...(location ? { headers: { location } } : {}) });

  it("follows a public redirect chain manually", async () => {
    const { fn, impl } = mockFetch(
      redirect(301, "https://www.example.com/a"),
      redirect(302, "/b"),
      html("final"),
    );
    const res = await safeFetch("https://example.com/", {}, opts(impl));
    expect(await res.text()).toBe("final");
    expect(fn.mock.calls.map((c) => c[0])).toEqual([
      "https://example.com/",
      "https://www.example.com/a",
      "https://www.example.com/b",
    ]);
  });

  it.each([
    ["metadata IP", "http://169.254.169.254/latest/meta-data/", "blocked_address"],
    ["loopback", "http://127.0.0.1:80/admin", "blocked_address"],
    ["hostname resolving private", "https://evil.example.net/", "blocked_address"],
    ["internal name", "http://localhost/", "blocked_hostname"],
    ["bad scheme", "file:///etc/passwd", "scheme_not_allowed"],
    ["bad port", "http://example.com:6379/", "port_not_allowed"],
  ] as const)("blocks a redirect to %s and never requests it", async (_n, location, code) => {
    const { fn, impl } = mockFetch(redirect(302, location));
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(impl)))).toBe(code);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("drops custom secret-bearing headers on a cross-origin redirect, keeps them same-origin", async () => {
    const { fn, impl } = mockFetch(
      redirect(302, "https://example.com/same"),
      redirect(302, "https://www.example.com/cross"),
      html("ok"),
    );
    await safeFetch(
      "https://example.com/",
      { headers: { "x-api-key": "k", "x-auth-token": "t", accept: "text/html" } },
      opts(impl),
    );
    const sameOrigin = new Headers(fn.mock.calls[1]?.[1]?.headers);
    expect(sameOrigin.get("x-api-key")).toBe("k");
    const cross = new Headers(fn.mock.calls[2]?.[1]?.headers);
    expect(cross.get("x-api-key")).toBeNull();
    expect(cross.get("x-auth-token")).toBeNull();
    expect(cross.get("accept")).toBe("text/html");
  });

  it("stops after 3 redirects", async () => {
    const { fn, impl } = mockFetch(() => redirect(302, "https://example.com/next"));
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(impl)))).toBe(
      "too_many_redirects",
    );
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 followed
  });

  it("rejects a redirect with no Location", async () => {
    const { impl } = mockFetch(redirect(302));
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(impl)))).toBe("bad_redirect");
  });

  it("drops credentials on a cross-origin redirect and the body on a 303", async () => {
    const { fn, impl } = mockFetch(redirect(303, "https://www.example.com/x"), html("ok"));
    await safeFetch(
      "https://example.com/",
      {
        method: "POST",
        body: "secret",
        headers: { authorization: "Bearer t", "content-type": "text/plain" },
      },
      opts(impl),
    );
    expect(fn.mock.calls[0]?.[1]?.body).toBe("secret");
    const second = fn.mock.calls[1]?.[1];
    expect(second?.method).toBe("GET");
    expect(second?.body).toBeUndefined();
    expect(new Headers(second?.headers).get("authorization")).toBeNull();
  });
});

describe("safeFetch response limits", () => {
  it("rejects an oversized body by Content-Length without reading it", async () => {
    const { impl } = mockFetch(
      html("x", { headers: { "content-type": "text/html", "content-length": "6000000" } }),
    );
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(impl)))).toBe(
      "response_too_large",
    );
  });

  it("rejects an oversized body with no Content-Length (streamed cap, default 5 MB)", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 10) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const { impl } = mockFetch(new Response(stream, { headers: { "content-type": "text/html" } }));
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(impl)))).toBe(
      "response_too_large",
    );
    expect(sent).toBeLessThan(10); // stopped reading early
  });

  it("honours a caller-specific maxBytes", async () => {
    const { impl } = mockFetch(html("x".repeat(200)));
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(impl, { maxBytes: 100 })))).toBe(
      "response_too_large",
    );
  });

  it("rejects a content type outside the allowlist", async () => {
    const { impl } = mockFetch(
      new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(impl)))).toBe(
      "content_type_not_allowed",
    );
  });

  it("rejects a missing content type on a non-empty body, allows it on an empty one", async () => {
    const noType = () => {
      const r = new Response("abc");
      r.headers.delete("content-type");
      return r;
    };
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(mockFetch(noType).impl)))).toBe(
      "content_type_not_allowed",
    );
    const empty = mockFetch(
      () => new Response(null, { status: 200, headers: { "content-length": "0" } }),
    );
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(empty.impl)))).toBe("resolved");
  });

  it("supports wildcard content types", async () => {
    const { impl } = mockFetch(new Response("x", { headers: { "content-type": "Audio/X-WAV" } }));
    expect(
      await codeOf(
        safeFetch("https://example.com/", {}, opts(impl, { allowedContentTypes: ["audio/*"] })),
      ),
    ).toBe("resolved");
  });

  it("times out overall", async () => {
    const impl = (async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(impl, { timeoutMs: 20 })))).toBe(
      "timeout",
    );
  });

  it("maps a network failure to network_error", async () => {
    const impl = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    expect(await codeOf(safeFetch("https://example.com/", {}, opts(impl)))).toBe("network_error");
  });

  it("passes 4xx through as a non-ok response", async () => {
    const { impl } = mockFetch(html("nope", { status: 404 }));
    const res = await safeFetch("https://example.com/", {}, opts(impl));
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("returns null-body statuses without a content-type check", async () => {
    const { impl } = mockFetch(new Response(null, { status: 204 }));
    const res = await safeFetch("https://example.com/", {}, opts(impl));
    expect(res.status).toBe(204);
  });
});
