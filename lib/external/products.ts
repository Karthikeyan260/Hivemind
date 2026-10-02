import "server-only";
import { webSearch } from "@/lib/external/web";

/**
 * Product lookup on Indian stores: the big marketplaces, and the quick-delivery apps (Zepto,
 * Blinkit, Swiggy Instamart, BigBasket) for groceries and everyday things. Google Search (via Gemini) finds the listings; links are resolved
 * to the exact product pages. A store with no product page found gets its search-results link for
 * the product instead, never a bare home page.
 */
const enc = encodeURIComponent;
const STORES = {
  flipkart: { name: "Flipkart", domain: "flipkart.com", host: /(^|\.)flipkart\.com$/, product: /\/p\/itm/, search: (q: string) => `https://www.flipkart.com/search?q=${enc(q)}` },
  amazon: { name: "Amazon", domain: "amazon.in", host: /(^|\.)amazon\.in$/, product: /\/(dp|gp\/product)\/[A-Z0-9]{10}/, search: (q: string) => `https://www.amazon.in/s?k=${enc(q)}` },
  meesho: { name: "Meesho", domain: "meesho.com", host: /(^|\.)meesho\.com$/, product: /\/p\/[a-z0-9]+/i, search: (q: string) => `https://www.meesho.com/search?q=${enc(q)}` },
  zepto: { name: "Zepto", domain: "zeptonow.com", host: /(^|\.)zeptonow\.com$/, product: /\/pn\/[^/]+\/pvid\//, search: (q: string) => `https://www.zeptonow.com/search?query=${enc(q)}` },
  blinkit: { name: "Blinkit", domain: "blinkit.com", host: /(^|\.)blinkit\.com$/, product: /\/prn\/[^/]+\/prid\/\d+/, search: (q: string) => `https://blinkit.com/s/?q=${enc(q)}` },
  instamart: { name: "Swiggy Instamart", domain: "swiggy.com/instamart", host: /(^|\.)swiggy\.com$/, product: /^\/instamart\/item\//, search: (q: string) => `https://www.swiggy.com/instamart/search?custom_back=true&query=${enc(q)}` },
  bigbasket: { name: "BigBasket", domain: "bigbasket.com", host: /(^|\.)bigbasket\.com$/, product: /^\/pd\/\d+/, search: (q: string) => `https://www.bigbasket.com/ps/?q=${enc(q)}` },
} as const;
export type StoreId = keyof typeof STORES;
export const STORE_IDS = Object.keys(STORES) as StoreId[];
/** Online marketplaces: the default when no store is named. */
export const MARKETPLACES: StoreId[] = ["flipkart", "amazon", "meesho"];
/** 10-minute delivery apps, for groceries and everyday items. */
export const QUICK_STORES: StoreId[] = ["zepto", "blinkit", "instamart", "bigbasket"];
const QUICK_WORDS = /\b(quick|instant|10[- ]?min(ute)?s?) (delivery|commerce)\b|\bgrocer(y|ies)\b/i;

export type ProductLink = { store: string; title: string; url: string };

/** "boat-airdopes-141-gen-2-bluetooth" → "Boat Airdopes 141 Gen 2 Bluetooth" (stores put the name in the path). */
function nameFromUrl(u: URL) {
  const slug = u.pathname.split("/").filter((p) => /[a-z]{2,}[-_][a-z0-9]/i.test(p) && !/^[0-9a-f-]{20,}$/i.test(p)).sort((a, b) => b.length - a.length)[0] ?? "";
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

/** "I want to buy a cotton kurti", "boAt earbuds on Flipkart", "price of iPhone 16", "Redmi price link". */
export const SHOPPING = /\b(flipkart|amazon|meesho|zepto|blinkit|instamart|bigbasket)\b|\b(quick|instant|10[- ]?min(ute)?s?) (delivery|commerce)\b|\b(buy|purchase|shop for)\b|\b(price|cost) (of|for)\b|\b(price|buying|product|shopping) links?\b|\bwhere (can|to|do) (i )?buy\b/i;

const FILLER =
  /\b(hey|hi|please|pls|can you|could you|i want to|i wanna|i need to|i need|i want|help me|find|show me|show|search( for)?|look for|get me|buy|purchase|shop for|order|price( of| for)?|cost( of| for)?|buying|product|shopping|links?|online|where (can|to|do) (i )?buy|for me|on|from|in|at|flipkart|amazon(\.in)?|meesho|zepto|blinkit|swiggy|instamart|bigbasket|zomato|(quick|instant|10[- ]?min(ute)?s?) (delivery|commerce)( apps?)?|apps?|like( that)?|give|that|this|a|an|the|some|me)\b/gi;

/** Stores named in a message ("on Flipkart", "Zepto"); quick-delivery wording means the 10-minute apps. */
export function storesIn(message: string): StoreId[] {
  // Swiggy's grocery app is Instamart; Zomato's is Blinkit.
  const m = message.replace(/\bswiggy\b/gi, "instamart").replace(/\bzomato\b/gi, "blinkit");
  const named = STORE_IDS.filter((s) => new RegExp(`\\b${s}\\b`, "i").test(m));
  if (named.length) return named;
  return QUICK_WORDS.test(m) ? QUICK_STORES : MARKETPLACES;
}

/** The product words of a shopping message: "i want to buy a cotton kurti on meesho" → "cotton kurti". */
export function productQuery(message: string) {
  return message.replace(FILLER, " ").replace(/[?!.,:]+/g, " ").replace(/\s+/g, " ").trim().replace(/(\s+(for|with|of|to|and))+$/i, "");
}

/** Store search-results links for a product: always work, no AI or quota needed. */
export function storeSearchLinks(query: string, stores: StoreId[] = MARKETPLACES) {
  return stores.map((k) => ({ store: STORES[k].name, url: STORES[k].search(query) }));
}

export async function findProduct(query: string, stores: StoreId[] = MARKETPLACES) {
  // Google's grounding varies call to call; one retry when no product page came back. When the free
  // search quota is used up, the store search links still answer the request.
  let r: Awaited<ReturnType<typeof searchStores>> = { summary: "", products: [], other_pages: [] };
  let limited = false;
  try {
    r = await searchStores(query, stores);
    if (!r.products.length) r = await searchStores(query, stores).catch(() => r);
  } catch {
    limited = true;
  }
  const found = new Set(r.products.map((p) => p.store));
  const search_links = storeSearchLinks(query, stores).filter((l) => !found.has(l.store));
  return { ...r, search_links, ...(limited ? { search_unavailable: "Live search is busy (Google's free limit); only the store search links are available." } : {}) };
}

async function searchStores(query: string, stores: StoreId[]) {
  const names = stores.map((s) => STORES[s].name).join(", ");
  const domains = stores.map((s) => STORES[s].domain).join(", ");
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
