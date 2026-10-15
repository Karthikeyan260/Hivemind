# HIVEMIND

A personal AI in the spirit of Jarvis. It stores everything you give it, understands who you are, files your
knowledge into projects on its own, and answers from your own data. It is built entirely on free tiers:
Next.js on **Vercel**, **Supabase** (Postgres + pgvector), **Gemini** (answers and embeddings),
**NVIDIA NIM** and **Mistral** (fallback answers), and **Groq** (intent router and organizer). It is single-owner: there are no
accounts or sign-up. It's an installable PWA that you can talk to by voice, and it comes with a pocket pet, **Nova**, whose 3D
garden grows from everything you keep up with.

- **Understanding**: HIVEMIND keeps a profile of you (role, skills, focus areas, goals) built from your data and uses it in every answer.
- **Auto-organizing**: portfolio projects become Projects. New memories, notes and documents are filed into the
  right project, and a new project is created when something clearly is one. Every automatic action appears in the
  activity feed with undo.
- **Console**: streaming answers with cited sources, sessions, and project scoping.

```
Browser → Next.js (Vercel)  ← APP_PASSWORD gate on Vercel, none locally
            ├─ Groq          → intent routing + filing items into projects
            ├─ Gemini        → embeddings (768-d) + answers + metadata
            ├─ NVIDIA/Mistral → fallback when Gemini is rate-limited or down
            ├─ Portfolio MCP → your profile/experience/projects/skills/certs/resume
            └─ Supabase      → Postgres + pgvector (server-only secret key; RLS blocks the public key)
```

## 1. Supabase (one time)

