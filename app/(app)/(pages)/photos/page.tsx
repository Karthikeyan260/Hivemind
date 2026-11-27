"use client";

import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Lock, MapPin, Pencil, Search, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CardSkeleton, cx, Empty, ErrorText, Input, PageHeader } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { api, useFetch } from "@/lib/client-api";
import { uploadPhotos } from "@/lib/photo-prep";
import type { Photo } from "@/lib/photos";

type Feed = { photos: Photo[]; total: number };
const IDEAS = ["birthday", "beach", "food", "selfie", "temple", "last December"];
const TZ = "Asia/Kolkata";
const when = (p: Photo) => new Date(p.taken).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
/** The photo date as YYYY-MM-DD in Chennai (an ISO string sliced is the UTC date). */
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

export default function PhotosPage() {
  return (
    <Suspense>
      <Photos />
    </Suspense>
  );
}

/** Photo memories: add photos, then find them by what's in them, where and when. */
function Photos() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const feed = useFetch<Feed>(`/api/photos${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  // The open photo by id: uploads add photos at the top, so a position would point at another photo.
  const [openId, setOpenId] = useState<string | null>(null);
  const [priv, setPriv] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photos = useMemo(() => feed.data?.photos ?? [], [feed.data]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the box follows the address (voice, back button)
    setText(q);
  }, [q]);
  const search = (v: string) => router.replace(v.trim() ? `/photos?q=${encodeURIComponent(v.trim())}` : "/photos");

  async function add(files: File[]) {
    if (!files.some((f) => f.type.startsWith("image/"))) return;
    setError(null);
    setProgress({ done: 0, total: Math.min(30, files.filter((f) => f.type.startsWith("image/")).length), failed: 0 });
    await uploadPhotos(files, {
      private: priv,
      onProgress: (done, total, failed, err) => {
        setProgress({ done, total, failed });
        if (err) setError(err);
      },
    });
    await feed.reload();
    setTimeout(() => setProgress(null), 2500);
  }

  async function remove(p: Photo, asked = false) {
    if (!asked && !confirm(`Delete "${p.title}" from HIVEMIND? (The original stays in your gallery.)`)) return;
    await fetch(`/api/photos?id=${p.id}`, { method: "DELETE" });
    setOpen(null);
    await feed.reload();
  }

  useVoiceActions({
    photos_search: {
      description: "Photos page: show the owner's photos matching a request (input: what to look for, e.g. 'Ooty trip', 'birthday cake', 'beach last December'; empty = all).",
      run: async ({ input }) => {
        const v = String(input ?? "").trim();
        search(v);
        const r = await fetch(`/api/photos${v ? `?q=${encodeURIComponent(v)}` : ""}`).then((x) => x.json() as Promise<Feed>);
        return { found: r.photos.length, photos: r.photos.slice(0, 5).map((p) => ({ title: p.title, taken: when(p), place: p.place })) };
      },
    },
    photos_open: {
      description: "Photos page: open a photo full screen (input: its number in the grid, 1 = first).",
      run: ({ input }) => {
        const n = Number(input) - 1;
        if (!(n >= 0 && n < photos.length)) return { error: `There are ${photos.length} photos showing.` };
        setOpen(n);
        return { opened: photos[n].title };
      },
    },
    photos_browse: {
      description: "Photos page: in the open photo, go to the 'next' or 'previous' one, or 'close' it. Also says what the photo shows.",
      run: ({ input }) => {
        const t = String(input ?? "").toLowerCase();
        if (/close|back|exit/.test(t)) return setOpen(null), { closed: true };
        if (open === null) return { error: "No photo is open: open one first (photos_open)." };
        const n = /prev|before|back/.test(t) ? open - 1 : open + 1;
        if (n < 0 || n >= photos.length) return { error: "That was the last one." };
        setOpen(n);
        const p = photos[n];
        return { now_showing: p.title, about: p.description, taken: p.hasTakenDate ? when(p) : "unknown", place: p.place };
      },
    },
    photos_edit: {
      description: "Photos page: fix the open photo's title, date or place (e.g. a WhatsApp photo with no date). input: what to set, e.g. 'place Ooty', 'date 2025-12-21', 'title Family at the lake'.",
      run: async ({ input }) => {
        if (!cur) return { error: "Open the photo first (photos_open)." };
        const t = String(input ?? "");
        const date = t.match(/\d{4}-\d{2}-\d{2}/)?.[0];
        const place = t.match(/place\s+(?:is\s+|to\s+)?(.+?)(?:,|$| date| title)/i)?.[1]?.trim();
        const title = t.match(/title\s+(?:is\s+|to\s+)?(.+?)(?:,|$| date| place)/i)?.[1]?.trim();
        if (!date && !place && !title) return { error: "Say what to set: 'place Ooty', 'date 2025-12-21' or 'title …'." };
        await api("/api/photos", { method: "PATCH", json: { id: cur.id, ...(date ? { taken: date } : {}), ...(place ? { place } : {}), ...(title ? { title } : {}) } });
        await feed.reload();
        return { saved: { date, place, title } };
      },
    },
    photos_delete: {
      description: "Photos page: delete the open photo from HIVEMIND (the original stays in the gallery). First call without input to get its title and ASK the owner; call again with input 'yes' only after they clearly confirm.",
      run: async ({ input }) => {
        if (!cur) return { error: "Open the photo first (photos_open)." };
        if (progress && progress.done < progress.total) return { error: "Wait for the upload to finish." };
        if (!/^\s*yes\b/i.test(String(input ?? ""))) return { confirm: `Delete "${cur.title}"? Ask the owner, then call again with 'yes'.` };
        await remove(cur, true);
        return { deleted: cur.title };
      },
    },
  });

  const found = openId ? photos.findIndex((p) => p.id === openId) : -1;
  const open = found >= 0 ? found : null;
  const setOpen = (i: number | null) => setOpenId(i === null ? null : (photos[i]?.id ?? null));
  const cur = open !== null ? photos[open] : null;
  // Keys in the viewer: Escape closes, ← / → move (not while typing in its edit form: that would throw the draft away).
  useEffect(() => {
    if (openId === null) return;
    const keys = (e: KeyboardEvent) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement | null)?.tagName ?? "")) return;
      const i = photos.findIndex((p) => p.id === openId);
      if (e.key === "Escape") setOpenId(null);
      else if (e.key === "ArrowRight" && i >= 0 && i < photos.length - 1) setOpenId(photos[i + 1].id);
      else if (e.key === "ArrowLeft" && i > 0) setOpenId(photos[i - 1].id);
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [openId, photos]);

  // The full photo takes a moment: show its (already loaded) thumbnail and a spinner until it arrives.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  // Phones: swipe left / right to move between photos.
  const touchX = useRef<number | null>(null);
  // Photos grouped by the month they were taken (unknown dates go by when they were added).
  const months = photos.reduce<{ key: string; label: string; places: string[]; items: { p: Photo; i: number }[] }[]>((out, p, i) => {
    const d = new Date(p.taken);
    const key = d.toLocaleDateString("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" });
    let g = out.find((x) => x.key === key);
    if (!g) out.push((g = { key, label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: TZ }), places: [], items: [] }));
    if (p.place && !g.places.includes(p.place)) g.places.push(p.place);
    g.items.push({ p, i });
    return out;
  }, []);

  // Fix a photo's title, date or place (photos from WhatsApp arrive without them).
  const [draft, setDraft] = useState<{ title: string; taken: string; place: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a different photo closes the form
    setDraft(null);
  }, [openId]);
  async function saveEdit(p: Photo) {
    if (!draft) return;
    setSaving(true);
    try {
      // The date only when it was changed: re-sending it would mark an unknown date as known.
      await api("/api/photos", { method: "PATCH", json: { id: p.id, title: draft.title, place: draft.place, ...(draft.taken !== (p.hasTakenDate ? dayOf(p.taken) : "") ? { taken: draft.taken } : {}) } });
      setDraft(null);
      await feed.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Memories"
        title="Photos"
        subtitle="Add photos and HIVEMIND describes them and notes where and when they were taken, so you can find them later: “Ooty trip”, “the birthday cake”, “beach last December”. The originals stay in your gallery."
        actions={
          <>
            <label
              className={cx(
                "flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors",
                priv ? "border-core/50 bg-core/10 text-core" : "border-line text-soft hover:text-fg",
              )}
              title="Kept and found by date or place only; never sent to the AI"
            >
              <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="size-4 accent-[var(--core)]" />
              <Lock size={13} /> Private <span className="hidden sm:inline">(don&apos;t describe)</span>
            </label>
            <label className={cx("inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md bg-core px-4 text-sm font-medium text-core-ink transition hover:bg-core/85", progress && progress.done < progress.total && "pointer-events-none opacity-50")}>
              <ImagePlus size={15} /> Add photos
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  // Cleared only after the photos are read: clearing at once can make Android drop them.
                  const el = e.target;
                  void add([...(el.files ?? [])]).finally(() => (el.value = ""));
                }}
              />
            </label>
          </>
        }
      />

      {progress && (
        <div className="mb-4 rounded-xl border border-line bg-panel p-3 text-sm">
          <div className="mb-1.5 flex items-center gap-2">
            {progress.done < progress.total ? <Loader2 size={14} className="animate-spin text-core" /> : null}
            {progress.done < progress.total ? `Adding and describing ${progress.done + 1} of ${progress.total}…` : `Added ${progress.total - progress.failed} of ${progress.total}.`}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full bg-core transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}
      <ErrorText error={error ?? feed.error} />

      <form
        className="relative mb-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(text);
        }}
      >
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find photos… e.g. “Ooty trip”" className="pl-9 pr-9" />
        {q && (
          <button type="button" aria-label="Clear" onClick={() => search("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-faint hover:text-fg">
            <X size={15} />
          </button>
        )}
      </form>
      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-soft">
        {q ? (
          <span>
            {photos.length} {photos.length === 1 ? "photo" : "photos"} for “{q}”
          </span>
        ) : (
          <>
            {feed.data && <span className="mr-1">{feed.data.total} photos ·</span>}
            {IDEAS.map((x) => (
              <button key={x} type="button" onClick={() => search(x)} className="h-8 rounded-full border border-line px-3 text-[13px] transition-colors hover:border-data hover:text-data pointer-coarse:h-9">
                {x}
              </button>
            ))}
          </>
        )}
      </div>

      {!feed.data ? (
        <CardSkeleton count={12} grid />
      ) : !photos.length ? (
        <Empty>{q ? "Nothing matches. Try other words, a place or a month." : "No photos yet. Tap Add photos, or share photos from your gallery to HIVEMIND."}</Empty>
      ) : (
        <div className="space-y-6">
          {months.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2 px-0.5">
                <span className="text-sm font-medium">{g.label}</span>
                <span className="text-xs text-faint tabular-nums">{g.items.length}</span>
                {g.places.length > 0 && (
                  <span className="flex min-w-0 items-center gap-1 text-xs text-soft">
                    <MapPin size={11} className="shrink-0" /> <span className="truncate">{g.places.slice(0, 3).join(", ")}</span>
                  </span>
                )}
              </h2>
        <ul className="list-in grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
          {g.items.map(({ p, i }) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(i)} className="group relative block aspect-square w-full overflow-hidden rounded-md bg-raised" title={p.title}>
                {/* Shimmer until the thumbnail arrives (it covers this when loaded). */}
                <span aria-hidden className="absolute inset-0 animate-pulse bg-raised" />
                {/* eslint-disable-next-line @next/next/no-img-element -- private photo served by the app */}
                <img
                  src={(p as { thumb?: string }).thumb ?? `/api/photos/${p.id}?t=1`}
                  // The direct link lasts an hour: if it has run out, load it through the app instead.
                  onError={(e) => {
                    const fallback = `/api/photos/${p.id}?t=1`;
                    if (!e.currentTarget.src.endsWith(fallback)) e.currentTarget.src = fallback;
                  }}
                  alt={p.title}
                  loading="lazy" className="relative h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                {p.private && <Lock size={12} className="absolute right-1.5 top-1.5 text-white drop-shadow" />}
              </button>
            </li>
          ))}
        </ul>
            </section>
          ))}
        </div>
      )}

      {cur && open !== null && (
        // solid, not see-through: the page (and the "Your day" card) used to show behind the photo
        <div className="fixed inset-0 z-[70] flex flex-col bg-[oklch(0.1_0.008_250)]" role="dialog" aria-modal="true" aria-label={cur.title}>
          <div className="flex items-center gap-2 p-3 text-white">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{cur.title}</span>
            <span className="shrink-0 text-xs text-white/50 tabular-nums">
              {open + 1} / {photos.length}
            </span>
            <button type="button" onClick={() => void remove(cur)} disabled={!!progress && progress.done < progress.total} title={progress && progress.done < progress.total ? "Wait for the upload to finish" : "Delete"} aria-label="Delete photo" className="p-2 text-white/70 hover:text-alert disabled:opacity-30">
              <Trash2 size={18} />
            </button>
            <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="p-2 text-white/80 hover:text-white">
              <X size={20} />
            </button>
          </div>
          <div
            className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center"
            onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              const start = touchX.current;
              touchX.current = null;
              if (start === null) return;
              const dx = e.changedTouches[0].clientX - start;
              if (dx < -50 && open < photos.length - 1) setOpen(open + 1);
              else if (dx > 50 && open > 0) setOpen(open - 1);
            }}
          >
            {/* the thumbnail (already loaded in the grid), blurred, until the full photo arrives */}
            {loadedId !== cur.id && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- private photo served by the app */}
                <img src={(cur as { thumb?: string }).thumb ?? `/api/photos/${cur.id}?t=1`} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-105 object-contain opacity-70 blur-md" />
                <Loader2 size={26} className="absolute animate-spin text-white/70" aria-label="Loading photo" />
              </>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element -- private photo served by the app */}
            <img
              key={cur.id}
              src={`/api/photos/${cur.id}`}
              alt={cur.title}
              onLoad={() => setLoadedId(cur.id)}
              className={cx("absolute inset-0 h-full w-full object-contain transition-opacity duration-200", loadedId === cur.id ? "opacity-100" : "opacity-0")}
            />
            {/* the neighbours load in the background, so next / previous are instant */}
            <div hidden aria-hidden>
              {[photos[open - 1], photos[open + 1]].filter(Boolean).map((n) => (
                // eslint-disable-next-line @next/next/no-img-element -- preload only
                <img key={n.id} src={`/api/photos/${n.id}`} alt="" />
              ))}
            </div>
            {open > 0 && (
              <button type="button" onClick={() => setOpen(open - 1)} aria-label="Previous photo" className="absolute left-2 grid size-11 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20">
                <ChevronLeft size={22} />
              </button>
            )}
            {open < photos.length - 1 && (
              <button type="button" onClick={() => setOpen(open + 1)} aria-label="Next photo" className="absolute right-2 grid size-11 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20">
                <ChevronRight size={22} />
              </button>
            )}
          </div>
          <div className="max-h-[35dvh] overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-white/85">
            {draft ? (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveEdit(cur);
                }}
              >
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={80} placeholder="Title" aria-label="Title" className="w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm text-white" />
                <div className="flex gap-2">
                  <input type="date" value={draft.taken} onChange={(e) => setDraft({ ...draft, taken: e.target.value })} aria-label="Date taken" className="rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm text-white [color-scheme:dark]" />
                  <input value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} maxLength={80} placeholder="Place, e.g. Ooty" aria-label="Place" className="min-w-0 flex-1 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm text-white" />
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={saving} className="rounded-md bg-core px-4 py-1.5 text-sm font-semibold text-core-ink disabled:opacity-50">
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={() => setDraft(null)} className="rounded-md border border-white/20 px-4 py-1.5 text-sm">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
                <span>{cur.hasTakenDate ? when(cur) : `Added ${when(cur)} · date unknown`}</span>
                {cur.place ? (
                  <span className="flex items-center gap-1">
                    <MapPin size={12} /> {cur.place}
                  </span>
                ) : (
                  <span>· place unknown</span>
                )}
                <button
                  type="button"
                  onClick={() => setDraft({ title: cur.title, taken: cur.hasTakenDate ? dayOf(cur.taken) : "", place: cur.place ?? "" })}
                  className="ml-auto flex items-center gap-1 rounded-full border border-white/25 px-2.5 py-0.5 text-white/80 hover:border-white/60"
                >
                  <Pencil size={11} /> {cur.hasTakenDate && cur.place ? "Edit" : "Add date / place"}
                </button>
              </div>
            )}
            {cur.description && <p className="mt-1.5 leading-relaxed">{cur.description}</p>}
            {!!cur.tags.length && (
              <div className="mt-2 flex flex-wrap gap-1">
                {cur.tags.map((t) => (
                  <button key={t} type="button" onClick={() => (setOpen(null), search(t))} className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] hover:border-white/50">
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
