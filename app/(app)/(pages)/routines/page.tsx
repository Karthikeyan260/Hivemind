"use client";

import { Pencil, Play, Plus, Trash2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Empty, ErrorText, Input, PageHeader, Textarea } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { api, armAsk, timeAgo, useFetch } from "@/lib/client-api";

type Routine = { id: string; name: string; triggers: string[]; steps: string[]; last_run?: string; runs?: number };
type Draft = { id?: string; name: string; triggers: string; steps: string };

const IDEAS: Draft[] = [
  { name: "Gym mode", triggers: "gym mode, going to gym", steps: "Play energetic Tamil workout songs\nLog my exercise habit\nRemind me in 1 hour to drink water" },
  { name: "Leaving office", triggers: "leaving office, heading home", steps: "Directions home by car\nWhat's on my schedule this evening?\nPlay Anirudh hits" },
  { name: "Good night", triggers: "good night", steps: "What's on my schedule tomorrow?\nHow are my habits today?\nStop the music" },
];

const runText = (r: Routine) => `Run my "${r.name}" routine`;

/** One phrase, several things done: "good morning" → weather, today's plan, habits, a song. */
export default function RoutinesPage() {
  const router = useRouter();
  const list = useFetch<{ routines: Routine[] }>("/api/routines");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routines = list.data?.routines ?? [];

  function run(r: Routine) {
    armAsk(runText(r));
    router.push(`/?ask=${encodeURIComponent(runText(r))}`);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/routines", {
        method: "POST",
        json: { id: draft.id, name: draft.name, triggers: draft.triggers.split(",").map((t) => t.trim()).filter(Boolean), steps: draft.steps.split("\n").map((s) => s.trim()).filter(Boolean) },
      });
      setDraft(null);
      await list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Routine) {
    if (!confirm(`Delete the "${r.name}" routine?`)) return;
    list.setData((d) => (d ? { routines: d.routines.filter((x) => x.id !== r.id) } : d));
    await api(`/api/routines?id=${r.id}`, { method: "DELETE" }).catch(() => list.reload());
  }

  useVoiceActions({
    routine_run: {
      description: "Routines page: run a routine. input: its name or number in the list (1 = top).",
      run: ({ input }) => {
        const q = String(input ?? "").toLowerCase().trim();
        const n = Number(q.match(/\d+/)?.[0]);
        const r = n ? routines[n - 1] : routines.find((x) => x.name.toLowerCase().includes(q) || x.triggers.some((t) => q.includes(t)));
        if (!r) return { error: "No routine like that.", routines: routines.map((x) => x.name) };
        run(r);
        return { running: r.name, steps: r.steps };
      },
    },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Voice"
        title="Routines"
        subtitle={`Say one phrase and HIVEMIND does several things in one go. Say it in voice ("good morning") or chat, or tap Run. Routines can play, check, plan and remind; anything that deletes or sends still asks you first.`}
        actions={
          <Button onClick={() => setDraft({ name: "", triggers: "", steps: "" })}>
            <Plus size={15} /> New routine
          </Button>
        }
      />
      <ErrorText error={error ?? list.error} />

      {draft && (
        <section className="mb-6 space-y-3 rounded-xl border border-core/50 bg-panel p-4 text-sm">
          <Input placeholder="Name, e.g. Gym mode" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input placeholder="Other ways you'll say it, comma separated (e.g. going to gym, workout time)" value={draft.triggers} onChange={(e) => setDraft({ ...draft, triggers: e.target.value })} />
          <Textarea
            rows={5}
            placeholder={"One step per line, the way you'd ask HIVEMIND:\nWhat's the weather today?\nPlay a Tamil melody"}
            value={draft.steps}
            onChange={(e) => setDraft({ ...draft, steps: e.target.value })}
          />
          {!draft.id && (
            <div className="flex flex-wrap gap-2">
              {IDEAS.map((i) => (
                <button key={i.name} type="button" onClick={() => setDraft(i)} className="rounded-full border border-line px-3 py-1 text-xs text-soft hover:border-data hover:text-data">
                  {i.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy || !draft.name.trim() || !draft.steps.trim()}>
              Save
            </Button>
            <Button variant="quiet" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      {!list.data && list.loading ? (
        <p className="text-sm text-soft">Loading…</p>
      ) : !routines.length ? (
        <Empty>No routines yet. Make one, or say &quot;when I say gym mode, play workout songs and log my exercise&quot;.</Empty>
      ) : (
        <ul className="space-y-3">
          {routines.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Zap size={16} className="text-core" />
                <h2 className="font-medium">{r.name}</h2>
                {r.triggers.map((t) => (
                  <span key={t} className="rounded-full bg-raised px-2 py-0.5 font-mono text-[10.5px] text-soft">
                    &quot;{t}&quot;
                  </span>
                ))}
                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" onClick={() => run(r)}>
                    <Play size={13} /> Run
                  </Button>
                  <Button size="sm" variant="quiet" aria-label="Edit" onClick={() => setDraft({ id: r.id, name: r.name, triggers: r.triggers.join(", "), steps: r.steps.join("\n") })}>
                    <Pencil size={13} />
                  </Button>
                  <Button size="sm" variant="quiet" aria-label="Delete" onClick={() => remove(r)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
              <ol className="mt-2 list-decimal space-y-0.5 pl-6 text-sm text-soft">
                {r.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              {r.last_run && (
                <p className="mt-2 font-mono text-[10.5px] text-faint">
                  last run {timeAgo(r.last_run)} · {r.runs} times
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
