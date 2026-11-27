"use client";

import {
  AlertTriangle,
  ChevronRight,
  Hammer,
  Loader2,
  Lock,
  Menu,
  MessageSquareText,
  Trash2,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CardSkeleton, cx, ErrorText, PageHeader } from "@/components/ui";
import { api, BRAIN_CHANGED, timeAgo, useFetch } from "@/lib/client-api";

type App = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  status: "building" | "ready" | "failed";
  error?: string;
  updated_at: string;
  version: number;
};

const IDEAS = [
  {
    emoji: "⛽",
    title: "Petrol tracker",
    text: "Track my petrol expenses: date, rupees, litres, km reading, monthly total and a 6-month chart",
  },
  {
    emoji: "🏋️",
    title: "Gym log",
    text: "A gym workout log: exercise, sets, reps, weight, and my personal bests",
  },
  {
    emoji: "🔤",
    title: "Tamil flashcards",
    text: "A Tamil vocabulary flashcard app with spaced repetition",
  },
  {
    emoji: "🧾",
    title: "Bill splitter",
    text: "Split bills with friends: who paid, who owes whom",
  },
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
  const ready = request.trim().length >= 5;

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
      const r = await api<{ id: string }>("/api/apps", {
        method: "POST",
        json: { request: text.trim() },
      });
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
    if (
      !confirm(
        `Delete "${a.name}" and everything it saved? This can't be undone.`,
      )
    )
      return;
    list.setData((d) =>
      d ? { apps: d.apps.filter((x) => x.id !== a.id) } : d,
    );
    await api(`/api/apps/${a.id}`, { method: "DELETE" }).catch(() =>
      list.reload(),
    );
    window.dispatchEvent(new Event(BRAIN_CHANGED));
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Self-building"
        title="Apps"
        subtitle="Describe a tool in one sentence. HIVEMIND writes it in about 30 seconds and you can use it by voice. Each app runs sealed off: no internet, no access to the rest of HIVEMIND."
      />

      {/* the request: one sentence, then Build */}
      <div className="mb-10 space-y-3">
        <form
          className="rounded-2xl border border-line bg-panel transition-colors focus-within:border-core/50"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <textarea
            rows={3}
            placeholder="Make me an app to…"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void create();
              }
            }}
            aria-label="Describe the app"
            className="block w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[15px] leading-relaxed placeholder:text-faint focus:outline-none"
          />

          {/* ideas to start from: a tap fills the box, nothing is built until Build */}
          <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
            {IDEAS.map((x) => (
              <button
                key={x.title}
                type="button"
                onClick={() => setRequest(x.text)}
                title={x.text}
                className={cx(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-150 pointer-coarse:py-1.5",
                  request === x.text
                    ? "border-core/60 bg-core/10 text-fg"
                    : "border-line text-soft hover:border-line-strong hover:text-fg",
                )}
              >
                <span aria-hidden>{x.emoji}</span> {x.title}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-faint">
              <MessageSquareText size={13} className="shrink-0" />
              <span className="truncate">
                or say &quot;HIVEMIND, make me an app to…&quot;
              </span>
            </span>
            <button
              type="submit"
              disabled={busy || !ready}
              className="ml-auto flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-core px-4 text-sm font-medium text-core-ink transition-[filter,transform,background-color,color] duration-150 hover:brightness-110 active:scale-[0.97] disabled:bg-raised disabled:text-faint disabled:active:scale-100 pointer-coarse:h-11"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Hammer size={14} />
              )}{" "}
              Build it
            </button>
          </div>
        </form>
        <ErrorText error={error ?? list.error} />
      </div>

      {list.loading && !list.data ? (
        <CardSkeleton count={2} />
      ) : !apps.length ? (
        // no apps yet: how building one works
        <div className="rounded-xl border border-dashed border-line p-5">
          <ol className="grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: MessageSquareText,
                title: "Describe it",
                text: "One sentence, typed or said",
              },
              {
                icon: Wand2,
                title: "HIVEMIND writes it",
                text: "In about 30 seconds",
              },
              {
                icon: Menu,
                title: "It's yours",
                text: "Here, in the menu, and by voice",
              },
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
            <Lock size={12} /> Each app runs sealed off: no internet, and no
            access to the rest of HIVEMIND.
          </p>
        </div>
      ) : (
        <section aria-labelledby="your-apps">
          <h2
            id="your-apps"
            className="mb-2 flex items-baseline gap-2 px-1 font-mono text-[10.5px] tracking-[0.16em] text-faint uppercase"
          >
            Your apps <span className="text-soft">{apps.length}</span>
          </h2>
          <ul className="list-in divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {apps.map((a) => {
              const isBuilding = a.status === "building";
              const failed = a.status === "failed";
              return (
                <li key={a.id} className="group relative">
                  <Link
                    href={`/apps/${a.id}`}
                    className="flex items-center gap-3.5 py-3.5 pr-12 pl-4 transition-colors duration-150 hover:bg-raised focus-visible:bg-raised"
                  >
                    <span
                      className={cx(
                        "grid size-11 shrink-0 place-items-center rounded-xl border text-2xl leading-none",
                        failed
                          ? "border-alert/40 bg-alert/10"
                          : isBuilding
                            ? "shimmer border-core/30"
                            : "border-line bg-sunken",
                      )}
                      aria-hidden
                    >
                      {isBuilding && a.version === 0 ? "" : a.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {isBuilding && a.version === 0
                            ? "Writing a new app…"
                            : a.name}
                        </span>
                        {failed && (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-alert/15 px-1.5 py-0.5 text-[10.5px] text-alert">
                            <AlertTriangle size={10} /> failed
                          </span>
                        )}
                      </span>
                      <span
                        className={cx(
                          "mt-0.5 line-clamp-1 text-sm",
                          failed ? "text-alert/90" : "text-soft",
                        )}
                      >
                        {failed ? a.error : a.description}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-right font-mono text-[10.5px] text-faint sm:block">
                      {isBuilding ? (
                        <span className="flex items-center gap-1 text-core">
                          <Loader2 size={11} className="animate-spin" />{" "}
                          {a.version === 0 ? "writing" : "updating"}
                        </span>
                      ) : (
                        <>
                          v{a.version}
                          <span className="block">{timeAgo(a.updated_at)}</span>
                        </>
                      )}
                    </span>
                    <ChevronRight
                      size={16}
                      className="shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(a)}
                    aria-label={`Delete ${a.name}`}
                    title="Delete this app"
                    className="hit absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-faint transition-[opacity,color,background-color] duration-150 hover:bg-alert/10 hover:text-alert focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
