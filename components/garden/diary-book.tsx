"use client";

import { Caveat } from "next/font/google";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DiaryEntry } from "@/lib/nova-diary";
import type { DiaryPage, DiaryScene, SpreadInfo } from "./diary-3d";

/**
 * Nova's diary as a book you hold: a real 3D book (see diary-3d.ts) whose cover opens and whose pages bend as they
 * turn. Drag a page corner, tap the outer edge of a page to turn it, tap the middle of a page to zoom in and read it,
 * or use the arrows / arrow keys. Today's page is written at 11 pm, or on the spot with the button.
 *
 * The controls around the book follow what diary and flipbook apps do: a month calendar with a mood on every day you
 * wrote (jump to any day, or to today), a progress line so you always know where you are, 44 px touch targets with
 * visible focus, and controls that fade while you read so they never cover the page.
 */
const caveat = Caveat({ subsets: ["latin"], display: "swap" });
// Handwriting for English; the system's own fonts take over for Tamil and anything else.
const HAND = `${caveat.style.fontFamily}, "Noto Sans Tamil", "Nirmala UI", "Latha", cursive`;

type Data = { today: string; dates: string[]; entries: DiaryEntry[] };

const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const isDate = (k: string | null): k is string => !!k && /^\d{4}-\d{2}-\d{2}$/.test(k);
const BTN = "grid h-11 w-11 place-items-center rounded-full bg-white/14 text-lg text-white backdrop-blur-md transition hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 active:scale-90 disabled:opacity-25";

/** Title page, then the days oldest to newest, then today's empty page if it isn't written, padded to whole sheets. */
function buildPages(d: Data | null): DiaryPage[] {
  if (!d) return [];
  const pages: DiaryPage[] = [{ key: "title", kind: "title" }];
  for (const e of [...d.entries].reverse()) pages.push({ key: e.date, kind: "entry", date: e.date, text: e.text, mood: e.mood });
  if (!d.entries.some((e) => e.date === d.today)) pages.push({ key: "write", kind: "write" });
  // The newest page should sit on the right-hand side, with the one before it on the left: a blank flyleaf shifts the rest if needed.
  if (pages.length % 2 === 0) pages.splice(1, 0, { key: "flyleaf", kind: "blank" });
  if (pages.length % 2) pages.push({ key: "end", kind: "blank", text: "to be continued…" });
  return pages;
}

