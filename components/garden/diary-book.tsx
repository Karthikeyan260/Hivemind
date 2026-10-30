"use client";

import { Caveat } from "next/font/google";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DiaryEntry } from "@/lib/nova-diary";
import type { DiaryPage, DiaryScene, SpreadInfo } from "./diary-3d";

/**
 * Nova's diary as a book you hold: a real 3D book (see diary-3d.ts) whose cover opens and whose pages bend as they
 * turn. Drag a page corner, tap the outer edge of a page to turn it, tap the middle of a page to zoom in and read it,
 * or use the arrows / arrow keys. Today's page is written at 10 pm, or on the spot with the button.
 */
const caveat = Caveat({ subsets: ["latin"], display: "swap" });
// Handwriting for English; the system's own fonts take over for Tamil and anything else.
const HAND = `${caveat.style.fontFamily}, "Noto Sans Tamil", "Nirmala UI", "Latha", cursive`;

type Data = { today: string; dates: string[]; entries: DiaryEntry[] };

const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

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
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<SpreadInfo | null>(null);
  const [writing, setWriting] = useState(false);
  const [hint, setHint] = useState(true);
  const pages = useMemo(() => buildPages(data), [data]);

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
    // `info` is read only to keep the page in view when older days arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, ready]);

  // Near the oldest page loaded: fetch the days before it.
  useEffect(() => {
    if (!info || !data || loadingMore.current || info.spread > 3 || data.entries.length >= data.dates.length) return;
    const oldest = data.entries[data.entries.length - 1]?.date;
    if (!oldest) return;
    loadingMore.current = true;
    fetch(`/api/diary?before=${oldest}`)
      .then((r) => r.json() as Promise<Data>)
      .then((j) => j.entries && setData((d) => (d ? { ...d, entries: [...d.entries, ...j.entries.filter((e) => !d.entries.some((x) => x.date === e.date))] } : d)))
      .catch(() => {})
      .finally(() => {
        loadingMore.current = false;
      });
  }, [info, data]);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, []);

  const go = useCallback((by: number) => (by > 0 ? scene.current?.next() : scene.current?.prev()), []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go, onClose]);

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

  const pageDate = (key: string | null) => (key && /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null);
  const label = pageDate(info?.right ?? null) ?? pageDate(info?.left ?? null);
  const showWrite = !!info && (info.left === "write" || info.right === "write");

  // A portal to the page, so nothing in the garden (its cards, the mic button, the nav bar) can sit on top of the book.
  return createPortal(
    <div ref={wrap} className="fixed inset-0 z-[300] overflow-hidden bg-[radial-gradient(ellipse_at_center,rgba(20,14,10,0.78),rgba(6,4,3,0.92))]" role="dialog" aria-label={`${pet}'s diary`}>
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
        <p className="rounded-full bg-black/35 px-3 py-1.5 text-xs font-medium tracking-wide text-amber-100/90 backdrop-blur-sm">📖 {pet}&apos;s diary</p>
        <button onClick={onClose} aria-label="Close the diary" className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-white/12 text-white/90 backdrop-blur-sm transition hover:bg-white/25">
          ✕
        </button>
      </div>

      {showWrite && (
        <div className="absolute inset-x-0 bottom-24 flex justify-center">
          <button onClick={() => void writeToday()} disabled={writing} className="rounded-full bg-gradient-to-b from-[#b4463d] to-[#8a352f] px-5 py-2.5 text-sm font-semibold text-[#fff4df] shadow-xl ring-1 ring-amber-200/30 transition active:scale-95 disabled:opacity-60">
            {writing ? `${pet} is writing…` : "✍️ Write today's page"}
          </button>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-5 flex flex-col items-center gap-2">
        {hint && ready && <p className="pointer-events-none rounded-full bg-black/40 px-3 py-1 text-[11px] text-white/80 backdrop-blur-sm">Drag a page, or tap its edge, to turn · tap the middle to zoom in</p>}
        <div className="flex items-center gap-3">
          <button onClick={() => go(-1)} disabled={!info || info.spread <= 0} aria-label="Previous page" className="grid h-10 w-10 place-items-center rounded-full bg-white/12 text-lg text-white backdrop-blur-sm transition active:scale-90 disabled:opacity-25">
            ‹
          </button>
          <span className="min-w-[8.5rem] rounded-full bg-black/35 px-3 py-1.5 text-center text-xs text-amber-100/90 backdrop-blur-sm">{label ? short(label) : "Nova's diary"}</span>
          <button onClick={() => go(1)} disabled={!info || info.spread >= info.max} aria-label="Next page" className="grid h-10 w-10 place-items-center rounded-full bg-white/12 text-lg text-white backdrop-blur-sm transition active:scale-90 disabled:opacity-25">
            ›
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
