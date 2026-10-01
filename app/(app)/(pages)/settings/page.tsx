import { LanguageCard } from "@/components/language";
import { NotificationsCard } from "@/components/notifications";
import { providers } from "@/lib/ai/providers";

export default function SettingsPage() {
  const rows = [
    { role: "Answers, summaries, tags", p: providers.gemini },
    { role: "Embeddings (fixed, 768-dim)", p: { ...providers.gemini, model: process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001" } },
    { role: "Fallback / alternative answers", p: providers.nvidia },
    { role: "Intent router", p: providers.groq },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings & privacy</h1>

      <section className="rounded-xl border border-line bg-panel p-4">
        <h2 className="mb-3 font-semibold">AI providers</h2>
        <ul className="divide-y divide-line text-sm">
          {rows.map(({ role, p }) => (
            <li key={role} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <div className="font-medium">{role}</div>
                <div className="text-xs text-soft">
                  {p.name} · {p.model}
                </div>
              </div>
              <span className={p.isConfigured() ? "text-green-600" : "text-red-500"}>
                {p.isConfigured() ? "key set" : "missing key"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-soft">
          Keys live only on the server (Vercel env vars). Free-tier Gemini may use prompts to improve Google products —
          don&apos;t store passwords or secrets in your brain.
        </p>
      </section>

      <LanguageCard />

      <NotificationsCard />

      <section className="rounded-xl border border-line bg-panel p-4">
        <h2 className="mb-2 font-semibold">Export your brain</h2>
        <p className="mb-3 text-sm text-soft">
          Download all notes, memories, versions, documents, projects and chats as JSON. Keep a copy outside the app.
        </p>
        <a href="/api/export" className="inline-block rounded-md bg-core px-3 py-2 text-sm font-medium text-core-ink hover:bg-core/85">
          Download export
        </a>
      </section>
    </div>
  );
}
