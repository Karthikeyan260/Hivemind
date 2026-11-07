"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, Clapperboard, ExternalLink, HelpCircle, Info, Play, Radio, Search, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { GROUPS, MOVIES, runtime, type Group, type Movie } from "@/lib/theatre/catalog";
import { SpeechListener, type SpeechLang, type SpeechState } from "@/lib/theatre/speech";
import { findTitle, parseShelfCommand } from "@/lib/theatre/voice-commands";

/**
 * Friends Theatre: a streaming-site style shelf of free Tamil classics (public domain, streamed from Wikimedia
 * Commons). Pick a film, start a screening, share the link; friends open it with no password and watch in step
 * with chat and voice (see app/theatre/[room]).
 */
const DAY = Math.floor(Date.now() / 86_400_000); // a different featured film each day

type RowDef = { title: string; blurb: string; group: Group; pick: (m: Movie) => boolean };
const ROWS: RowDef[] = [
  { title: "Recent hits · 2015 to now", blurb: "Full films from the studios' own YouTube channels", group: "tamil", pick: (m) => !!m.yt && (m.year ?? 0) >= 2015 },
  { title: "2010–2014", blurb: "Plays in YouTube's player, so the channel's ads may show", group: "tamil", pick: (m) => !!m.yt && (m.year ?? 0) >= 2010 && (m.year ?? 0) < 2015 },
  { title: "The 2000s", blurb: "Remember these?", group: "tamil", pick: (m) => !!m.yt && (m.year ?? 0) >= 2000 && (m.year ?? 0) < 2010 },
  { title: "More from the studio channels", blurb: "Release year not confirmed", group: "tamil", pick: (m) => !!m.yt && m.year == null },
  { title: "Classics · 1961 to 1999", blurb: "Old favourites, uploaded by the studios", group: "tamil", pick: (m) => !!m.yt && m.year != null && m.year < 2000 },
  { title: "Hollywood, in Tamil", blurb: "Tamil-dubbed films from Sony Pictures' own channel", group: "hollywood", pick: () => true },
  { title: "Korean films, in Tamil", blurb: "Tamil-dubbed, from the studio's channel", group: "korean", pick: () => true },
  { title: "From other Indian languages", blurb: "Malayalam and more, from the official channels", group: "indian", pick: () => true },
  { title: "World cinema, in Tamil", blurb: "Chinese, Japanese and more, dubbed", group: "world", pick: () => true },
  { title: "Anime series, in Tamil", blurb: "Episodes from Muse India's official Tamil dubs", group: "anime", pick: () => true },
  { title: "Cartoons for kids, in Tamil", blurb: "Official Tamil episodes: Chhota Bheem, Little Singham, Motu Patlu, Mickey Mouse Clubhouse, The Lion Guard, Ben 10, Bluey, Paw Patrol and more", group: "kids", pick: () => true },
  { title: "Public-domain classics · 1960 and earlier", blurb: "Free for good, streamed from Wikimedia Commons", group: "tamil", pick: (m) => !m.yt },
];

/** One card per series (its first episode), with how many episodes there are. */
function collapse(list: Movie[]): Movie[] {
  const seen = new Set<string>();
  const out: Movie[] = [];
  for (const m of list) {
    if (m.series) {
      if (seen.has(m.series)) continue;
      seen.add(m.series);
      out.push(MOVIES.filter((x) => x.series === m.series).sort((a, b) => (a.ep ?? 0) - (b.ep ?? 0))[0]);
    } else out.push(m);
  }
  return out;
}
const episodesOf = (m: Movie) => (m.series ? MOVIES.filter((x) => x.series === m.series).sort((a, b) => (a.ep ?? 0) - (b.ep ?? 0)) : []);