1. Go to [supabase.com](https://supabase.com), click **New project**, and choose a region close to you.
2. Open **SQL Editor** and run these in order: [`supabase/schema.sql`](supabase/schema.sql),
   [`002_single_user.sql`](supabase/migrations/002_single_user.sql), [`003_jarvis.sql`](supabase/migrations/003_jarvis.sql), then
   [`004_rls_guard.sql`](supabase/migrations/004_rls_guard.sql) (turns RLS on for every future table automatically).
3. In **Project Settings → API Keys**, copy the Project URL into `SUPABASE_URL` and the **secret** key
   (`sb_secret_…`) into `SUPABASE_SECRET_KEY`. Don't use the publishable key: it can't read or write anything.

## 2. Run locally

```bash
cp .env.example .env.local   # then fill in the values
npm install
npm run dev                  # http://localhost:3000 — opens straight to the HIVEMIND console
```

Locally there's no password (`APP_PASSWORD` is left empty in `.env.local`). A local **production** build refuses to
start without one, so give it a throwaway password just for that run:

```bash
npm run build && APP_PASSWORD=localtest npm start
```

Tests:

```bash
npm test                     # unit tests (router, safety guard, reminders, retrieval, re-embed, wake word…)
npm run test:db              # live checks against your Supabase project: match_knowledge, RLS (adds and removes 2 test notes)
npm run build && npm run test:e2e   # Playwright: lock screen, wrong password, unlock → chat (AI stubbed) → lock, desktop + phone
```

**Settings → System check** shows database reachability, any table with RLS off (also a daily push alert), and the embedding status.

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

**Changing the embedding model:** the database records which model made its vectors (default `gemini-embedding-001`, 768-d), and keeps using it even if `GEMINI_EMBED_MODEL` changes, so vectors from two models never get mixed. To switch: set the new model, then **Settings → System check → Re-embed everything**. It runs in sub-minute steps (the scheduler carries on if you close the page) and switches searches over only when every note, memory and document chunk is done. The new model must give 768-number vectors; another size also needs a column change in SQL.

## Features

### Your brain

- **Notes**: AI adds a title, summary, category, tags, and an embedding when you save.
- **Memories**: 8 types (fact, decision, idea, …), importance, **version history with restore**, re-embedded on edit.
- **Documents**: PDF, TXT, MD, DOCX, CSV → chunks (with page numbers) → embeddings.
- **Ask My Brain**: RAG chat with numbered sources, a project filter, and a choice of model.
  - `remember that …` saves a memory.
  - `update my memory about …` finds candidates. It never changes a memory without you.
- **Semantic search** across everything, optionally scoped to a project.
- **Sources**: sync your Portfolio MCP (`PORTFOLIO_MCP_URL`, falling back to its GitHub data) into about 29 memories plus
  your resume. Import any public page (portfolio site, Linktree). LinkedIn blocks automated readers, so save your profile
  as a PDF and upload it.
- **Photos**: described and tagged with where and when they were taken, so you can search for "Ooty trip".
- **Projects**, **dashboard timeline**, **Export Brain** (JSON), per-item delete.

### Working for you

- **Voice**: a wake word and hands-free conversation. Most pages register voice actions, so you can run them by speaking.
- **Autopilot**: a few times a day it reads your whole brain, connects the dots, and tells you what needs you. It never changes or deletes anything on its own.
- **Web tasks**: drives a real cloud browser. It stops for your approval before anything it can't undo (submit, pay, send, delete).
- **Apps**: describe a tool you want. HIVEMIND writes it, adds it to the menu, and you can use it by voice. Each app runs sandboxed.
- **Morning brief**: your day at a glance, plus fresh news on up to 4 topics you follow.
- **Dream mode**: overnight it merges duplicate memories and updates out-of-date facts.
- **Calls**: answers when you can't pick up, asks who's calling and why, and sends you a one-line summary.
- **Share**: on Android, Share → HIVEMIND reads links, describes photos, and files PDFs and Word documents.
- **Habits and birthdays**: tick habits off in the app, by voice, or from the notification. Birthday reminders come with a wish ready to send.
- **Career**: paste a job description to get a tailored resume PDF, cover letter and interview prep built from your real experience.
- **Map**, **Routines**, **Kitchen mode** (hands-free focus).

### Play

- **Nova, the pocket pet**: a little glowing lantern that lives on screen and grows with you. It wanders the page,
  plays hide and seek (you find it by voice), sulks when ignored, dresses up for festivals, talks in its own voice, and
  answers to its name (you can rename it by voice).
- **Nova's garden**: a 3D floating island you can turn around and zoom into.
  - **What grows:** a flower for every day a habit was done, a tree for every 4 night check-ins, a lamp for each
    lantern walk, a gem for each game won, and butterflies for songs played.
  - **Nova's life there:** it strolls the island, naps in its cottage, and sleeps there at night. Tap anything and
    Nova walks over to it.
  - **The scene:** wind-swept grass that parts around Nova, a pond spilling into a waterfall, and a sea of clouds below.
  - **Sky and weather:** they follow your real time of day and local weather (dawn, golden hour, dusk, starry nights
    with shooting stars, rain).
  - **Fallback:** devices without WebGL get a flat version.
- **Living sky**: the app's background follows your local weather. **Music lights**: the screen pulses to the beat of what's playing.
- **Games**, **Day comic** (four moments of your day, drawn), **My Wrapped** (your month in story cards), **Journey** (your story, walked through in 3D).

## Layout

```
app/(app)/...         pages (dashboard, chat, search, notes, memories, documents, projects, settings)
app/api/...           route handlers (owner-only via proxy; DB via server secret key)
lib/ai/               provider interface, Gemini, NVIDIA + Groq (OpenAI-compatible), router, embeddings, metadata
lib/rag/              chunker, retrieval (match_knowledge RPC), grounded answering
lib/knowledge.ts      create/update notes & memories (metadata, embedding, versioning)
proxy.ts              owner gate (APP_PASSWORD cookie) — Next 16 name for middleware
lib/imports/          portfolio MCP client + web page importer
lib/agents/           the orchestrator, intent router, quick commands and chat tools
components/pet/       Nova: the on-screen pet, its looks, voice and games
components/garden/    Nova's garden: the 3D island (garden-scene.ts, three.js), its page, and the flat fallback
lib/garden*.ts        what grows in the garden (from habits, check-ins, walks, wins, songs) and where it stands
supabase/schema.sql   tables, HNSW indexes, RLS, search function (then supabase/migrations/ in order)
tests/, e2e/          vitest unit + live DB tests, Playwright smoke tests
```

## Next ideas

Resources (URL/GitHub ingestion), related-knowledge suggestions, knowledge graph, provider benchmark page.
