"use client";

import { Bell, Check, FileText, Image as ImageIcon, ImagePlus, Link2, Loader2, Paperclip, Share2, Smartphone, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Button, cx, ErrorText, PageHeader } from "@/components/ui";
import { api, BRAIN_CHANGED } from "@/lib/client-api";
import { uploadPhotos } from "@/lib/photo-prep";

type Saved = { kind: "memory" | "document"; title: string; href: string; note?: string; reminder?: { title: string; date: string; time?: string } };
type Result = Saved | { error: string };
type Inbox = { title: string; text: string; url: string; files: File[] };

const BOX = "hivemind-share";

/** What the service worker kept from Android's Share menu (kept until it's saved or discarded). */
async function readInbox(): Promise<Inbox | null> {
  if (!("caches" in window)) return null;
  const box = await caches.open(BOX);
  const meta = await box.match("/share-inbox/meta");
  if (!meta) return null;
  const m = (await meta.json()) as { title: string; text: string; url: string; files: { key: string; name: string; type: string }[] };
  const files: File[] = [];
  for (const f of m.files) {
    const r = await box.match(f.key);
    if (r) files.push(new File([await r.blob()], f.name || "shared", { type: f.type }));
  }
  return { title: m.title, text: m.text, url: m.url, files };
}
const clearInbox = () => ("caches" in window ? caches.delete(BOX).catch(() => false) : Promise.resolve(false));

// Vercel turns away requests over ~4.5 MB: stay under it.
const MAX_UPLOAD = 4_200_000;

/** Phone photos are big: send at most 1600 px (plenty for reading text), as JPEG. */
async function shrink(f: File): Promise<File> {
  if (!f.type.startsWith("image/") || f.type === "image/gif" || f.size < 600_000) return f;
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
    return blob ? new File([blob], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : f;
  } catch {
    return f;
  }
}

export default function SharePage() {
  return (
    <Suspense>
      <Share />
    </Suspense>
  );
}

