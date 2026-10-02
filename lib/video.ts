import "server-only";

/**
 * Videos for HIVEMIND's video player. Search reads YouTube's own results page (no API key);
 * playback is YouTube's official embedded player in the owner's browser. With YOUTUBE_API_KEY
 * set, the official Data API is tried first.
 */
export type Video = { id: string; title: string; channel: string; duration: string; thumb: string };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const ID = /^[A-Za-z0-9_-]{11}$/;

type Runs = { runs?: { text: string }[]; simpleText?: string };
const text = (t?: Runs) => t?.simpleText ?? t?.runs?.map((r) => r.text).join("") ?? "";

type Renderer = { videoId?: string; title?: Runs; ownerText?: Runs; longBylineText?: Runs; lengthText?: Runs };

/** Every videoRenderer in YouTube's page data, wherever it sits in the layout. */
function collect(node: unknown, out: Renderer[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return;
  }
  const o = node as Record<string, unknown>;
  if (o.videoRenderer) out.push(o.videoRenderer as Renderer);
  for (const k in o) if (k !== "videoRenderer") collect(o[k], out);
}

async function fromPage(query: string, count: number): Promise<Video[]> {
  // sp=EgIQAQ%3D%3D: videos only (no channels, playlists or Shorts shelves).
  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D&hl=en&gl=IN`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Video search failed (${res.status})`);
  const html = await res.text();
  // "var ytInitialData = {…};" or 'window["ytInitialData"] = {…};', depending on the page version.
  const marker = /ytInitialData"?\]?\s*=\s*\{/.exec(html);
  if (!marker) throw new Error("Video search failed (unexpected page)");
  const from = marker.index + marker[0].length - 1;
  const end = html.indexOf(";</script>", from);
  const data = JSON.parse(html.slice(from, end));
  const found: Renderer[] = [];
  collect(data, found);
  const seen = new Set<string>();
  return found
    .filter((v) => v.videoId && ID.test(v.videoId) && v.lengthText && !seen.has(v.videoId) && !!seen.add(v.videoId))
    .slice(0, count)
    .map((v) => ({
      id: v.videoId!,
      title: text(v.title),
      channel: text(v.ownerText ?? v.longBylineText),
      duration: text(v.lengthText),
      thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
    }));
}

async function fromApi(query: string, count: number): Promise<Video[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const qs = new URLSearchParams({ part: "snippet", type: "video", videoEmbeddable: "true", maxResults: String(count), q: query, regionCode: "IN", key });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${qs}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: { id: { videoId: string }; snippet: { title: string; channelTitle: string } }[] };
  return (data.items ?? []).map((i) => ({ id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle, duration: "", thumb: `https://i.ytimg.com/vi/${i.id.videoId}/mqdefault.jpg` }));
}

/** Videos for a request: "Vibe Venuma video", "Leo trailer", "how to make filter coffee". */
export async function searchVideos(query: string, count = 12): Promise<Video[]> {
  const n = Math.min(25, Math.max(1, count));
  const api = await fromApi(query, n).catch(() => []);
  return api.length ? api : fromPage(query, n);
}
