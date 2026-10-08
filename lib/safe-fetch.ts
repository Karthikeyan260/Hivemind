import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { HttpError } from "@/lib/api";

/**
 * Fetch for user- or AI-supplied URLs (page import, shared links): public http(s) hosts only.
 *
 * - Addresses are checked with Node's BlockList, which also catches IPv4 hidden inside IPv6
 *   ("[::ffff:169.254.169.254]" — the URL parser turns it into "::ffff:a9fe:a9fe", which a string
 *   check misses) plus the old IPv4-compatible, NAT64 and 6to4 forms that can tunnel to IPv4.
 * - The connection itself only uses addresses that passed the check (a custom DNS lookup), so a
 *   name can't resolve to something public for the check and something internal for the fetch
 *   (DNS rebinding).
 * - Every redirect hop goes through the same check.
 */
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3], // multicast and reserved, up to 255.255.255.255
] as const)
  blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 96], // unspecified, loopback and IPv4-compatible (::a.b.c.d)
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const)
  blocked.addSubnet(net, bits, "ipv6");

/** Mapped IPv4 (::ffff:a.b.c.d) is checked against the IPv4 rules by BlockList itself. */
export const isBlockedAddress = (ip: string) => {
  const v = isIP(ip);
  return v === 0 || blocked.check(ip, v === 6 ? "ipv6" : "ipv4");
};

function assertUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "Only http(s) URLs");
  if (url.username || url.password) throw new HttpError(400, "URLs with credentials aren't allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new HttpError(400, "That address isn't allowed");
  // An IP literal never goes through DNS: check it here.
  if (isIP(host) && isBlockedAddress(host)) throw new HttpError(400, "That address isn't allowed");
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
/** DNS for the actual connection: refuses the whole name if any answer is internal. */
function guardedLookup(hostname: string, options: { all?: boolean } | number, cb: LookupCb) {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err, "");
    if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) {
      const e: NodeJS.ErrnoException = new Error("That address isn't allowed");
      e.code = "EBLOCKED";
      return cb(e, "");
    }
    if (typeof options === "object" && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

/** One request with the guarded DNS; the body is decompressed like fetch would. */
function request(url: URL, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "accept-encoding": "gzip, deflate, br" };
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      { method: init.method ?? "GET", headers, lookup: guardedLookup as never, signal: init.signal ?? undefined },
      (res) => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v != null) for (const one of Array.isArray(v) ? v : [v]) out.append(k, one);
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const body = enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
        if (enc) out.delete("content-encoding");
        const status = res.statusCode ?? 502;
        const empty = status === 204 || status === 304 || (init.method ?? "GET") === "HEAD";
        resolve(new Response(empty ? null : (Readable.toWeb(body) as ReadableStream), { status: status < 200 || status > 599 ? 502 : status, headers: out }));
      },
    );
    req.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "EBLOCKED" ? new HttpError(400, "That address isn't allowed") : e));
    req.end();
  });
}

export async function safeFetch(raw: string | URL, init: RequestInit = {}, maxRedirects = 4) {
  if (init.body) throw new Error("safeFetch only does bodyless requests");
  let url = new URL(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    assertUrl(url);
    const res = await request(url, init);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    return res;
  }
  throw new HttpError(502, "Too many redirects");
}
