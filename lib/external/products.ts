import "server-only";
import { webSearch } from "@/lib/external/web";

/**
 * Product lookup on Indian stores. Google Search (via Gemini) finds the listings; links are resolved
 * to the exact product pages. A store with no product page found gets its search-results link for
 * the product instead, never a bare home page.
 */
const STORES = {
  flipkart: { name: "Flipkart", host: /(^|\.)flipkart\.com$/, product: /\/p\/itm/, search: (q: string) => `https://www.flipkart.com/search?q=${encodeURIComponent(q)}` },
  amazon: { name: "Amazon", host: /(^|\.)amazon\.in$/, product: /\/(dp|gp\/product)\/[A-Z0-9]{10}/, search: (q: string) => `https://www.amazon.in/s?k=${encodeURIComponent(q)}` },
  meesho: { name: "Meesho", host: /(^|\.)meesho\.com$/, product: /\/p\/[a-z0-9]+/i, search: (q: string) => `https://www.meesho.com/search?q=${encodeURIComponent(q)}` },
} as const;
export type StoreId = keyof typeof STORES;
export const STORE_IDS = Object.keys(STORES) as StoreId[];

export type ProductLink = { store: string; title: string; url: string };

/** "boat-airdopes-141-gen-2-bluetooth" → "Boat Airdopes 141 Gen 2 Bluetooth" (Flipkart/Amazon put the name in the path). */
function nameFromUrl(u: URL) {
  const slug = u.pathname.split(/\/(?:p|dp|gp)\//)[0].split("/").filter(Boolean).pop() ?? "";
  const words = decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80) : "";
}

/** Drops tracking query params so the link stays short and clean. */
function cleanUrl(u: URL, store: StoreId) {
  if (store === "flipkart") {
    const pid = u.searchParams.get("pid");
    return `${u.origin}${u.pathname}${pid ? `?pid=${pid}` : ""}`;
  }
  if (store === "amazon") {
    const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1];
    return asin ? `https://www.amazon.in/dp/${asin}` : `${u.origin}${u.pathname}`;
  }
  return `${u.origin}${u.pathname}`;
}

export async function findProduct(query: string, stores: StoreId[] = STORE_IDS) {
  // Google's grounding varies call to call; one retry when no product page came back.
  let r = await searchStores(query, stores);
  if (!r.products.length) r = await searchStores(query, stores).catch(() => r);
  const found = new Set(r.products.map((p) => p.store));
  const search_links = stores.filter((k) => !found.has(STORES[k].name)).map((k) => ({ store: STORES[k].name, url: STORES[k].search(query) }));
  return { ...r, search_links };
}

async function searchStores(query: string, stores: StoreId[]) {
  const names = stores.map((s) => STORES[s].name).join(", ");
  const domains = stores.map((s) => (s === "amazon" ? "amazon.in" : `${s}.com`)).join(", ");
  const res = await webSearch(query, {
    prompt: `Find product listing pages for "${query}" on ${domains} (India). For each store (${names}) give the exact product name, the current price in ₹ and rating if shown. Be concise. Today is ${new Date().toISOString().slice(0, 10)}.`,
    maxSources: 20,
  });

  const products: ProductLink[] = [];
  const other: ProductLink[] = [];
  for (const s of res.sources) {
    let u: URL;
    try {
      u = new URL(s.url);
    } catch {
      continue;
    }
    const id = stores.find((k) => STORES[k].host.test(u.hostname));
    // "/product/p/itme?pid=…" style links carry no product name; skip them.
    if (id && STORES[id].product.test(u.pathname) && !/^\/product\//.test(u.pathname)) {
      products.push({ store: STORES[id].name, title: nameFromUrl(u) || s.title, url: cleanUrl(u, id) });
    } else if (!/grounding-api-redirect|youtube\.com|facebook\.com/.test(s.url)) {
      other.push({ store: s.title, title: nameFromUrl(u) || s.title, url: s.url });
    }
  }
  return { summary: res.answer, products: products.slice(0, 6), other_pages: other.slice(0, 3) };
}