export function DiaryBook({ pet, onClose }: { pet: string; onClose: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<DiaryScene | null>(null);
  const opened = useRef(false);
  const loadingMore = useRef(false);
  const reveal = useRef<string | null>(null);
  const pendingJump = useRef<string | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<SpreadInfo | null>(null);
  const [writing, setWriting] = useState(false);
  const [hint, setHint] = useState(true);
  const [awake, setAwake] = useState(true);
  const [cal, setCal] = useState(false);
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const pages = useMemo(() => buildPages(data), [data]);
  const moods = useMemo(() => new Map((data?.entries ?? []).map((e) => [e.date, e.mood ?? "•"])), [data]);

  // The data.
  useEffect(() => {
    fetch("/api/diary")
      .then((r) => r.json() as Promise<Data & { error?: string }>)
      .then((j) => (j.entries ? setData(j) : setError(j.error ?? "Couldn't open the diary.")))
      .catch(() => setError("Couldn't open the diary."));
  }, []);

  // The scene: made once the handwriting font is ready (so the first page is drawn in it).
  useEffect(() => {
    let dead = false;
    let ro: ResizeObserver | null = null;
    void (async () => {
      try {
        await Promise.race([document.fonts.load(`40px ${HAND}`), new Promise((r) => setTimeout(r, 1500))]);
      } catch {
        /* the fallback font is fine */
      }
      const el = canvas.current;
      if (dead || !el) return;
      try {
        const mod = await import("./diary-3d");
        if (dead) return;
        const sc = new mod.DiaryScene(el, { hand: HAND, pet, reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches, onSpread: setInfo });
        scene.current = sc;
        const fit = () => sc.resize(wrap.current?.clientWidth ?? 0, wrap.current?.clientHeight ?? 0);
        fit();
        ro = new ResizeObserver(fit);
        if (wrap.current) ro.observe(wrap.current);
        setReady(true);
      } catch (e) {
        console.error("diary:", e);
        if (!dead) setError("This device can't show the 3D book.");
      }
    })();
    return () => {
      dead = true;
      ro?.disconnect();
      scene.current?.dispose();
      scene.current = null;
    };
  }, [pet]);

  // Older days, fetched when the book needs them (near its first page, or for a calendar jump).
  const fetchMore = useCallback(() => {
    const oldest = data?.entries[data.entries.length - 1]?.date;
    if (!data || !oldest || loadingMore.current || data.entries.length >= data.dates.length) return false;
    loadingMore.current = true;
    fetch(`/api/diary?before=${oldest}`)
      .then((r) => r.json() as Promise<Data>)
      .then((j) => j.entries && setData((d) => (d ? { ...d, entries: [...d.entries, ...j.entries.filter((e) => !d.entries.some((x) => x.date === e.date))] } : d)))
      .catch(() => (pendingJump.current = null))
      .finally(() => {
        loadingMore.current = false;
      });
    return true;
  }, [data]);

  // Hand the pages to the book: the first time it opens (cover, then the pages fan to today); later it stays where it is.
  useEffect(() => {
    const sc = scene.current;
    if (!ready || !sc || !pages.length) return;
    if (!opened.current) {
      opened.current = true;
      sc.setPages(pages, { open: true });
    } else if (reveal.current) {
      const key = reveal.current;
      reveal.current = null;
      sc.setPages(pages, { goKey: key, reveal: key });
    } else {
      sc.setPages(pages, { keepKey: info?.right ?? info?.left ?? undefined });
    }
    // A calendar jump to a day that had to be fetched first.
    const want = pendingJump.current;
    if (want) {
      if (sc.goToKey(want)) pendingJump.current = null;
      else if (!fetchMore()) pendingJump.current = null;
    }
    // `info` is read only to keep the page in view when older days arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, ready]);

  // Near the oldest page loaded: fetch the days before it.
  useEffect(() => {
    if (info && info.spread <= 3) fetchMore();
  }, [info, fetchMore]);

  // The controls fade a few seconds after the last touch, so the page is never covered.
  const wake = useCallback(() => {
    setAwake(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setAwake(false), 4500);
  }, []);
  useEffect(() => {
    idleTimer.current = setTimeout(() => setAwake(false), 4500);
    const t = setTimeout(() => setHint(false), 9000);
    return () => {
      clearTimeout(t);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  const go = useCallback((by: number) => (by > 0 ? scene.current?.next() : scene.current?.prev()), []);

  useEffect(() => {
    // In the capture phase, and swallowed: the garden behind the book also listens for arrow keys (it would turn its camera).
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      wake();
      if (e.key === "Escape") {
        if (cal) setCal(false);
        else onClose();
      } else go(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [go, onClose, cal, wake]);

  async function writeToday() {
    setWriting(true);
    scene.current?.setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/diary", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = (await r.json()) as { entry?: DiaryEntry; error?: string };
      if (!j.entry) throw new Error(j.error ?? "");
      const entry = j.entry;
      // The page list changes (the empty page becomes today's), and the new page is written out stroke by stroke.
      reveal.current = entry.date;
      setData((d) => (d ? { ...d, dates: d.dates.includes(entry.date) ? d.dates : [entry.date, ...d.dates], entries: [entry, ...d.entries.filter((e) => e.date !== entry.date)] } : d));
    } catch {
      setError(`${pet} couldn't write just now. Try again in a moment.`);
    } finally {
      scene.current?.setBusy(false);
      setWriting(false);
    }
  }

  /** Turns to a day from the calendar (fetching older days first if the book doesn't hold it yet). */
  function jump(date: string) {
    setCal(false);
    wake();
    if (scene.current?.goToKey(date)) return;
    pendingJump.current = date;
    if (!fetchMore()) pendingJump.current = null;
  }

  const current = isDate(info?.right ?? null) ? (info?.right ?? null) : isDate(info?.left ?? null) ? (info?.left ?? null) : null;
  const showWrite = !!info && (info.left === "write" || info.right === "write");
  const atNewest = !info || info.spread >= info.max;
  const progress = info && info.max > 0 ? Math.min(1, info.spread / info.max) : 0;

  // The calendar opens on the month of the page in view (or today's month).
  const shown =
    month ??
    (() => {
      const d = new Date(`${current ?? data?.today ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`);
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    })();

  // A portal to the page, so nothing in the garden (its cards, the mic button, the nav bar) can sit on top of the book.
  return createPortal(
    <div
      ref={wrap}
      onPointerMove={wake}
      onPointerDown={wake}
      className="fixed inset-0 z-[300] overflow-hidden bg-[radial-gradient(ellipse_at_center,rgba(20,14,10,0.78),rgba(6,4,3,0.92))]"
      role="dialog"
      aria-label={`${pet}'s diary`}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full touch-none select-none" aria-hidden />

      {/* The same pages as text, for screen readers. */}
      <ol className="sr-only">
        {data?.entries.map((e) => (
          <li key={e.date}>
            {short(e.date)}: {e.text}
          </li>
        ))}
      </ol>

      {!ready && !error && <p className="absolute inset-0 grid place-items-center text-sm text-white/70">Opening the book…</p>}
      {error && <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-2xl bg-black/60 px-4 py-3 text-center text-sm text-rose-200">{error}</p>}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <p className="rounded-full bg-black/40 px-3.5 py-2 text-xs font-medium tracking-wide text-amber-100 backdrop-blur-md">📖 {pet}&apos;s diary</p>
        <button onClick={onClose} aria-label="Close the diary" className={`${BTN} pointer-events-auto`}>
          ✕
        </button>
      </div>

      {showWrite && (
        <div className="absolute inset-x-0 bottom-36 flex justify-center">
          <button
            onClick={() => void writeToday()}
            disabled={writing}
            className="min-h-11 rounded-full bg-gradient-to-b from-[#b4463d] to-[#8a352f] px-5 py-2.5 text-sm font-semibold text-[#fff4df] shadow-xl ring-1 ring-amber-200/30 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 active:scale-95 disabled:opacity-60"
          >
            {writing ? `${pet} is writing…` : "✍️ Write today's page"}
          </button>
        </div>
      )}

      {/* The dock: calendar, progress, page buttons. It fades while you read. */}
      <div className={`absolute inset-x-0 bottom-4 flex flex-col items-center gap-2.5 px-3 transition-opacity duration-500 ${awake || cal ? "opacity-100" : "opacity-30 focus-within:opacity-100 hover:opacity-100"}`}>
        {hint && ready && <p className="pointer-events-none rounded-full bg-black/45 px-3 py-1.5 text-center text-[11px] text-white/85 backdrop-blur-md">Drag a page, or tap its edge, to turn · tap the middle to zoom in</p>}

        {cal && data && <Calendar year={shown.y} month={shown.m} today={data.today} current={current} moods={moods} all={data.dates} onMonth={(y, m) => setMonth({ y, m })} onPick={jump} />}

        <div className="flex items-center gap-2.5">
          <button onClick={() => go(-1)} disabled={!info || info.spread <= 0} aria-label="Previous page" className={BTN}>
            ‹
          </button>
          <button
            onClick={() => {
              setMonth(null);
              setCal((v) => !v);
            }}
            aria-expanded={cal}
            aria-label="Open the calendar"
            className="flex h-11 min-w-[10.5rem] items-center justify-center gap-2 rounded-full bg-black/45 px-4 text-xs font-medium text-amber-100 backdrop-blur-md transition hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 active:scale-95"
          >
            <span aria-hidden>📅</span>
            {current ? short(current) : "Nova's diary"}
          </button>
          <button onClick={() => go(1)} disabled={!info || info.spread >= info.max} aria-label="Next page" className={BTN}>
            ›
          </button>
          {!atNewest && (
            <button
              onClick={() => scene.current?.goToKey(pages.findLast((p) => p.kind !== "blank")?.key ?? "")}
              className="h-11 rounded-full bg-amber-200/90 px-4 text-xs font-semibold text-[#3b2f1e] shadow transition hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-95"
            >
              Today ›
            </button>
          )}
        </div>

        <div className="h-1 w-[min(15rem,70vw)] overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="Where you are in the diary" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="h-full rounded-full bg-amber-200/80 transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A month grid: a day with a page shows its mood and can be opened; today has a ring, the page in view is filled. */
function Calendar({
  year,
  month,
  today,
  current,
  moods,
  all,
  onMonth,
  onPick,
}: {
  year: number;
  month: number;
  today: string;
  current: string | null;
  moods: Map<string, string>;
  all: string[];
  onMonth: (y: number, m: number) => void;
  onPick: (date: string) => void;
}) {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const has = new Set(all);
  const title = first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const step = (by: number) => {
    const d = new Date(Date.UTC(year, month + by, 1));
    onMonth(d.getUTCFullYear(), d.getUTCMonth());
  };
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div className="w-[min(19rem,92vw)] rounded-3xl border border-white/12 bg-[#120d09]/90 p-3 text-white shadow-2xl backdrop-blur-xl" role="group" aria-label={`Calendar, ${title}`}>
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => step(-1)} aria-label="Previous month" className="grid h-11 w-11 place-items-center rounded-full text-lg hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-200">
          ‹
        </button>
        <p className="text-sm font-semibold text-amber-100">{title}</p>
        <button onClick={() => step(1)} aria-label="Next month" className="grid h-11 w-11 place-items-center rounded-full text-lg hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-200">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-white/55">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((n, i) => {
          if (n == null) return <span key={`b${i}`} />;
          const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
          const written = has.has(date);
          const sel = date === current;
          return (
            <button
              key={date}
              disabled={!written}
              onClick={() => onPick(date)}
              aria-label={`${short(date)}${written ? ", has a page" : ""}`}
              aria-current={sel ? "date" : undefined}
              className={`relative grid aspect-square min-h-9 place-items-center rounded-xl text-xs transition focus-visible:outline-2 focus-visible:outline-amber-200 ${sel ? "bg-amber-200 font-semibold text-[#3b2f1e]" : written ? "bg-white/10 text-white hover:bg-white/20" : "text-white/30"} ${date === today ? "ring-1 ring-amber-200/80" : ""}`}
            >
              {written && !sel ? <span className="text-base leading-none">{moods.get(date) ?? "•"}</span> : n}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[10px] text-white/50">Days with a mood have a page. Tap one to open it.</p>
    </div>
  );
}
