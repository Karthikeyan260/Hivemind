// Is every Friends Theatre film still there? Run `npm run theatre:links` now and then (channels remove videos, and can switch
// embedding off). It asks YouTube's oEmbed whether each video can still be embedded (200 = yes, 401/404 = no) and asks
// Wikimedia Commons for the first bytes of each public-domain film. Prints what broke and exits 1 if anything did.
// Options: --youtube or --commons to check only one source. To fix a broken film, regenerate or edit lib/theatre/*-films.ts.
import { readFileSync } from "node:fs";

const files = ["youtube-films", "dubbed-films", "anime-films", "kids-films", "commons-films"].map((f) => `lib/theatre/${f}.ts`);
const movies = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const arr = src.slice(src.indexOf("= [") + 2, src.lastIndexOf("];") + 1);
  movies.push(...JSON.parse(arr));
}
const only = process.argv.includes("--commons") ? "commons" : process.argv.includes("--youtube") ? "youtube" : "";
const yt = only === "commons" ? [] : movies.filter((m) => m.yt && m.embed);
const commons = only === "youtube" ? [] : movies.filter((m) => !m.yt);
console.log(`${movies.length} titles: ${yt.length} on YouTube (to embed), ${movies.filter((m) => m.yt && !m.embed).length} open on YouTube, ${commons.length} from Commons`);

const bad = [];
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

let done = 0;
await pool(yt, 6, async (m) => {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(m.page)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) bad.push(`${m.title} (${m.channel}) ${m.page}: YouTube answered ${r.status}`);
  } catch (e) {
    bad.push(`${m.title} ${m.page}: ${e.message}`);
  }
  if (++done % 200 === 0) console.log(`  checked ${done}/${yt.length}`);
});

// Commons rate-limits quick requests (429): go slowly, and wait and retry when it says so.
for (const m of commons) {
  const q = m.qualities[m.qualities.length - 1];
  let status = 0;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await fetch(q.src, { headers: { Range: "bytes=0-1023", "User-Agent": "HivemindTheatre/0.1 (personal project; link check)" }, signal: AbortSignal.timeout(30000) });
      status = r.status;
      if (status !== 429) break;
      await new Promise((r2) => setTimeout(r2, 8000 * (attempt + 1)));
    }
    if (status !== 206 && status !== 200) bad.push(`${m.title} ${q.src}: Commons answered ${status}`);
  } catch (e) {
    bad.push(`${m.title} ${q.src}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 2000));
}

if (bad.length) {
  console.log(`\n${bad.length} problem(s):`);
  for (const b of bad) console.log(" -", b);
  process.exit(1);
}
console.log("All films are still there.");
