# HIVEMIND

A personal AI in the spirit of Jarvis. It stores everything you give it, understands who you are, files your
knowledge into projects on its own, and answers from your own data. It is built entirely on free tiers:
Next.js on **Vercel**, **Supabase** (Postgres + pgvector), **Gemini** (answers and embeddings),
**NVIDIA NIM** (fallback answers), and **Groq** (intent router and organizer). It is single-owner: there are no accounts or sign-up.

- **Understanding**: HIVEMIND keeps a profile of you (role, skills, focus areas, goals) built from your data and uses it in every answer.
- **Auto-organizing**: portfolio projects become Projects. New memories, notes and documents are filed into the
  right project, and a new project is created when something clearly is one. Every automatic action appears in the
  activity feed with undo.
- **Console**: streaming answers with cited sources, sessions, and project scoping.

```
Browser → Next.js (Vercel)  ← APP_PASSWORD gate on Vercel, none locally
            ├─ Groq          → intent routing + filing items into projects
            ├─ Gemini        → embeddings (768-d) + answers + metadata
            ├─ NVIDIA        → fallback when Gemini is rate-limited or down
            ├─ Portfolio MCP → your profile/experience/projects/skills/certs/resume
            └─ Supabase      → Postgres + pgvector (server-only secret key; RLS blocks the public key)
```

## 1. Supabase (one time)

1. Go to [supabase.com](https://supabase.com), click **New project**, and choose a region close to you.
2. Open **SQL Editor** and run these in order: [`supabase/schema.sql`](supabase/schema.sql),
   [`002_single_user.sql`](supabase/migrations/002_single_user.sql), then [`003_jarvis.sql`](supabase/migrations/003_jarvis.sql).
3. In **Project Settings → API Keys**, copy the Project URL into `SUPABASE_URL` and the **secret** key
   (`sb_secret_…`) into `SUPABASE_SECRET_KEY`. Don't use the publishable key: it can't read or write anything.

## 2. Run locally

```bash
cp .env.example .env.local   # then fill in the values
npm install
npm run dev                  # http://localhost:3000 — opens straight to the HIVEMIND console
```

Then open **Sources** and click **Sync now** (portfolio MCP) and **Import** (portfolio site, Linktree).

## 3. Deploy to Vercel (free Hobby plan)

1. Push this folder to a GitHub repo. `.env.local` is git-ignored, so keys stay off GitHub.
2. In Vercel, click **Add New → Project**, import the repo, and leave the framework on Next.js.
3. Add every variable from `.env.local` under **Settings → Environment Variables**, **plus a strong `APP_PASSWORD`**.
   Without it, the deployed app refuses to run (HTTP 503), because otherwise anyone with the URL could read your brain.
4. Deploy, open the URL, and enter the password once. That browser stays unlocked for a year.
5. `vercel.json` sets up a daily cron that calls `/api/cron/keepalive`. This stops the free Supabase project from pausing after 7 idle days.

## Free-tier limits to know

| Service | Limit | How the app handles it |
|---|---|---|
| Vercel Hobby | 60s per request, 4.5MB upload | Uploads are capped at 4MB / 400 chunks |
| Supabase Free | 500MB DB, pauses after 7 idle days | Embeddings are 768-d (small); daily keepalive cron |
| Gemini free | Per-minute and per-day rate limits | Falls back to NVIDIA, then Groq |
| NVIDIA NIM | Trial credits, models get retired | 25s timeout; change `NVIDIA_MODEL` if a model is removed |
| Groq free | Rate limits | 8s timeout; falls back to keyword rules |

**Privacy:** on the free tier, Gemini may use your prompts to improve Google products. Don't store passwords or secrets.

**Embedding lock-in:** the database is fixed at `gemini-embedding-001` @ 768 dims. If you change the embedding model later, every row has to be re-embedded.

## Features

- **Notes**: AI adds a title, summary, category, tags, and an embedding when you save.
- **Memories**: 8 types (fact, decision, idea, …), importance, **version history with restore**, re-embedded on edit.
- **Documents**: PDF, TXT, MD, DOCX → chunks (with page numbers) → embeddings.
- **Ask My Brain**: RAG chat with numbered sources, project filter, and a Gemini/NVIDIA picker.
  - `remember that …` saves a memory.
  - `update my memory about …` finds candidates. It never changes a memory without you.
- **Semantic search** across everything, optionally scoped to a project.
- **Sources**: sync your Portfolio MCP (`PORTFOLIO_MCP_URL`, falling back to its GitHub data) into about 29 memories plus
  your resume. Import any public page (portfolio site, Linktree). LinkedIn blocks automated readers, so save your profile
  as a PDF and upload it.
- **Projects**, **dashboard timeline**, **Export Brain** (JSON), per-item delete.

## Layout

```
app/(app)/...         pages (dashboard, chat, search, notes, memories, documents, projects, settings)
app/api/...           route handlers (owner-only via proxy; DB via server secret key)
lib/ai/               provider interface, Gemini, NVIDIA + Groq (OpenAI-compatible), router, embeddings, metadata
lib/rag/              chunker, retrieval (match_knowledge RPC), grounded answering
lib/knowledge.ts      create/update notes & memories (metadata, embedding, versioning)
proxy.ts              owner gate (APP_PASSWORD cookie) — Next 16 name for middleware
lib/imports/          portfolio MCP client + web page importer
supabase/schema.sql   tables, HNSW indexes, RLS, search function
```

## Next ideas

Resources (URL/GitHub ingestion), related-knowledge suggestions, knowledge graph, provider benchmark page.
