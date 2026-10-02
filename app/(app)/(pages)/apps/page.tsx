"use client";

import { Hammer, Loader2, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, cx, Empty, ErrorText, PageHeader, Textarea } from "@/components/ui";
import { api, BRAIN_CHANGED, timeAgo, useFetch } from "@/lib/client-api";

type App = { id: string; name: string; emoji: string; description: string; status: "building" | "ready" | "failed"; error?: string; updated_at: string; version: number };

const IDEAS = [
  "Track my petrol expenses: date, rupees, litres, km reading, monthly total and a 6-month chart",
  "A gym workout log: exercise, sets, reps, weight, and my personal bests",
  "A Tamil vocabulary flashcard app with spaced repetition",
  "Split bills with friends: who paid, who owes whom",
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
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Self-building"
        title="Apps"
        subtitle="Describe a tool you want. HIVEMIND writes it in about 30 seconds, adds it here and to the menu, and you can use it by voice. Each app runs sealed off: no internet, no access to the rest of HIVEMIND."
      />

      <section className="mb-6 space-y-2 rounded-xl border border-line bg-panel p-4">
        <Textarea rows={3} placeholder="Make me an app to…" value={request} onChange={(e) => setRequest(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => create()} disabled={busy || request.trim().length < 5}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Hammer size={14} />} Build it
          </Button>
          <span className="text-xs text-soft">or say &quot;HIVEMIND, make me an app to…&quot;</span>
        </div>
        {!apps.length && (
          <div className="flex flex-wrap gap-2 pt-1">
            {IDEAS.map((x) => (
              <button key={x} type="button" onClick={() => setRequest(x)} className="rounded-md border border-line px-2 py-1 text-left text-xs text-soft hover:border-data hover:text-data">
                {x}
              </button>
            ))}
          </div>
        )}
        <ErrorText error={error ?? list.error} />
      </section>

      {!apps.length && !list.loading ? (
        <Empty>No apps yet. Describe one above.</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
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
              <button type="button" onClick={() => remove(a)} aria-label={`Delete ${a.name}`} title="Delete this app" className="absolute right-2 top-2 rounded p-1.5 text-faint hover:bg-alert/10 hover:text-alert">
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
