"use client";

import { Hammer, Loader2, Lock, Menu, MessageSquareText, Sparkles, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cx, ErrorText, PageHeader } from "@/components/ui";
import { api, BRAIN_CHANGED, timeAgo, useFetch } from "@/lib/client-api";

type App = { id: string; name: string; emoji: string; description: string; status: "building" | "ready" | "failed"; error?: string; updated_at: string; version: number };

const IDEAS = [
  { emoji: "⛽", title: "Petrol tracker", text: "Track my petrol expenses: date, rupees, litres, km reading, monthly total and a 6-month chart" },
  { emoji: "🏋️", title: "Gym log", text: "A gym workout log: exercise, sets, reps, weight, and my personal bests" },
  { emoji: "🔤", title: "Tamil flashcards", text: "A Tamil vocabulary flashcard app with spaced repetition" },
  { emoji: "🧾", title: "Bill splitter", text: "Split bills with friends: who paid, who owes whom" },
];

/** Apps HIVEMIND built for you from a sentence. */
export default function AppsPage() {
  const router = useRouter();
  const list = useFetch<{ apps: App[] }>("/api/apps");
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apps = list.data?.apps ?? [];
  const building = apps.some((a) => a.status === "building");

  // Follow builds until they finish.
  const reload = list.reload;
  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [building, reload]);

  async function create(text = request) {
    if (text.trim().length < 5) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/apps", { method: "POST", json: { request: text.trim() } });
      setRequest("");
      window.dispatchEvent(new Event(BRAIN_CHANGED));
      router.push(`/apps/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: App) {
    if (!confirm(`Delete "${a.name}" and everything it saved? This can't be undone.`)) return;
    list.setData((d) => (d ? { apps: d.apps.filter((x) => x.id !== a.id) } : d));
    await api(`/api/apps/${a.id}`, { method: "DELETE" }).catch(() => list.reload());
    window.dispatchEvent(new Event(BRAIN_CHANGED));
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Self-building"
        title="Apps"
        subtitle="Describe a tool you want. HIVEMIND writes it in about 30 seconds, adds it here and to the menu, and you can use it by voice. Each app runs sealed off: no internet, no access to the rest of HIVEMIND."
      />

      {/* the request: one sentence, then Build */}
      <section className="mb-6 rounded-2xl border border-line bg-panel p-4 transition-colors focus-within:border-core/50">
        <textarea
          rows={3}
          placeholder="Make me an app to…"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          aria-label="Describe the app"
          className="w-full resize-none bg-transparent text-[15px] leading-relaxed placeholder:text-faint focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <span className="flex items-center gap-1.5 text-xs text-faint">
            <MessageSquareText size={13} /> or say &quot;HIVEMIND, make me an app to…&quot;
          </span>
          <button
            type="button"
            onClick={() => create()}
            disabled={busy || request.trim().length < 5}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-core px-4 text-sm font-medium text-core-ink transition hover:brightness-110 active:scale-[0.97] disabled:bg-raised disabled:text-faint"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Hammer size={14} />} Build it
          </button>
        </div>
        <ErrorText error={error ?? list.error} />
      </section>

      {/* ideas to start from (a tap fills the box; nothing is built until you press Build) */}
      {!apps.length && (
        <div className="mb-8">
          <p className="mb-2 font-mono text-[10px] tracking-[0.18em] text-faint uppercase">Ideas</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {IDEAS.map((x) => (
              <button
                key={x.title}
                type="button"
                onClick={() => setRequest(x.text)}
                className={cx("lift flex flex-col gap-1.5 rounded-xl border bg-panel p-3.5 text-left transition-colors", request === x.text ? "border-core/60" : "border-line hover:border-line-strong")}
              >
                <span className="text-2xl leading-none">{x.emoji}</span>
                <span className="text-sm font-medium">{x.title}</span>
                <span className="line-clamp-2 text-xs text-soft">{x.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!apps.length && !list.loading ? (
        // no apps yet: how building one works
        <div className="rounded-xl border border-dashed border-line bg-panel/40 p-5">
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: MessageSquareText, title: "Describe it", text: "One sentence, typed or said" },
              { icon: Wand2, title: "HIVEMIND writes it", text: "In about 30 seconds" },
              { icon: Menu, title: "It's yours", text: "In this list, the menu, and by voice" },
            ].map((x, i) => (
              <li key={x.title} className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-core/40 bg-core/10 text-core">
                  <x.icon size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {i + 1}. {x.title}
                  </span>
                  <span className="block text-xs text-soft">{x.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-faint">
            <Lock size={12} /> Each app runs sealed off: no internet, and no access to the rest of HIVEMIND.
          </p>
        </div>
      ) : (
        <ul className="list-in grid gap-3 sm:grid-cols-2">
          {apps.map((a) => (
            <li key={a.id} className="group relative">
              <Link href={`/apps/${a.id}`} className={cx("flex h-full gap-3 rounded-xl border bg-panel p-4 pr-10 hover:border-line-strong", a.status === "failed" ? "border-alert/40" : "border-line")}>
                <span className="text-3xl leading-none">{a.emoji}</span>
                <span className="min-w-0">
                  <span className="block font-medium">{a.status === "building" && a.version === 0 ? "Building…" : a.name}</span>
                  <span className="line-clamp-2 text-sm text-soft">{a.status === "failed" ? a.error : a.description}</span>
                  <span className="mt-1 flex items-center gap-1 font-mono text-[10.5px] text-faint">
                    {a.status === "building" ? (
                      <>
                        <Loader2 size={11} className="animate-spin" /> writing the app…
                      </>
                    ) : (
                      <>
                        <Sparkles size={11} /> v{a.version} · {timeAgo(a.updated_at)}
                      </>
                    )}
                  </span>
                </span>
              </Link>
              <button type="button" onClick={() => remove(a)} aria-label={`Delete ${a.name}`} title="Delete this app" className="hit absolute right-2 top-2 rounded p-1.5 text-faint hover:bg-alert/10 hover:text-alert">
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
