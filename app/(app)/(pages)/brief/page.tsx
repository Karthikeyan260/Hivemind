"use client";

import { ExternalLink, Loader2, Newspaper, Plus, Square, Volume2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, cx, ErrorText, Input, PageHeader } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { api, useFetch } from "@/lib/client-api";

type Item = { topic: string; points: string[]; sources: { title: string; url: string }[]; error?: string };
type Brief = { date: string; at: string; items: Item[] };
type Feed = { settings: { enabled: boolean; topics: string[] }; dates: string[]; date: string; today: string; brief: Brief | null };

const IDEAS = ["AI agents and LLM news", "AI / ML jobs in Chennai", "Tamil cinema updates", "Chennai news", "Indian stock market", "Cricket"];
const pretty = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

/** Your morning intelligence brief: the topics you follow, researched on the web every morning. */
export default function BriefPage() {
  const [date, setDate] = useState<string | null>(null);
  const feed = useFetch<Feed>(`/api/brief${date ? `?date=${date}` : ""}`);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = feed.data;
  const topics = d?.settings.topics ?? [];

  async function setTopics(next: string[]) {
    setError(null);
    feed.setData((x) => (x ? { ...x, settings: { ...x.settings, topics: next } } : x));
    await api("/api/brief", { method: "PATCH", json: { topics: next } }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      void feed.reload();
    });
  }

  async function makeNow() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ brief: Brief }>("/api/brief", { method: "POST" });
      setDate(r.brief.date);
      await feed.reload();
      return r.brief;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Read it aloud (the browser's own voice: free, and works offline once loaded).
  function listen(b: Brief) {
    if (!("speechSynthesis" in window)) return;
    if (speaking) {
      speechSynthesis.cancel();
      return setSpeaking(false);
    }
    const text = b.items.filter((i) => i.points.length).map((i) => `${i.topic}. ${i.points.join(" ")}`).join(" Next, ");
    const u = new SpeechSynthesisUtterance(`Here's your brief. ${text}`);
    u.lang = "en-IN";
    u.onend = u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    speechSynthesis.speak(u);
  }
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  useVoiceActions({
    brief_make: {
      description: "Brief page: research the owner's topics now and show today's brief (about 20-40 seconds).",
      run: async () => {
        const b = await makeNow();
        return b ? { brief: b.items.map((i) => ({ topic: i.topic, points: i.points })) } : { error: "Couldn't make the brief." };
      },
    },
  });

  const add = (t: string) => {
    const v = t.trim();
    if (v.length < 2 || topics.length >= 4 || topics.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setTopic("");
    void setTopics([...topics, v]);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Every morning"
        title="Morning brief"
        subtitle="Pick up to 4 topics. Every morning HIVEMIND searches the web for what's new, writes 3 short lines on each with sources, saves it to your brain and notifies you."
        actions={
          <Button onClick={makeNow} disabled={busy || !topics.length}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Newspaper size={15} />} {busy ? "Researching…" : "Brief me now"}
          </Button>
        }
      />
      <ErrorText error={error ?? feed.error} />

      {d && (
        <section className="mb-5 space-y-3 rounded-xl border border-line bg-panel p-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t) => (
              <span key={t} className="flex items-center gap-1 rounded-full border border-core/50 bg-core/10 px-3 py-1 text-xs">
                {t}
                <button type="button" aria-label={`Remove ${t}`} onClick={() => setTopics(topics.filter((x) => x !== t))} className="text-soft hover:text-alert">
                  <X size={12} />
                </button>
              </span>
            ))}
            {!topics.length && <span className="text-soft">No topics yet: add one below.</span>}
          </div>
          {topics.length < 4 && (
            <>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  add(topic);
                }}
              >
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="A topic to follow, e.g. AI agents news" maxLength={80} />
                <Button type="submit" disabled={topic.trim().length < 2}>
                  <Plus size={14} /> Add
                </Button>
              </form>
              <div className="flex flex-wrap gap-1.5">
                {IDEAS.filter((i) => !topics.includes(i)).map((i) => (
                  <button key={i} type="button" onClick={() => add(i)} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-soft hover:border-data hover:text-data">
                    + {i}
                  </button>
                ))}
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-soft">
            <input type="checkbox" checked={d.settings.enabled} onChange={(e) => void api("/api/brief", { method: "PATCH", json: { enabled: e.target.checked } }).then(() => feed.reload())} />
            Make it every morning
          </label>
        </section>
      )}

      {busy && (
        <p className="mb-4 flex items-center gap-2 text-sm text-soft">
          <Loader2 size={14} className="animate-spin text-core" /> Searching the web for each topic… about 10 seconds per topic.
        </p>
      )}

      {d?.brief ? (
        <div className="rounded-xl border border-line bg-panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-medium">{d.brief.date === d.today ? "Today" : pretty(d.brief.date)}</h2>
            <Button size="sm" variant="quiet" className="ml-auto" onClick={() => listen(d.brief!)}>
              {speaking ? <Square size={13} /> : <Volume2 size={13} />} {speaking ? "Stop" : "Listen"}
            </Button>
          </div>
          <div className="space-y-4">
            {d.brief.items.map((i) => (
              <section key={i.topic}>
                <h3 className="mb-1 font-mono text-[11px] uppercase tracking-wider text-core">{i.topic}</h3>
                {i.error ? (
                  <p className="text-sm text-alert">{i.error}</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
                    {i.points.map((p, k) => (
                      <li key={k}>{p}</li>
                    ))}
                  </ul>
                )}
                {!!i.sources.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {i.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="flex max-w-56 items-center gap-1 truncate border border-data/25 px-1.5 py-0.5 font-mono text-[10px] text-soft hover:text-data">
                        <ExternalLink size={10} /> <span className="truncate">{s.title || new URL(s.url).hostname}</span>
                      </a>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      ) : (
        d &&
        !busy && (
          <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-soft">
            {topics.length ? "No brief yet today. It arrives in the morning, or tap Brief me now." : "Add a topic above to get your first brief."}
          </div>
        )
      )}

      {!!d?.dates.length && (
        <div className="mt-6 flex flex-wrap gap-1.5">
          {d.dates.slice(0, 20).map((x) => (
            <button key={x} type="button" onClick={() => setDate(x)} className={cx("border px-2 py-1 font-mono text-[11px]", x === d.date ? "border-core text-core" : "border-line text-soft hover:border-data hover:text-data")}>
              {pretty(x)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
