import "server-only";
import { HttpError } from "@/lib/api";
import { chunkText } from "@/lib/rag/chunker";
import { safeFetch } from "@/lib/safe-fetch";

const MAX_BYTES = 3 * 1024 * 1024;

/** The body as text, but stop reading at `max` bytes (a huge page never sits whole in memory). */
async function readCapped(res: Response, max: number) {
  if (!res.body) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(parts).subarray(0, max));
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));

/** Fetches a public page and returns readable text. Only for server-rendered pages (no JS execution). */
export async function fetchPageText(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, "Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "Only http(s) URLs");
  if (/(^|\.)linkedin\.com$/i.test(url.hostname)) {
    throw new HttpError(422, "LinkedIn blocks automated access. Open your profile → More → Save to PDF, then upload it in Documents.");
  }

  // Public hosts only (no internal network / cloud metadata), checked on every redirect.
  const res = await safeFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SecondBrain/1.0; personal import)", Accept: "text/html,text/plain" },
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => {
    throw err instanceof HttpError ? err : new HttpError(502, "Could not reach that page");
  });
  if (!res.ok) throw new HttpError(502, `Page returned HTTP ${res.status}`);
  const html = await readCapped(res, MAX_BYTES);

  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? url.hostname);
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|section|article|li|h[1-6]|br|tr|header|footer)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();

  if (text.length < 200) {
    throw new HttpError(422, "Page has almost no readable text (it may need JavaScript to render)");
  }
  return { title: title.slice(0, 150), url: url.toString(), chunks: chunkText(text).map((content) => ({ content, metadata: {} })) };
}