export default function TheatrePage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Movie | null>(null);
  const [group, setGroup] = useState<Group | "all">("all");
  const [listen, setListen] = useState<SpeechState>("off");
  const [lang, setLang] = useState<SpeechLang>("en-IN");
  const [heard, setHeard] = useState<{ text: string; note: string } | null>(null);
  const [help, setHelp] = useState(false);
  const speech = useRef<SpeechListener | null>(null);
  const voiceRun = useRef<(text: string) => void>(() => {});
  const heardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different featured film each day.
  const featured = useMemo(() => {
    // one of the newest few films; the public-domain classics when there is nothing newer
    const recent = MOVIES.filter((m) => m.yt && (m.year ?? 0) >= 2000).slice(0, 8);
    const pool = recent.length ? recent : MOVIES.filter((m) => m.minutes >= 100);
    return pool[DAY % pool.length];
  }, []);

  function screening(m: Movie) {
    const room = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    router.push(`/theatre/${room}?m=${m.id}&host=1`);
  }

  /** Hands-free control of the shelf (see lib/theatre/voice-commands.ts). */
  function runVoice(text: string) {
    const c = parseShelfCommand(text);
    let note = "I didn't catch a command";
    if (c) {
      switch (c.t) {
        case "search":
          setQuery(c.q);
          setOpen(null);
          note = `Searching for “${c.q}”`;
          break;
        case "clearSearch":
          setQuery("");
          setGroup("all");
          note = "Cleared";
          break;
        case "group":
          setQuery("");
          setOpen(null);
          setGroup(c.g);
          note = `Showing ${GROUPS.find((g) => g.id === c.g)?.label ?? "everything"}`;
          break;
        case "open": {
          const m = findTitle(c.q, MOVIES);
          if (m) {
            setOpen(m);
            note = `${m.series ?? m.title}: say “start” to watch together`;
          } else note = `No film called “${c.q}”`;
          break;
        }
        case "start":
          if (open) {
            screening(open);
            note = "Starting your screening";
          } else note = "Pick a film first: say “play” and its name";
          break;
        case "close":
          setOpen(null);
          note = "Closed";
          break;
        case "back":
          router.push("/");
          note = "Going back";
          break;
        case "help":
          setHelp(true);
          note = "Here are some things to say";
          break;
      }
    }
    setHeard({ text, note });
    if (heardTimer.current) clearTimeout(heardTimer.current);
    heardTimer.current = setTimeout(() => setHeard(null), 4500);
  }
  useEffect(() => {
    voiceRun.current = runVoice;
  });
  useEffect(() => {
    const l = new SpeechListener((t) => voiceRun.current(t), setListen);
    speech.current = l;
    return () => {
      l.destroy();
      if (heardTimer.current) clearTimeout(heardTimer.current);
    };
  }, []);
  const toggleListen = () => (listen === "listening" ? speech.current?.stop() : speech.current?.start(lang));
  const switchLang = () => {
    const next: SpeechLang = lang === "en-IN" ? "ta-IN" : "en-IN";
    setLang(next);
    if (listen === "listening") speech.current?.start(next);
  };

  const found = query.trim() ? collapse(MOVIES.filter((m) => `${m.title} ${m.series ?? ""} ${m.year ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))) : null;

  return (
    <div className="fixed inset-0 z-[350] overflow-y-auto bg-[#07070b] text-white [scrollbar-width:thin]">
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-[#07070b] via-[#07070b]/90 to-transparent px-4 py-3 sm:px-8">
        <Link href="/" aria-label="Back" className="grid size-9 shrink-0 place-items-center rounded-full text-white/80 hover:bg-white/10">
          <ArrowLeft size={19} />
        </Link>
        <span className="flex items-center gap-2 font-serif text-lg tracking-wide sm:text-xl">
          <Clapperboard size={20} className="text-rose-400" />
          <span>
            Friends <span className="text-rose-400">Theatre</span>
          </span>
        </span>
        <button onClick={toggleListen} aria-pressed={listen === "listening"} title="Search and choose by voice (English or Tamil)" className={`ml-auto flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs ${listen === "listening" ? "border-rose-300/60 bg-rose-400/15 text-rose-200" : "border-white/20 text-white/80 hover:bg-white/10"}`}>
          <Radio size={14} className={listen === "listening" ? "animate-pulse" : ""} />
          <span className="hidden sm:inline">{listen === "listening" ? "Listening" : "Voice"}</span>
        </button>
        <label className="relative w-36 sm:w-64">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-white/45" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search films" className="h-9 w-full rounded-full border border-white/15 bg-white/8 pr-3 pl-9 text-sm outline-none placeholder:text-white/40 focus:border-rose-300/70" />
        </label>
      </header>

      <nav aria-label="Categories" className="sticky top-14 z-10 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:px-8 [&::-webkit-scrollbar]:hidden">
        {GROUPS.map((g) => (
          <button key={g.id} onClick={() => setGroup(g.id)} aria-pressed={group === g.id} className={`h-8 shrink-0 rounded-full border px-3.5 text-xs ${group === g.id ? "border-white bg-white text-black" : "border-white/20 bg-black/40 text-white/80 backdrop-blur hover:bg-white/10"}`}>
            {g.label}
          </button>
        ))}
      </nav>

      {listen !== "off" && (
        <div className="px-4 pb-2 text-xs sm:px-8">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={switchLang} className="h-8 rounded-full border border-rose-300/40 px-3 text-rose-200 hover:bg-white/10">
              {lang === "en-IN" ? "English" : "தமிழ்"}
            </button>
            <button onClick={() => setHelp((h) => !h)} className="flex h-8 items-center gap-1.5 rounded-full border border-white/20 px-3 text-white/80 hover:bg-white/10">
              <HelpCircle size={13} /> What can I say?
            </button>
            {listen === "denied" && <span className="text-amber-300">The browser blocked the microphone. Allow it in the address bar.</span>}
            {listen === "unsupported" && <span className="text-amber-300">This browser can&apos;t listen. Try Chrome, Edge or Safari.</span>}
          </div>
          {help && (
            <div className="mt-2 max-w-2xl rounded-xl border border-white/10 bg-white/5 p-3 leading-relaxed text-white/75">
              <p className="mb-1 font-medium text-white">Say, in English or தமிழ்:</p>
              <p>“search Mayabazar” (தேடு) · “show kids cartoons” · “show anime” · “show Hollywood” · “show Korean” · “show all”</p>
              <p>“play Ben 10” (opens it) · “start” (starts the screening) · “close” · “clear” · “back”</p>
            </div>
          )}
        </div>
      )}

      {found ? (
        <section className="px-4 pt-4 pb-20 sm:px-8">
          <h2 className="mb-3 text-lg font-medium">{found.length ? `Results for “${query.trim()}”` : `Nothing matches “${query.trim()}”`}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {found.map((m) => (
              <Card key={m.id} m={m} onOpen={setOpen} wide />
            ))}
          </div>
        </section>
      ) : (
        <>
          <section className="relative -mt-14 min-h-[62vh] overflow-hidden sm:min-h-[70vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={featured.poster} alt="" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#07070b] via-[#07070b]/55 to-[#07070b]/20" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#07070b]/90 via-[#07070b]/30 to-transparent" />
            <div className="relative flex min-h-[62vh] max-w-2xl flex-col justify-end px-4 pb-14 sm:min-h-[70vh] sm:px-8 sm:pb-20">
              <p className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-[0.3em] text-rose-300 uppercase">
                <span className="rounded bg-rose-500 px-1.5 py-0.5 text-[10px] tracking-widest text-white">Tonight</span> Featured
              </p>
              <h1 className="font-serif text-4xl leading-[1.05] drop-shadow-lg sm:text-6xl">{featured.title}</h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-3 text-sm text-white/80">
                {featured.year && <span>{featured.year}</span>}
                <span>{runtime(featured.minutes)}</span>
                <span className="rounded border border-white/40 px-1.5 text-[11px]">Tamil</span>
                <span className="text-emerald-300">{featured.yt ? "Free on YouTube" : "Free · public domain"}</span>
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={() => screening(featured)} className="flex h-11 items-center gap-2 rounded-lg bg-white px-5 font-medium text-black hover:bg-white/85">
                  <Users size={18} /> Watch together
                </button>
                <button onClick={() => setOpen(featured)} className="flex h-11 items-center gap-2 rounded-lg bg-white/20 px-5 font-medium backdrop-blur hover:bg-white/30">
                  <Info size={18} /> More info
                </button>
              </div>
            </div>
          </section>

          <div className="relative z-10 -mt-10 space-y-8 pb-24 sm:-mt-14">
            {ROWS.filter((r) => group === "all" || r.group === group).map((r) => {
              const items = collapse(MOVIES.filter((m) => m.group === r.group && r.pick(m)));
              return items.length ? <Row key={r.title} title={r.title} blurb={r.blurb} items={items} onOpen={setOpen} /> : null;
            })}
            {(group === "all" || group === "korean") && (
              <section className="px-4 sm:px-8">
                <h2 className="text-lg font-medium sm:text-xl">Free in other apps</h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/55">
                  Some free Tamil content can&apos;t play inside the theatre because the apps don&apos;t allow it. Tamil-dubbed Korean series are the main example: Amazon MX Player streams 18 CJ ENM dramas free in Tamil, Hindi and Telugu, and its free library (with the old Amazon miniTV, 200+ Tamil and Telugu dubs) has Tamil films and shows too. Open them in their own app and use a room here for chat and voice; the pictures won&apos;t stay in step by themselves.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <a href="https://www.mxplayer.in" target="_blank" rel="noreferrer" className="flex h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/20">
                    <ExternalLink size={15} /> Amazon MX Player
                  </a>
                  <a href="https://www.aboutamazon.in/news/entertainment/amazon-mx-player-cj-enm-korean-drama-free" target="_blank" rel="noreferrer" className="flex h-10 items-center gap-2 rounded-lg border border-white/15 px-4 text-sm text-white/75 hover:bg-white/10">
                    <Info size={15} /> Which Korean dramas are free
                  </a>
                  <a href="https://prasarbharati.gov.in/waves/" target="_blank" rel="noreferrer" className="flex h-10 items-center gap-2 rounded-lg border border-white/15 px-4 text-sm text-white/75 hover:bg-white/10">
                    <ExternalLink size={15} /> Waves (government, free)
                  </a>
                </div>
              </section>
            )}
            <p className="px-4 text-xs leading-relaxed text-white/35 sm:px-8">
              Newer films play in YouTube&apos;s own player from the studios&apos; official channels (Ayngaran, Rajshri Tamil and others), so their ads, and any limits for your country, apply. Some films may stop working if a channel removes them. The oldest ones are public domain on Wikimedia Commons. HIVEMIND stores nothing.
            </p>
          </div>
        </>
      )}

      {heard && (
        <div role="status" className="pointer-events-none fixed bottom-5 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-xl bg-black/80 px-4 py-2.5 text-center text-sm backdrop-blur">
          <span className="block text-xs text-white/55">Heard: “{heard.text}”</span>
          <span className="font-medium">{heard.note}</span>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-30 grid place-items-center p-3 sm:p-6" role="dialog" aria-label={open.title}>
          <button aria-label="Close" onClick={() => setOpen(null)} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <div className="relative max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl bg-[#12121a] shadow-2xl ring-1 ring-white/10">
            <div className="relative aspect-video">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={open.poster} alt="" className="size-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#12121a] to-transparent" />
              <button onClick={() => setOpen(null)} aria-label="Close" className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-black/60 hover:bg-black/80">
                <X size={18} />
              </button>
              <h2 className="absolute bottom-3 left-5 font-serif text-3xl drop-shadow-lg">{open.series ?? open.title}</h2>
            </div>
            <div className="space-y-4 p-5">
              <p className="flex flex-wrap items-center gap-x-3 text-sm text-white/75">
                {open.year && <span>{open.year}</span>}
                <span>{runtime(open.minutes)}</span>
                <span className="rounded border border-white/35 px-1.5 text-[11px]">Tamil</span>
                <span className="text-emerald-300">{open.yt ? "Free on YouTube" : "Public domain"}</span>
                {!open.yt && <span className="text-white/45">{Math.round(open.mb / 100) / 10} GB original</span>}
                {open.channel && <span className="text-white/45">{open.channel}</span>}
              </p>
              {open.about && <p className="text-sm leading-relaxed text-white/70">{open.about}</p>}
              {open.series && (
                <div>
                  <p className="mb-2 text-sm font-medium">Episodes</p>
                  <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1">
                    {episodesOf(open).map((e) => (
                      <button key={e.id} onClick={() => screening(e)} className="flex items-center justify-between gap-3 rounded-lg bg-white/6 px-3 py-2 text-left text-sm hover:bg-white/12">
                        <span className="truncate">{e.title}</span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-white/50">
                          {runtime(e.minutes)} <Users size={14} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <button onClick={() => screening(open)} className="flex h-11 items-center gap-2 rounded-lg bg-rose-500 px-5 font-medium hover:bg-rose-400">
                  <Play size={17} fill="currentColor" /> {open.series ? "Start with episode 1" : "Start a screening"}
                </button>
                <a href={open.yt ? `https://www.youtube.com/watch?v=${open.yt}` : open.page} target="_blank" rel="noreferrer" className="flex h-11 items-center gap-2 rounded-lg border border-white/20 px-4 text-sm text-white/80 hover:bg-white/10">
                  <ExternalLink size={15} /> {open.yt ? "On YouTube" : "Commons page"}
                </a>
              </div>
              <p className="text-xs text-white/40">
                {open.embed ? "You get a link to send. Friends open it, type a name and the film plays in step for everyone, with chat and voice." : `${open.channel} only lets this film play on YouTube itself, so it can't play inside the theatre. You still get a room with chat and voice, and a "Start together" countdown so everyone presses play at the same moment.`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ title, blurb, items, onOpen }: { title: string; blurb: string; items: Movie[]; onOpen: (m: Movie) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const by = (d: number) => scroller.current?.scrollBy({ left: d * scroller.current.clientWidth * 0.85, behavior: "smooth" });
  return (
    <section>
      <div className="mb-2 flex items-end justify-between px-4 sm:px-8">
        <div>
          <h2 className="text-lg font-medium sm:text-xl">{title}</h2>
          <p className="text-xs text-white/45">{blurb}</p>
        </div>
        <div className="hidden gap-1.5 sm:flex">
          <button onClick={() => by(-1)} aria-label="Scroll left" className="grid size-8 place-items-center rounded-full bg-white/10 hover:bg-white/20">
            <ChevronLeft size={17} />
          </button>
          <button onClick={() => by(1)} aria-label="Scroll right" className="grid size-8 place-items-center rounded-full bg-white/10 hover:bg-white/20">
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      <div ref={scroller} className="flex snap-x gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:px-8 [&::-webkit-scrollbar]:hidden">
        {items.map((m) => (
          <Card key={m.id} m={m} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function Card({ m, onOpen, wide }: { m: Movie; onOpen: (m: Movie) => void; wide?: boolean }) {
  return (
    <button onClick={() => onOpen(m)} className={`group relative snap-start text-left ${wide ? "" : "w-[62vw] shrink-0 sm:w-64"}`}>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10 transition duration-200 group-hover:scale-[1.04] group-hover:ring-rose-300/70">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.poster} alt="" loading="lazy" className="size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
        <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white/85">{m.series ? "Series" : runtime(m.minutes)}</span>
        <span className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
          <span className="grid size-11 place-items-center rounded-full bg-white/90 text-black">
            <Play size={18} fill="currentColor" />
          </span>
        </span>
      </div>
      <p className="mt-1.5 truncate text-sm font-medium">{m.series ?? m.title}</p>
      <p className="text-[11px] text-white/45">
        {m.series ? `${episodesOf(m).length} episodes` : (m.year ?? "Classic")}
        {m.group === "tamil" ? " · Tamil" : " · In Tamil"}
        {m.yt ? (m.embed ? " · YouTube" : " · Opens on YouTube") : ""}
      </p>
    </button>
  );
}
