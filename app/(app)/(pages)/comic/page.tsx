"use client";

import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Share2, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { frameCell, MascotFrame, type MascotFrameName } from "@/components/mascot";
import { Button, cx, ErrorText, PageHeader } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { api, useFetch } from "@/lib/client-api";

type Panel = { frame: MascotFrameName; caption: string; bubble: string; mood: "calm" | "happy" | "busy" | "tired" | "proud" | "oops" };
type Comic = { date: string; title: string; panels: Panel[]; made_at: string; events: number };
type Feed = { date: string; today: string; comic: Comic | null; dates: string[] };

// Each mood gets its own panel colour (light comic-book tints behind the dark-outlined mascot).
const MOOD: Record<Panel["mood"], { bg: string; dot: string }> = {
  calm: { bg: "#cfe8ff", dot: "#a9d2fb" },
  happy: { bg: "#ffe9a8", dot: "#ffd86b" },
  busy: { bg: "#ffd2c2", dot: "#ffb49b" },
  tired: { bg: "#ddd6f3", dot: "#c4b8ec" },
  proud: { bg: "#c9f2d4", dot: "#9fe6b3" },
  oops: { bg: "#ffc9d6", dot: "#ffa3b8" },
};

const pretty = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const shift = (d: string, by: number) => {
  const t = new Date(`${d}T12:00:00`);
  t.setDate(t.getDate() + by);
  return t.toLocaleDateString("en-CA");
};

/** Your day as a comic: four panels starring your mascot, drawn from what happened that day. */
export default function ComicPage() {
  return (
    <Suspense>
      <ComicDay />
    </Suspense>
  );
}

