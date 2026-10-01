"use client";

import { Languages } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui";
import { api, useFetch } from "@/lib/client-api";

type Lang = "auto" | "en" | "ta";
const OPTIONS: { v: Lang; label: string; hint: string }[] = [
  { v: "auto", label: "Match me", hint: "Tamil → Tamil, Tanglish → Tanglish, English → English" },
  { v: "ta", label: "தமிழ்", hint: "Always reply in Tamil" },
  { v: "en", label: "English", hint: "Always reply in English (still understands Tamil)" },
];

/** Settings card: which language HIVEMIND answers in, by chat and by voice. */
export function LanguageCard() {
  const prefs = useFetch<{ language: Lang }>("/api/prefs");
  const [saving, setSaving] = useState(false);
  const cur = prefs.data?.language ?? "auto";

  async function pick(v: Lang) {
    setSaving(true);
    prefs.setData({ language: v });
    await api("/api/prefs", { method: "PUT", json: { language: v } }).catch(() => prefs.reload());
    setSaving(false);
  }

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        <Languages size={16} /> Language
      </h2>
      <p className="text-sm text-soft">How HIVEMIND talks to you in chat and voice. Live voice picks up a change the next time you start it.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o.v}
            type="button"
            disabled={saving || !prefs.data}
            onClick={() => pick(o.v)}
            aria-pressed={cur === o.v}
            className={cx("rounded-lg border p-3 text-left transition-colors", cur === o.v ? "border-core bg-core/10" : "border-line hover:border-line-strong")}
          >
            <div className={cx("font-medium", cur === o.v && "text-core")}>{o.label}</div>
            <div className="mt-0.5 text-[11.5px] text-faint">{o.hint}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
