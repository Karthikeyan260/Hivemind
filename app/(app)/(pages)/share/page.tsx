"use client";

import { Bell, Check, FileText, Image as ImageIcon, Link2, Loader2, Paperclip, Share2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Button, ErrorText, PageHeader, Textarea } from "@/components/ui";
import { api, BRAIN_CHANGED } from "@/lib/client-api";

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
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(params.get("error") ? "That share didn't come through. Share it to HIVEMIND once more." : null);
  const [added, setAdded] = useState<Set<number>>(new Set());
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

  async function addReminder(i: number, r: NonNullable<Saved["reminder"]>) {
    await api("/api/reminders", { method: "POST", json: { title: r.title, date: r.date, time: r.time } });
    setAdded((s) => new Set(s).add(i));
  }

  const what = incoming && (incoming.files.length ? `${incoming.files.length} file${incoming.files.length > 1 ? "s" : ""}` : incoming.url || incoming.text.match(/https?:\/\/\S+/)?.[0] || incoming.text.slice(0, 80));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Share"
        title="Share to HIVEMIND"
        subtitle="From any app on Android, tap Share → HIVEMIND: links are read and summarised, photos are described (bills, tickets, posters, screenshots), PDFs and Word files go to Documents. Or paste here."
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
        <ul className="mb-6 space-y-2">
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

      <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
        <Textarea rows={4} placeholder="Paste a link, a message, or anything to remember…" value={text} onChange={(e) => setText(e.target.value)} />
        {files.length > 0 && (
          <ul className="space-y-1 text-xs text-soft">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {f.type.startsWith("image/") ? <ImageIcon size={12} /> : <FileText size={12} />} {f.name}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong px-3 text-xs hover:border-data hover:text-data">
            <Paperclip size={13} /> Photo or file
            <input type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.docx" className="hidden" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 5))} />
          </label>
          <Button className="ml-auto" disabled={busy || (!text.trim() && !files.length)} onClick={() => save({ title: "", text: text.trim(), url: "", files })}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Save
          </Button>
        </div>
      </section>
    </div>
  );
}