function ComicDay() {
  const asked = useSearchParams().get("date");
  const [date, setDate] = useState<string | null>(asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null);
  const feed = useFetch<Feed>(`/api/comic${date ? `?date=${date}` : ""}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = feed.data;
  const day = d?.date ?? date;
  const comic = d?.comic ?? null;

  async function make() {
    if (!day) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ comic: Comic }>("/api/comic", { method: "POST", json: { date: day } });
      feed.setData((x) => (x ? { ...x, comic: r.comic, dates: x.dates.includes(day) ? x.dates : [day, ...x.dates] } : x));
      return r.comic;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // The picture is drawn ahead, so Share runs straight from the tap (iPhone refuses a share that
  // starts after a wait).
  const png = useRef<{ key: string; blob: Blob } | null>(null);
  useEffect(() => {
    if (!comic) return;
    const key = comic.made_at;
    if (png.current?.key === key) return;
    void renderPng(comic)
      .then((blob) => (png.current = { key, blob }))
      .catch(() => {});
  }, [comic]);

  async function share() {
    if (!comic) return;
    try {
      const blob = png.current?.key === comic.made_at ? png.current.blob : await renderPng(comic);
      const file = new File([blob], `hivemind-comic-${comic.date}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: comic.title });
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Couldn't make the picture.");
    }
  }

  useVoiceActions({
    comic_make: {
      description: "Comic page: draw (or redraw) the comic of the day on screen from what happened that day.",
      run: async () => {
        const c = await make();
        return c ? { title: c.title, panels: c.panels.map((p) => p.bubble) } : { error: "Not enough happened that day yet." };
      },
    },
    comic_share: {
      description: "Comic page: share the comic as a picture (WhatsApp status etc.).",
      run: async () => {
        await share();
        return { shared: true };
      },
    },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Daily"
        title="Your day as a comic"
        subtitle="HIVEMIND picks the four best moments of your day (chats, what it did for you, memories, habits, calls) and draws them with your mascot. A diary you never have to write."
      />

      {day && (
        <div className="mb-4 flex items-center gap-2">
          <Button size="sm" variant="quiet" aria-label="Previous day" onClick={() => setDate(shift(day, -1))}>
            <ChevronLeft size={15} />
          </Button>
          <span className="min-w-36 text-center font-mono text-xs text-soft">{day === d?.today ? "Today" : pretty(day)}</span>
          <Button size="sm" variant="quiet" aria-label="Next day" disabled={!!d && day >= d.today} onClick={() => setDate(shift(day, 1))}>
            <ChevronRight size={15} />
          </Button>
          <div className="ml-auto flex gap-2">
            {comic && (
              <Button size="sm" variant="quiet" onClick={share}>
                <Share2 size={13} /> Share
              </Button>
            )}
            <Button size="sm" onClick={make} disabled={busy}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : comic ? <RefreshCw size={13} /> : <Sparkles size={13} />} {comic ? "Redraw" : "Draw this day"}
            </Button>
          </div>
        </div>
      )}
      <ErrorText error={error ?? feed.error} />

      {busy && !comic && <p className="mb-4 flex items-center gap-2 text-sm text-soft"><Loader2 size={14} className="animate-spin text-core" /> Reading your day and sketching… about 5 seconds.</p>}

      {comic ? (
        <div className="rounded-sm border-4 border-black bg-white p-2 shadow-[6px_6px_0_0_rgba(0,0,0,0.6)] sm:p-3">
          <h2 className="mb-2 text-center font-black uppercase tracking-wide text-black sm:text-lg" style={{ fontFamily: "'Comic Sans MS','Comic Neue',ui-rounded,system-ui,sans-serif" }}>
            {comic.title}
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {comic.panels.map((p, i) => (
              <ComicPanel key={i} p={p} n={i + 1} />
            ))}
          </div>
          <p className="mt-2 text-right font-mono text-[9.5px] text-neutral-500">HIVEMIND · {pretty(comic.date)}</p>
        </div>
      ) : (
        d &&
        !busy && (
          <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-soft">
            <MascotFrame frame="up-right" size={120} className="mx-auto mb-3" />
            No comic for {day === d.today ? "today" : pretty(day!)} yet. Tap <b>Draw this day</b>.
            <p className="mt-1 text-xs text-faint">It works best in the evening, after you&apos;ve used HIVEMIND a bit during the day.</p>
          </div>
        )
      )}

      {!!d?.dates.length && (
        <div className="mt-6">
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-faint">Earlier comics</h3>
          <div className="flex flex-wrap gap-1.5">
            {d.dates.slice(0, 30).map((x) => (
              <button key={x} type="button" onClick={() => setDate(x)} className={cx("border px-2 py-1 font-mono text-[11px]", x === day ? "border-core text-core" : "border-line text-soft hover:border-data hover:text-data")}>
                {pretty(x)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ComicPanel({ p, n }: { p: Panel; n: number }) {
  const m = MOOD[p.mood];
  return (
    <div
      className="relative aspect-square overflow-hidden border-[3px] border-black"
      style={{ background: `radial-gradient(${m.dot} 1.2px, transparent 1.3px) 0 0/10px 10px, ${m.bg}` }}
    >
      {p.caption && (
        <div className="absolute left-0 top-0 z-10 max-w-[75%] border-b-[2.5px] border-r-[2.5px] border-black bg-[#fff36b] px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight text-black sm:text-[11px]">
          {p.caption}
        </div>
      )}
      <span className="absolute right-1.5 top-0.5 z-10 font-mono text-[9px] font-bold text-black/40">{n}</span>
      {/* Speech bubble with a tail pointing down at the mascot. */}
      <div className="absolute inset-x-[7%] top-[16%] z-10">
        <div className="relative rounded-[50%/40%] border-[2.5px] border-black bg-white px-2.5 py-1.5 text-center text-[10.5px] font-semibold leading-snug text-black sm:px-3.5 sm:py-2 sm:text-[13.5px]" style={{ fontFamily: "'Comic Sans MS','Comic Neue',ui-rounded,system-ui,sans-serif" }}>
          {p.bubble}
          <span className="absolute -bottom-[9px] left-1/2 size-3.5 -translate-x-1/2 rotate-45 border-b-[2.5px] border-r-[2.5px] border-black bg-white" />
        </div>
      </div>
      <div className="absolute inset-x-0 -bottom-[6%] flex justify-center">
        <MascotFrame frame={p.frame} size={0} className="!h-auto !w-[62%] aspect-square" />
      </div>
    </div>
  );
}

/* ───── the shareable picture (1080 × 1200 PNG) ───── */

const load = (src: string) =>
  new Promise<HTMLImageElement>((ok, no) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = no;
    i.src = src;
  });

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > max && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

async function renderPng(comic: Comic): Promise<Blob> {
  const W = 1080;
  const H = 1200;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const font = "'Comic Sans MS','Comic Neue',system-ui,sans-serif";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.font = `900 46px ${font}`;
  ctx.textAlign = "center";
  ctx.fillText(comic.title.toUpperCase(), W / 2, 72);

  const sheets: Record<string, HTMLImageElement> = {};
  const pad = 24;
  const size = (W - pad * 3) / 2;
  for (let i = 0; i < 4; i++) {
    const p = comic.panels[i];
    const x = pad + (i % 2) * (size + pad);
    const y = 110 + Math.floor(i / 2) * (size + pad);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();
    ctx.fillStyle = MOOD[p.mood].bg;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = MOOD[p.mood].dot;
    for (let dy = 0; dy < size; dy += 16) for (let dx = 0; dx < size; dx += 16) ctx.fillRect(x + dx, y + dy, 3, 3);

    const { sheet, index } = frameCell(p.frame);
    sheets[sheet] ??= await load(sheet);
    const cell = sheets[sheet].naturalWidth / 3;
    const m = size * 0.66;
    ctx.drawImage(sheets[sheet], (index % 3) * cell, Math.floor(index / 3) * cell, cell, cell, x + (size - m) / 2, y + size - m * 0.97, m, m);

    // Bubble
    ctx.font = `600 27px ${font}`;
    // An ellipse only fits text well inside its middle: keep lines narrow and the bubble roomy.
    const lines = wrap(ctx, p.bubble, size * 0.62);
    const bh = lines.length * 33 + 40;
    const bw = Math.min(size * 0.94, Math.max(...lines.map((l) => ctx.measureText(l).width)) * 1.3 + 30);
    const bx = x + (size - bw) / 2;
    const by = y + 62;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(bx + bw / 2, by + bh / 2, bw / 2, bh / 2 + 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + size / 2 - 12, by + bh + 2);
    ctx.lineTo(x + size / 2, by + bh + 26);
    ctx.lineTo(x + size / 2 + 12, by + bh + 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#000";
    lines.forEach((l, k) => ctx.fillText(l, x + size / 2, by + 43 + k * 33));

    // Caption box
    if (p.caption) {
      ctx.font = `800 22px ${font}`;
      ctx.textAlign = "left";
      const cw = ctx.measureText(p.caption.toUpperCase()).width + 20;
      ctx.fillStyle = "#fff36b";
      ctx.fillRect(x, y, cw, 36);
      ctx.strokeRect(x, y, cw, 36);
      ctx.fillStyle = "#000";
      ctx.fillText(p.caption.toUpperCase(), x + 10, y + 26);
      ctx.textAlign = "center";
    }
    ctx.restore();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#000";
    ctx.strokeRect(x, y, size, size);
  }
  ctx.font = `500 20px ui-monospace, monospace`;
  ctx.fillStyle = "#777";
  ctx.textAlign = "right";
  ctx.fillText(`HIVEMIND · ${pretty(comic.date)}`, W - pad, H - 22);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no image"))), "image/png"));
}