function Share() {
  const params = useSearchParams();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [incoming, setIncoming] = useState<Inbox | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(params.get("error") ? "That share didn't come through. Share it to HIVEMIND once more." : null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  // a file being dragged over the box
  const [over, setOver] = useState(false);
  const addFiles = (list: FileList | File[]) => setFiles((cur) => [...cur, ...list].slice(0, 5));
  const started = useRef(false);

  async function save(item: Inbox) {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const form = new FormData();
      form.set("title", item.title);
      form.set("text", item.text);
      form.set("url", item.url);
      let total = 0;
      for (const f of item.files.slice(0, 5)) {
        const small = await shrink(f);
        total += small.size;
        if (total > MAX_UPLOAD) throw new Error("Those files are too big to send together (about 4 MB in all). Share fewer at a time.");
        form.append("files", small);
      }
      const r = await fetch("/api/share", { method: "POST", body: form });
      const j = (await r.json().catch(() => ({}))) as { error?: string; results?: Result[] };
      if (!r.ok) throw new Error(j.error ?? (r.status === 413 ? "That's too big to send. Share fewer files at a time." : "Couldn't save it. Try again."));
      setResults(j.results ?? []);
      // Saved: now the shared item can go.
      if (item === incoming) {
        await clearInbox();
        setIncoming(null);
      }
      setText("");
      setFiles([]);
      window.dispatchEvent(new Event(BRAIN_CHANGED));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Shared from another app: shown here, saved when the owner taps Save. (Not by itself: any website
  // could post a fake "share" to this page and plant something in the brain.)
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void readInbox().then((inbox) => inbox && setIncoming(inbox));
  }, []);

  // Gallery photos: into Photo memories (described, findable by place and date) instead of a memory.
  async function toPhotos(item: Inbox) {
    setBusy(true);
    setError(null);
    const { total, failed } = await uploadPhotos(item.files, { onProgress: (_d, _t, _f, err) => err && setError(err) });
    setBusy(false);
    if (failed < total) {
      void clearInbox();
      setIncoming(null);
      router.push("/photos");
    }
  }

  async function addReminder(i: number, r: NonNullable<Saved["reminder"]>) {
    await api("/api/reminders", { method: "POST", json: { title: r.title, date: r.date, time: r.time } });
    setAdded((s) => new Set(s).add(i));
  }

  const what = incoming && (incoming.files.length ? `${incoming.files.length} file${incoming.files.length > 1 ? "s" : ""}` : incoming.url || incoming.text.match(/https?:\/\/\S+/)?.[0] || incoming.text.slice(0, 80));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Share"
        title="Share to HIVEMIND"
        subtitle="Drop or paste anything here, or send it from any app on your phone. HIVEMIND reads it and files it where it belongs."
      />

      {incoming && (
        <div className="mb-4 rounded-xl border border-core/50 bg-panel p-3 text-sm">
          <div className="flex items-center gap-2 text-soft">
            <Share2 size={15} className="shrink-0 text-data" />
            <span className="min-w-0 flex-1 truncate">Shared: {what}</span>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => save(incoming)} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save to HIVEMIND
            </Button>
            {incoming.files.length > 0 && incoming.files.every((f) => f.type.startsWith("image/")) && (
              <Button variant="ghost" disabled={busy} onClick={() => void toPhotos(incoming)}>
                <ImagePlus size={14} /> Add to Photos
              </Button>
            )}
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                void clearInbox();
                setIncoming(null);
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      {busy && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-core/40 bg-panel p-4 text-sm">
          <Loader2 size={16} className="animate-spin text-core" /> Reading and filing it… usually 5-15 seconds.
        </div>
      )}
      <ErrorText error={error} />

      {results && (
        <ul className="list-in mb-6 space-y-2">
          {results.map((r, i) =>
            "error" in r ? (
              <li key={i} className="rounded-xl border border-alert/40 bg-panel p-3 text-sm text-alert">
                {r.error}
              </li>
            ) : (
              <li key={i} className="rounded-xl border border-ok/40 bg-panel p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Check size={15} className="shrink-0 text-ok" />
                  <span className="min-w-0 flex-1 truncate">
                    Saved to {r.kind === "document" ? "Documents" : "Memories"}: <span className="font-medium">{r.title}</span>
                  </span>
                  <Link href={r.href} className="font-mono text-[11px] uppercase tracking-wider text-data hover:underline">
                    Open
                  </Link>
                </div>
                {r.note && <p className="mt-1 pl-6 text-xs text-soft">{r.note}</p>}
                {r.reminder && (
                  <div className="mt-2 pl-6">
                    <Button size="sm" variant="quiet" className="h-auto py-1.5 text-left" disabled={added.has(i)} onClick={() => addReminder(i, r.reminder!)}>
                      {added.has(i) ? <Check size={13} /> : <Bell size={13} />} {added.has(i) ? "Reminder added" : `Remind me: ${r.reminder.title} · ${r.reminder.date}${r.reminder.time ? ` ${r.reminder.time}` : ""}`}
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {/* the box: drop files anywhere on it, or paste a link or text */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={cx("rounded-2xl border-2 border-dashed bg-panel p-4 transition-colors", over ? "border-data bg-data/5" : "border-line")}
      >
        <textarea
          rows={4}
          placeholder="Paste a link, a message, or anything to remember…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Text or link to save"
          className="w-full resize-none rounded-lg bg-transparent text-[15px] leading-relaxed placeholder:text-faint focus:outline-none"
        />
        {files.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <li key={i} className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-raised/60 py-1 pr-1 pl-2.5 text-xs text-soft">
                {f.type.startsWith("image/") ? <ImageIcon size={12} className="shrink-0 text-data" /> : <FileText size={12} className="shrink-0 text-ok" />}
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))} aria-label={`Remove ${f.name}`} className="grid size-5 shrink-0 place-items-center rounded-full text-faint hover:bg-raised hover:text-fg">
                  <X size={11} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className={cx("mt-2 flex items-center justify-center gap-2 rounded-xl py-6 text-sm transition-colors", over ? "text-data" : "text-faint")}>
            <UploadCloud size={20} /> {over ? "Drop to add" : "Drop photos or files here (up to 5)"}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs transition hover:border-data hover:text-data">
            <Paperclip size={13} /> Choose files
            <input type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.docx" className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </label>
          <Button className="ml-auto" disabled={busy || (!text.trim() && !files.length)} onClick={() => save({ title: "", text: text.trim(), url: "", files })}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Save
          </Button>
        </div>
      </section>

      {/* what happens to each kind of thing */}
      <div className="mt-6 grid gap-2 sm:grid-cols-3">
        {[
          { icon: Link2, tone: "text-data border-data/40 bg-data/10", title: "Links", text: "Read and summarised into a memory" },
          { icon: ImageIcon, tone: "text-core border-core/40 bg-core/10", title: "Photos", text: "Described: bills, tickets, posters, screenshots" },
          { icon: FileText, tone: "text-ok border-ok/40 bg-ok/10", title: "PDF & Word", text: "Filed in Documents, ready to search" },
        ].map((x) => (
          <div key={x.title} className="flex gap-3 rounded-xl border border-line bg-panel/60 p-3">
            <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg border", x.tone)}>
              <x.icon size={15} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{x.title}</span>
              <span className="block text-xs text-soft">{x.text}</span>
            </span>
          </div>
        ))}
      </div>

      {/* from the phone, in three steps */}
      <div className="mt-6 rounded-xl border border-line bg-panel/40 p-4">
        <p className="mb-3 flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-faint uppercase">
          <Smartphone size={12} /> From your phone (Android)
        </p>
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {["Tap Share in any app", "Pick HIVEMIND", "Tap Save here"].map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              {i > 0 && <span className="text-faint">→</span>}
              <span className="flex items-center gap-2 rounded-full border border-line bg-raised/50 py-1 pr-3 pl-1">
                <span className="grid size-5 place-items-center rounded-full bg-core text-[10px] font-semibold text-core-ink">{i + 1}</span>
                {step}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
