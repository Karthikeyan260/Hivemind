import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { HttpError } from "@/lib/api";

/**
 * Fetch for user-supplied URLs (page import): only public http(s) hosts. Resolves the hostname and
 * refuses loopback, private, link-local (cloud metadata) and other internal ranges, and checks
 * every redirect hop the same way, so the server can't be used to reach its own network (SSRF).
 */
function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast / reserved
  );
}
function privateV6(ip: string) {
  const x = ip.toLowerCase();
  if (x === "::" || x === "::1") return true;
  if (x.startsWith("::ffff:")) return privateV4(x.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
}
const isPrivate = (ip: string) => (isIP(ip) === 6 ? privateV6(ip) : privateV4(ip));

async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "Only http(s) URLs");
  if (url.username || url.password) throw new HttpError(400, "URLs with credentials aren't allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new HttpError(400, "That address isn't allowed");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new HttpError(502, "Could not reach that page");
  if (addrs.some(isPrivate)) throw new HttpError(400, "That address isn't allowed");
}

export async function safeFetch(raw: string | URL, init: RequestInit = {}, maxRedirects = 4) {
  let url = new URL(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    return res;
  }
  throw new HttpError(502, "Too many redirects");
}
