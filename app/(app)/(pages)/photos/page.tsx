"use client";

import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Lock, MapPin, Search, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { cx, Empty, ErrorText, Input, PageHeader } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { useFetch } from "@/lib/client-api";
import { uploadPhotos } from "@/lib/photo-prep";
import type { Photo } from "@/lib/photos";

type Feed = { photos: Photo[]; total: number };
const IDEAS = ["birthday", "beach", "food", "selfie", "temple", "last December"];
const when = (p: Photo) => new Date(p.taken).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

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
  const [open, setOpen] = useState<number | null>(null);
  const [priv, setPriv] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photos = feed.data?.photos ?? [];

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

  async function remove(p: Photo) {
    if (!confirm(`Delete "${p.title}" from HIVEMIND? (The original stays in your gallery.)`)) return;
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
  });

  const cur = open !== null ? photos[open] : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Memories"
        title="Photos"
        subtitle="Add photos and HIVEMIND describes them and notes where and when they were taken, so you can find them later: “Ooty trip”, “the birthday cake”, “beach last December”. The originals stay in your gallery."
        actions={
          <>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-soft" title="Kept and found by date or place only; never sent to the AI">
              <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
              <Lock size={12} /> Private (don&apos;t describe)
            </label>
            <label className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-core px-3 py-2 text-sm font-medium text-core-ink", progress && progress.done < progress.total && "pointer-events-none opacity-50")}>
              <ImagePlus size={15} /> Add photos
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  void add([...(e.target.files ?? [])]);
                  e.target.value = "";
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
              <button key={x} type="button" onClick={() => search(x)} className="rounded-full border border-line px-2.5 py-0.5 hover:border-data hover:text-data">
                {x}
              </button>
            ))}
          </>
        )}
      </div>

      {!feed.data ? (
        <Empty>Loading…</Empty>
      ) : !photos.length ? (
        <Empty>{q ? "Nothing matches. Try other words, a place or a month." : "No photos yet. Tap Add photos, or share photos from your gallery to HIVEMIND."}</Empty>
      ) : (
        <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
          {photos.map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(i)} className="group relative block aspect-square w-full overflow-hidden rounded-md bg-raised" title={p.title}>
                {/* eslint-disable-next-line @next/next/no-img-element -- private photo served by the app */}
                <img src={`/api/photos/${p.id}?t=1`} alt={p.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                {p.private && <Lock size={12} className="absolute right-1.5 top-1.5 text-white drop-shadow" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {cur && open !== null && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={cur.title}>
          <div className="flex items-center gap-2 p-3 text-white">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{cur.title}</span>
            <button type="button" onClick={() => void remove(cur)} aria-label="Delete photo" className="p-2 text-white/70 hover:text-alert">
              <Trash2 size={18} />
            </button>
            <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="p-2 text-white/80 hover:text-white">
              <X size={20} />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- private photo served by the app */}
            <img key={cur.id} src={`/api/photos/${cur.id}`} alt={cur.title} className="absolute inset-0 h-full w-full object-contain" />
            {open > 0 && (
              <button type="button" onClick={() => setOpen(open - 1)} aria-label="Previous" className="absolute left-2 rounded-full bg-black/50 p-2 text-white">
                <ChevronLeft size={22} />
              </button>
            )}
            {open < photos.length - 1 && (
              <button type="button" onClick={() => setOpen(open + 1)} aria-label="Next" className="absolute right-2 rounded-full bg-black/50 p-2 text-white">
                <ChevronRight size={22} />
              </button>
            )}
          </div>
          <div className="max-h-[35dvh] overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-white/85">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
              <span>{cur.hasTakenDate ? when(cur) : `Added ${when(cur)}`}</span>
              {cur.place && (
                <span className="flex items-center gap-1">
                  <MapPin size={12} /> {cur.place}
                </span>
              )}
            </div>
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
