# HIVEMIND

A **personal AI for one person**, in the spirit of Jarvis. It keeps everything you give it (notes, memories, documents,
photos), learns who you are, files your knowledge into projects on its own, answers from your own data, talks to you,
reminds you, works in the background, and also plays with you: a pocket pet, a 3D garden, games, and a theatre for watching
films with friends. It is built entirely on free tiers and installs on a phone like an app.

This README is the complete, single-page documentation. The `docs/` folder holds the same material in more depth (see
[Further reading](#15-further-reading)). Last checked against the code: **2026-11-11**.

## Contents

1. [What HIVEMIND is](#1-what-hivemind-is)
2. [Architecture](#2-architecture)
3. [Setup and deploy](#3-setup-and-deploy)
4. [Configuration (environment variables)](#4-configuration-environment-variables)
5. [Features](#5-features)
6. [Pages](#6-pages)
7. [API reference](#7-api-reference)
8. [Data](#8-data)
9. [Security and privacy](#9-security-and-privacy)
10. [Operations](#10-operations)
11. [Testing](#11-testing)
12. [Project layout](#12-project-layout)
13. [Known issues](#13-known-issues)
14. [Glossary](#14-glossary)
15. [Further reading](#15-further-reading)

---

## 1. What HIVEMIND is

- **Single owner by design.** No accounts, no sign-up. Anyone with the URL sees only a lock screen. Your pages and API sit
  behind one password. A few narrow public doors exist for guests (a call link, a game link, a theatre room link); each shows
  only its own room.
- **Understanding.** It keeps a profile of you (role, skills, focus areas, goals) built from your data and uses it in every answer.
- **Auto-organizing.** Portfolio projects become Projects. New memories, notes and documents are filed into the right project,
  and a new project is created when something clearly is one. Every automatic action appears in the activity feed with **undo**.
- **Answers from your own data.** Chat with numbered sources, project scoping and a choice of model.
- **Acts for you.** Autopilot, web tasks, mini-apps, Dream mode, briefs, reminders, habits, calls.
- **Plays with you.** Nova the pet, Nova's 3D garden, nine games plus a song quiz, a day comic, My Wrapped, Journey, and Friends Theatre.
- **Free tiers only.** Vercel Hobby, Supabase Free, free AI provider tiers.

At a glance: **46 pages**, **100 API routes**, **10 database tables**, an AI provider fallback chain of five providers, and about
**770 automated tests**.

---

## 2. Architecture

```text
Browser (installable PWA: phone or laptop)
   │  password gate (one owner, no accounts)
   ▼
Next.js 16 on Vercel (App Router)            ← pages + 100 API routes + a daily cron (keepalive)
   │                                           an outside scheduler calls /api/cron/notify every ~5 min
   ├─ Supabase (Postgres + pgvector)  notes, memories, documents, projects, photos, embeddings
   │                                   + a private storage bucket for small JSON state
   ├─ AI providers (first that answers wins):  Gemini → NVIDIA NIM → OpenRouter → Mistral → Groq
   ├─ Gemini Live + TTS                voice conversation and spoken replies
   ├─ Steel (cloud browser)            web tasks
   ├─ Web Push (VAPID)                 notifications when the app is closed
   └─ PeerJS broker + WebRTC           calls, friend games, Friends Theatre (browser to browser)
```

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind 4 | One codebase for pages and API; free hosting on Vercel |
| Data | Supabase Postgres with pgvector, server-only secret key, RLS on every table | Free tier; vector search for "ask my brain" |
| Small state | A private Supabase Storage bucket of JSON files | No migration needed for settings, push subscriptions, room codes |
| AI | Fallback chain: Gemini, NVIDIA NIM, OpenRouter, Mistral, Groq (`lib/ai/providers.ts`) | When one is rate-limited or down, the next answers |
| Voice | In-browser ONNX wake-word model, Gemini Live, Gemini TTS | Hands-free without a paid speech service |
| 3D | three.js (garden, journey, galaxy, mission control) | The pet's island, your career story, your knowledge as stars |
| Real-time | PeerJS (WebRTC) | Calls, friend games and Theatre go browser to browser |
| Offline | Service worker + IndexedDB queue | Read and add things without a connection |
| Tests | vitest, Playwright, ESLint, tsc | See [Testing](#11-testing) |

**How a request travels.** Every request first meets `proxy.ts` (Next 16's name for middleware). It lets through only a short
list of open paths, and everything else needs a valid owner session cookie. Owner API routes then run through a shared `handle()`
wrapper that validates input with zod and returns JSON errors, and talk to Supabase with the server-only secret key. Cron routes
are not cookie-protected; they need `Authorization: Bearer <CRON_SECRET>`.

**AI routing.** Groq is the fast intent router and organizer, Gemini does answers, embeddings (768 numbers) and metadata, and the
rest are fallbacks when Gemini is rate-limited or down.

---

## 3. Setup and deploy

### 3.1 Supabase (one time)

1. Go to [supabase.com](https://supabase.com), click **New project**, and choose a region close to you.
2. Open **SQL Editor** and run these in order: [`supabase/schema.sql`](supabase/schema.sql),
   [`002_single_user.sql`](supabase/migrations/002_single_user.sql), [`003_jarvis.sql`](supabase/migrations/003_jarvis.sql), then
   [`004_rls_guard.sql`](supabase/migrations/004_rls_guard.sql) (turns RLS on for every future table automatically).
   `schema.sql` alone is **not** the final schema; all four are needed.
3. In **Project Settings → API Keys**, copy the Project URL into `SUPABASE_URL` and the **secret** key
   (`sb_secret_…`) into `SUPABASE_SECRET_KEY`. Don't use the publishable key: it can't read or write anything.

### 3.2 Run locally

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

Then open **Sources** and click **Sync now** (portfolio MCP) and **Import** (portfolio site, Linktree).
**Settings → System check** shows database reachability, any table with RLS off, the scheduler, and the embedding status.

### 3.3 Deploy to Vercel (free Hobby plan)

1. Push this folder to a GitHub repo. `.env.local` is git-ignored, so keys stay off GitHub.
2. In Vercel, click **Add New → Project**, import the repo, and leave the framework on Next.js.
3. Add every variable from `.env.local` under **Settings → Environment Variables**, **plus a strong `APP_PASSWORD`** and a random
   `CRON_SECRET`. Without `APP_PASSWORD` the deployed app refuses to run (HTTP 503), because otherwise anyone with the URL could
   read your brain. Make VAPID keys with `npx web-push generate-vapid-keys`.
4. Deploy, open the URL, and enter the password once. That browser stays signed in for **180 days** (a browser you have unlocked
   before also gets a one-year trusted-device cookie that exempts it from the global lockout).
5. **Add the scheduler (required, and not in the repo).** `vercel.json` only sets one daily cron (`/api/cron/keepalive`, which keeps
   the free Supabase project from pausing after 7 idle days). Vercel's free plan cannot run anything more often, so on
   [cron-job.org](https://cron-job.org) create a job that calls `https://<your-app>/api/cron/notify` **every ~5 minutes** with the header
   `Authorization: Bearer <CRON_SECRET>`. Reminders, habit alerts, birthdays, the morning brief, Dream mode, Autopilot, Nova's
   diary and web-task resume all run from that one route. If it stops, none of them fire.
6. **Settings → System check**: Database, Scheduler, Table privacy and Embeddings should be green. Then **Settings → Notifications**:
   allow notifications on your phone and send a test.

---

## 4. Configuration (environment variables)

Copy `.env.example` to `.env.local` (local) and set the same names in Vercel (live). `.env.example` is the template but
**is not complete** (see [Known issues](#13-known-issues), E3); this table is.

**Required to run**

| Name | Meaning |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SECRET_KEY` | Server-only `sb_secret_…` key |
| `APP_PASSWORD` | The owner password. Empty locally means no lock. In production with it empty, every page answers 503 |
| `GEMINI_API_KEY` | Main AI and embeddings. Without it, embeddings fail |
| `CRON_SECRET` | Secret for the cron routes. Without it they answer 401 and apps / web tasks build inline instead of in the background |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push keys. Without them there are no notifications **and `/api/cron/notify` answers 503**, so all background jobs stop |

**Optional: AI providers** (each is skipped when its key is unset; order: gemini, nvidia, openrouter, mistral, groq)

| Name | Default | Meaning |
|---|---|---|
| `NVIDIA_API_KEY` / `NVIDIA_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | NVIDIA NIM fallback (25 s timeout) |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | `nvidia/nemotron-3.5-lightning:free` | OpenRouter free models (25 s) |
| `MISTRAL_API_KEY` / `MISTRAL_MODEL` | `ministral-14b-latest` | Mistral (20 s) |
| `GROQ_API_KEY` / `GROQ_MODEL` | `qwen/qwen3.8-27b` | Groq (8 s), intent router and organizer |
| `GEMINI_CHAT_MODEL` | `gemini-3.5-flash-lite` | Primary chat model |
| `GEMINI_FALLBACK_MODEL` | `gemini-2.5-flash` | Second Gemini model |
| `GEMINI_MODELS` | unset | Comma list that replaces both of the above |
| `GEMINI_EMBED_MODEL` | `gemini-embedding-001` | Embedding model (must give 768 numbers) |
| `GEMINI_APP_MODEL` | `gemini-3.5-flash-lite` | Model that writes mini-apps |
| `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | `gemini-3.8-flash-tts` | Text to speech |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` | Live voice conversation |
| `WEB_SEARCH_MODELS` | `gemini-2.5-flash,gemini-2.5-flash-lite` | Models with Google Search grounding |

**Optional: places, time, taste**

| Name | Default | Meaning |
|---|---|---|
| `APP_URL` | request origin | Public URL, used when the server calls itself (cron hand-offs, apps, web tasks, calls) |
| `BRIEF_HOUR` | 8 | Local hour the morning brief opens |
| `HOME_TZ` | `Asia/Kolkata` | Time zone for reminders and daily jobs |
| `HOME_CITY` | `Chennai` | Default weather city |
| `MUSIC_LANGUAGE` | `tamil` | Default song language |
| `PORTFOLIO_MCP_URL` | empty | Portfolio MCP endpoint; empty reads GitHub data files instead |
| `PORTFOLIO_DATA_REPO` | `Karthikeyan260/Portfolio-mcp` | GitHub repo of portfolio data |
| `GITHUB_USER` | `Karthikeyan260` | Whose repos feed the project evolution view |

**Optional: extra services**

| Name | Meaning |
|---|---|
| `STEEL_API_KEY` | Cloud browser for web tasks. Without it web tasks cannot run |
| `RAPIDAPI_KEY` (or `RAPIDAPI_SECRET`) | JSearch job search on the Career page; without it that feature answers 503 |
| `YOUTUBE_API_KEY` | Better video search; works without it |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | Cloudflare TURN relay for calls, games and Theatre behind strict networks |
| `METERED_DOMAIN`, `METERED_API_KEY` | Metered TURN relay (alternative) |
| `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USER`, `NEXT_PUBLIC_TURN_PASS` | Static TURN server handed to the browser (public by design) |
| `VAPID_SUBJECT` | Push contact, default `mailto:owner@hivemind.local` |
| `SESSION_SECRET`, `PEER_SECRET` | Optional signing keys (32+ characters). If unset, random ones are generated and kept in the private bucket |

Set by the platform: `NODE_ENV`, and `VERCEL_GIT_COMMIT_SHA` (becomes the build id `NEXT_PUBLIC_BUILD`, which is how phones know to
refresh after a deploy). Test-only: `E2E_PORT`, `E2E_PASSWORD`, `SWEEP`, `DB_TESTS`, `TOOLS_LIVE`, `SUPABASE_PUBLISHABLE_KEY`.

---

## 5. Features

### 5.1 Your brain
- **Notes**: AI adds a title, summary, category, tags and an embedding when you save.
- **Memories**: 8 types (fact, knowledge, experience, decision, idea, preference, project_context, learning), importance 1 to 10,
  **version history with restore**, re-embedded when edited.
- **Documents**: PDF, TXT, MD, DOCX, CSV (up to 4 MB) are split into chunks with page numbers and embedded.
- **Photos**: described and tagged with where and when they were taken, so you can search "Ooty trip".
- **Projects**: created from your portfolio and from your saves; new items are filed into the right project automatically. Each
  automatic action shows in an activity feed with **undo**. An Evolution view shows projects in real build order (GitHub).
- **Ask My Brain**: RAG chat with numbered sources, a project filter and a choice of model.
  - `remember that …` saves a memory.
  - `update my memory about …` finds candidates and never changes one without you.
- **Semantic search** across notes, memories and document chunks, optionally scoped to a project.
- **Memory explorer / palace**, **Export brain** (JSON), per-item delete.
- **Sources**: sync your Portfolio MCP (`PORTFOLIO_MCP_URL`, falling back to its GitHub data) into about 29 memories plus your
  resume, and import any public page (portfolio site, Linktree). LinkedIn blocks automated readers, so save your profile as a PDF and upload it.
- **Chat history** is saved; there is no page to browse it yet.

### 5.2 Talking to it
- **Wake word** you teach it. Matching runs in the browser; only speech features are stored, not audio.
- **Hands-free conversation** with Gemini Live in English, Tamil or Tanglish. **Kitchen mode** (`/focus`) keeps the screen awake with a big orb.
- **Spoken replies**, an optional **"speak in my voice"** clone, and a **voiceprint** that acts as a speed bump for risky spoken actions.
- Most pages register **voice actions**, so you can run them by speaking.

### 5.3 Working for you
- **Autopilot**: a few times a day it reads your whole brain, connects the dots, and tells you what needs you. Read-only: it never changes or deletes anything on its own.
- **Web tasks**: drives a real cloud browser (Steel). It stops for your approval before anything it can't undo (submit, pay, send, delete).
- **Apps**: describe a tool and HIVEMIND writes it as a sandboxed mini-app (no same-origin access, no network), adds it to the menu, and you can pin it and use it by voice.
- **Dream mode**: overnight it merges duplicate memories and updates out-of-date facts, logging every change (the full deleted row is logged first) so it can be undone.
- **Morning brief** with fresh news on up to four topics you follow, **day brief**, weekly view, **Goodnight**, and **panels** on the home screen.

### 5.4 Your day
- **Habits**: tick them off in the app, by voice, or from the notification; snooze. **Birthdays** come with a wish ready to send.
- **Reminders**, **routines** (named multi-step routines), **night check-ins**, **Mission control** (its background workers drawn as robots).
- **Career**: paste a job description and get a match, a tailored resume PDF, a cover letter and interview prep built from your real experience.
- **Map and places** (OpenStreetMap, your devices), **music** and **video** search, a daily **Thirukkural**.
- **Calls**: HIVEMIND answers when you can't pick up, asks who is calling and why, and sends you a one-line summary. You also get a permanent "call me" link.
- **Share**: on Android, Share to HIVEMIND reads links, describes photos and files PDFs and Word documents.

### 5.5 Play
- **Nova**, a glowing lantern pet that wanders the screen, plays hide and seek (you find it by voice), sulks when ignored, dresses for festivals, talks in its own voice, and answers to its name (rename it by voice).
- **Nova's garden**: a 3D floating island you can turn and zoom.
  - **What grows**: a flower for every day a habit was done, a tree for every 4 night check-ins, a lamp for each lantern walk, a gem for each game won, butterflies for songs played.
  - **Nova's life there**: it strolls the island, naps in its cottage and sleeps there at night; tap anything and Nova walks over.
  - **Scene and sky**: wind-swept grass that parts around Nova, a pond and waterfall, a sea of clouds; sky and weather follow your real time of day and local weather. Devices without WebGL get a flat version.
- **Games**: Chess, Colour Clash (Uno-style cards), Business, Bingo, Connect Four, Snakes & Ladders, Ludo, Dots & Boxes, Draw & Guess (HIVEMIND guesses as the third player), the **Paattu** Tamil song quiz, and a **game-night lobby** (one link, up to 5 friends). Chess, cards, Ludo, Dots and Draw & Guess can be joined with a link; the others work solo or at game night.
- **Karaoke** (Tamil songs only): pick a song on the Karaoke page, or tap the mic on the music bar while a Tamil song plays. By default it plays the song's **karaoke track** (music only, no singer: a YouTube karaoke video of the same length) so you are the singer, and the lyrics light up line by line in time (synced lyrics from LRCLIB, matched to the exact recording). A switch plays the full song **with the singer** instead, which is also the fallback when a song has no karaoke track. Tap a line to jump to it; nudge the timing with the sync buttons; the mascot sings along. No scoring and no microphone.
- **Day comic** (four moments of your day; Gemini picks them, the art is the mascot's pre-drawn frames), **My Wrapped** (your month in story cards), **Journey** (your career walked through in 3D), **Galaxy** (your knowledge as stars).
- **Living sky** (the app background follows your weather) and **Music lights** (the screen pulses to the beat).

### 5.6 Friends Theatre
Watch Tamil films, Tamil-dubbed films, anime and cartoons together from **one permanent room link**: in step, with chat, reactions
and voice, browser to browser (PeerJS mesh), with the films staying on YouTube. About 10,000 videos with genres, a genre
shelf, text and voice search, and rejoin after leaving the room. Full detail: [docs/friends-theatre.md](docs/friends-theatre.md).

### 5.7 The app shell
- **Installable PWA** with offline reading and a queue for writes made offline, an auto-refresh after each deploy, and Web Push.
- **Command palette** (Ctrl K), sidebar on desktop, tab bar on phone, a language card, and a dark theme.

---

## 6. Pages

46 pages. Owner pages need the password; the guest pages are open.

**Home and brain**

| URL | Purpose |
|---|---|
| `/` | Home dashboard: galaxy, chat console, profile, agenda, habits, pinned cards (no sidebar) |
| `/notes` | Notes with AI summary, category, tags |
| `/memories` | Browse, add, edit memories; palace and explore views |
| `/documents` | Upload PDF, TXT, MD, DOCX, CSV |
| `/photos` | Add and search photos |
| `/projects`, `/projects/<id>` | Workspaces, evolution view, one project |
| `/search` | Semantic search |
| `/sources` | Import your own data (portfolio and others) |
| `/dream` | Overnight dream log: merged memories, updated facts, undo |

**Working for you**

| URL | Purpose |
|---|---|
| `/autopilot` | What HIVEMIND found on its own; mark done or dismiss |
| `/web` | Web tasks with Approve before irreversible steps |
| `/apps`, `/apps/<id>` | Build and run sandboxed mini-apps; pin to home |
| `/brief` | Morning brief and news topics |
| `/mission` | Mission control: each background agent's state |
| `/routines` | Named multi-step routines |
| `/share` | Save a link, text, photo or file; receives Android shares |

**Daily life**

| URL | Purpose |
|---|---|
| `/habits` | Habits and birthdays |
| `/career` | Job match, tailored resume, cover letter, interview prep |
| `/map` | Where you are, your devices, nearby places, directions |
| `/calls` | Calls HIVEMIND answered; your call link |
| `/focus` | Kitchen mode (hands-free, screen awake; no sidebar) |

**Play**

| URL | Purpose |
|---|---|
| `/garden` | Nova's garden (3D island) |
| `/games` | Menu of 11 games plus your record |
| `/games/party`, `/games/paattu`, `/games/chess`, `/games/cards`, `/games/business`, `/games/bingo`, `/games/connect4`, `/games/snakes`, `/games/ludo`, `/games/dots`, `/games/draw` | Each game; party is the game-night lobby |
| `/karaoke` | Karaoke: Tamil songs with lyrics that light up in time |
| `/comic`, `/wrapped`, `/journey` | Day comic, My Wrapped, Journey |
| `/theatre` | Friends Theatre shelf and "My room" link |

**Settings:** `/settings` holds AI provider status, language, voice, wake word, voiceprint, location, notifications, signed-in devices,
system check and export.

**Open pages (no password):** `/unlock` (sign in), `/call/<room>` (a call), `/play/<room>` (a friend joins a game),
`/theatre/<room>` (a friend joins a theatre room). `/share-in` is a POST-only route used by the Android share target.

---

## 7. API reference

All 100 routes. **owner** = behind the password; **open** = reachable without it (guest doors); **cron** = needs the
`CRON_SECRET` bearer header. Dynamic segments are written `:id`.

**Platform: sign-in, push, health, relay logins, cron** ([docs/01-architecture-and-platform.md](docs/01-architecture-and-platform.md))

| Methods | Route | Access |
|---|---|---|
| `GET` | `/api/cron/keepalive` | cron |
| `GET` | `/api/health` | owner |
| `GET` | `/api/ice` | open |
| `POST` | `/api/peer/proof` | owner |
| `POST` | `/api/peer/verify` | open |
| `GET,POST,DELETE` | `/api/push` | owner |
| `POST` | `/api/push/test` | owner |
| `POST,DELETE` | `/api/unlock` | open |
| `GET` | `/api/version` | owner |

**Brain: notes, memories, documents, photos, projects, search, chat** ([docs/02-brain-and-ai.md](docs/02-brain-and-ai.md))

| Methods | Route | Access |
|---|---|---|
| `GET,POST` | `/api/brain` | owner |
| `GET,DELETE` | `/api/conversations/:id` | owner |
| `GET` | `/api/conversations` | owner |
| `GET,DELETE` | `/api/documents/:id` | owner |
| `GET,POST` | `/api/documents` | owner |
| `GET,POST` | `/api/embeddings` | owner |
| `GET` | `/api/export` | owner |
| `POST` | `/api/hivemind` | owner |
| `GET,POST` | `/api/import` | owner |
| `GET` | `/api/memories/:id/detail` | owner |
| `GET,PUT,DELETE` | `/api/memories/:id` | owner |
| `GET,POST` | `/api/memories/:id/versions` | owner |
| `GET` | `/api/memories/explore` | owner |
| `GET,POST` | `/api/memories` | owner |
| `GET,PUT,DELETE` | `/api/notes/:id` | owner |
| `GET,POST` | `/api/notes` | owner |
| `GET` | `/api/photos/:id` | owner |
| `GET,POST,PATCH,DELETE` | `/api/photos` | owner |
| `GET,PUT` | `/api/prefs` | owner |
| `GET,PUT,DELETE` | `/api/projects/:id` | owner |
| `GET` | `/api/projects/evolution` | owner |
| `GET,POST` | `/api/projects` | owner |
| `POST` | `/api/search` | owner |
| `GET` | `/api/sessions` | owner |
| `POST` | `/api/share` | owner |

**Voice** ([docs/03-voice-and-wake-word.md](docs/03-voice-and-wake-word.md))

| Methods | Route | Access |
|---|---|---|
| `POST` | `/api/live/log` | owner |
| `POST` | `/api/live/token` | owner |
| `POST` | `/api/tts` | owner |
| `GET,POST,PATCH,DELETE` | `/api/voice/mine` | owner |

**Working for you: Autopilot, web tasks, apps, briefs, panels, tools** ([docs/04-autopilot-web-tasks-apps.md](docs/04-autopilot-web-tasks-apps.md))

| Methods | Route | Access |
|---|---|---|
| `POST` | `/api/agent-tool` | owner |
| `GET,PUT,POST` | `/api/apps/:id/data` | owner |
| `GET,PATCH,DELETE` | `/api/apps/:id` | owner |
| `GET,POST` | `/api/apps` | owner |
| `GET,POST,PATCH` | `/api/autopilot` | owner |
| `GET` | `/api/brief/day` | owner |
| `GET,POST,PATCH` | `/api/brief` | owner |
| `GET` | `/api/cron/app-build` | cron |
| `GET` | `/api/cron/web-task` | cron |
| `GET,POST,PATCH` | `/api/dream` | owner |
| `GET,PUT` | `/api/panels` | owner |
| `GET` | `/api/tools/origin` | owner |
| `GET` | `/api/tools/weather` | owner |
| `POST` | `/api/tools/web` | owner |
| `GET,POST,DELETE` | `/api/web-tasks/:id` | owner |
| `GET` | `/api/web-tasks/:id/shot` | owner |
| `GET,POST,DELETE` | `/api/web-tasks` | owner |

**Daily life: habits, reminders, birthdays, career, calls, map, music** ([docs/05-daily-life-habits-reminders-career.md](docs/05-daily-life-habits-reminders-career.md))

| Methods | Route | Access |
|---|---|---|
| `DELETE` | `/api/birthdays/:id` | owner |
| `POST` | `/api/birthdays/:id/wish` | owner |
| `GET,POST` | `/api/birthdays` | owner |
| `POST` | `/api/call/ring` | open |
| `POST` | `/api/call/screen` | open |
| `GET,PATCH,DELETE` | `/api/calls` | owner |
| `POST,GET` | `/api/career/:id/resume` | owner |
| `GET,DELETE` | `/api/career/:id` | owner |
| `GET,PUT` | `/api/career/master` | owner |
| `GET,POST` | `/api/career` | owner |
| `GET,POST` | `/api/checkin` | owner |
| `GET` | `/api/cron/notify` | cron |
| `POST` | `/api/habits/:id/check` | owner |
| `DELETE` | `/api/habits/:id` | owner |
| `POST` | `/api/habits/:id/snooze` | owner |
| `GET,POST` | `/api/habits` | owner |
| `GET` | `/api/kural` | owner |
| `GET,POST,DELETE` | `/api/location` | owner |
| `GET` | `/api/mission` | owner |
| `GET` | `/api/music/search` | owner |
| `GET` | `/api/music/karaoke` | owner |
| `GET` | `/api/music/lyrics` | owner |
| `POST` | `/api/music/stream` | owner |
| `GET` | `/api/places` | owner |
| `PATCH,DELETE` | `/api/reminders/:id` | owner |
| `POST` | `/api/reminders/act` | owner |
| `GET` | `/api/reminders/due` | owner |
| `GET,POST` | `/api/reminders` | owner |
| `GET,POST,DELETE` | `/api/routines` | owner |
| `GET` | `/api/video/search` | owner |

**Play: Nova, garden, games, comic, Wrapped, Journey** ([docs/06-nova-garden-games-and-stories.md](docs/06-nova-garden-games-and-stories.md))

| Methods | Route | Access |
|---|---|---|
| `GET,POST` | `/api/comic` | owner |
| `GET,POST` | `/api/diary` | owner |
| `GET` | `/api/galaxy` | owner |
| `POST` | `/api/games/guess` | owner |
| `POST` | `/api/games/knock` | open |
| `GET,POST` | `/api/games/paattu` | owner |
| `GET,PATCH` | `/api/games/room` | owner |
| `GET,POST` | `/api/games/stats` | owner |
| `GET` | `/api/journey` | owner |
| `GET` | `/api/pet/garden/day` | owner |
| `GET` | `/api/pet/garden` | owner |
| `GET` | `/api/pet/goodnight` | owner |
| `GET,PATCH,POST` | `/api/pet` | owner |
| `GET` | `/api/wrapped` | owner |

**Friends Theatre** ([docs/friends-theatre.md](docs/friends-theatre.md))

| Methods | Route | Access |
|---|---|---|
| `GET,POST` | `/api/theatre/room` | owner |

Per-route descriptions are in [docs/api-reference.md](docs/api-reference.md).

---

## 8. Data

### 8.1 Database (Supabase Postgres + pgvector)

Ten tables, all in `public`, all with RLS enabled and **no policies**, so only the server secret key can read or write.

| Table | Holds |
|---|---|
| `projects` | Workspaces: name, description, status, metadata, `source_key` (unique name and source key) |
| `notes` | Title, content, summary, category, tags, `embedding vector(768)`, optional project |
| `memories` | Title, content, one of 8 types, importance 1 to 10, confidence, tags, `embedding vector(768)` |
| `memory_versions` | Version history of a memory (deleted with it by cascade) |
| `documents` | Filename, type, status (`processing`, `ready`, `failed`), summary, chunk count, source URL |
| `document_chunks` | Chunk text, page metadata, `embedding vector(768)` |
| `conversations`, `messages` | Saved chat history |
| `brain_profile` | One row: what the AI understands about you |
| `activity` | Log of every automatic action, with an `undone` flag |

Functions: `match_knowledge(query_embedding, match_count, filter_project, min_similarity)` does semantic search over notes,
memories and chunks (HNSW cosine indexes); `keepalive()` is called by the daily cron; `tables_without_rls()` and an event trigger
`rls_auto_enable` keep RLS on for any table created later. Embeddings are fixed at 768 numbers.

### 8.2 Private store

A private Supabase Storage bucket (`hivemind-private`) holds small JSON files for things that don't need a table: signed-in
sessions (hashed), signing secrets, push subscriptions (up to 10 devices), scheduler bookkeeping (`notify-state`), alert state,
failed-login markers, settings, call and game room codes, device locations, web tasks, apps, and the pet.

### 8.3 On your device

IndexedDB `hivemind-offline` (cached lists, queued writes), Cache Storage (`hivemind-pages`, `hivemind-static`, `hivemind-share`),
cookies `sb_owner` (session) and `sb_trusted`, a few `sessionStorage` markers, and the wake word, voiceprint and speaker model.

---

## 9. Security and privacy

- **The gate.** `proxy.ts` makes every page and API private except a short named list: `/unlock`, `/api/unlock`,
  `/manifest.webmanifest`, `/sw.js`, `/robots.txt`, `/api/call/ring`, `/api/call/screen`, `/api/games/knock`, `/api/peer/verify`,
  `/api/ice`, and the prefixes `/call/`, `/play/`, `/theatre/`. Cron routes check `CRON_SECRET` themselves.
- **Brute-force guard.** Sign-in is limited per address (8 attempts), globally (60), over a 15-minute window. A browser you have
  signed in from before (trusted cookie) is exempt from the global lockout.
- **Sessions.** 180 days; each session stores a fingerprint of the password it was opened with, so changing `APP_PASSWORD` signs
  every device out. Settings lists signed-in devices.
- **Database.** Server-only secret key; RLS on every table with no policies; the public key reads nothing. Settings → System check
  alerts if a table has RLS off.
- **Guest doors** show only their own room; call and game links require a room the owner created. Peer connections verify the host
  with a signed challenge (`/api/peer/proof`, `/api/peer/verify`).
- **Safe by design.** Autopilot only reads. Apps run in a sandbox with no network. Web tasks stop for approval before irreversible
  steps. Dream mode logs the full row before it deletes. Lock / sign out clears the offline store, the write queue, saved pages and a pending share.
- **What leaves the server.** Text sent to AI providers to answer you (on the free tier Gemini may use prompts to improve Google
  products, so **do not store passwords or secrets**), requests to weather, news, music and video sources, and push messages. Voice
  audio goes to Gemini Live during a conversation; the wake word matches on the device.
- **Honest limits.** The voiceprint is a speed bump, not a lock (checked in the browser only). Locking does not remove the wake word,
  voiceprint or speaker model from the device. `/api/ice` is open and unthrottled. More in [Known issues](#13-known-issues).

---

## 10. Operations

### 10.1 Scheduled jobs

| Job | Where | Schedule | Does |
|---|---|---|---|
| Keepalive | `vercel.json` | daily, 09:00 UTC | Keeps Supabase awake; alerts "Scheduler stopped" if the scheduler has been silent over 2 h |
| **Scheduler** | **cron-job.org (outside the repo)** | **every ~5 min** | Calls `/api/cron/notify` (below) |
| App build | self-call | on demand | Builds an app asked for by voice or chat |
| Web task | self-call and scheduler | on demand | Next 60 s leg of a web task |

One `/api/cron/notify` run, in order: push reminders that just came due; the "Good morning" push (from `BRIEF_HOUR` to 12:00);
birthday and habit alerts and pet nudges; My Wrapped on the 1st; the 21:00 night check-in nudge; Dream mode (if enabled); Nova's
diary at 23:00; the news brief; Autopilot when due; re-embedding of rows saved while embeddings were down; a daily RLS check;
recovery of stuck app builds and web tasks. It stamps `lastRun`, shown in System check as "scheduler last checked".

### 10.2 Free-tier limits

| Service | Limit | How the app copes |
|---|---|---|
| Vercel Hobby | 60 s per request, 4.5 MB body | Uploads capped at 4 MB; long jobs continue in the background or via self-calls |
| Vercel cron | once a day | One daily keepalive; real scheduling is cron-job.org |
| Supabase Free | 500 MB, pauses after 7 idle days | 768-d embeddings; daily keepalive |
| Gemini free | per-minute and per-day limits | Falls back to NVIDIA, OpenRouter, Mistral, then Groq |
| NVIDIA NIM | trial credits, models get retired | 25 s timeout; change `NVIDIA_MODEL` |
| OpenRouter / Mistral / Groq | small free quotas | 25 s / 20 s / 8 s timeouts; Groq falls back to keyword rules |
| Web Push | none fixed | 10 s send timeout; at most 10 devices stored |

### 10.3 Changing the embedding model

The database records which model made its vectors (default `gemini-embedding-001`, 768-d) and keeps using it even if
`GEMINI_EMBED_MODEL` changes, so vectors from two models never get mixed. To switch: set the new model, then
**Settings → System check → Re-embed everything**. It runs in sub-minute steps (the scheduler carries on if you close the page)
and switches searches over only when every note, memory and document chunk is done. The new model must give 768 numbers.

### 10.4 Backup and restore

- **Back up:** Settings → Export your brain → Download (or open `/api/export` while signed in) gives
  `second-brain-YYYY-MM-DD.json`. Nothing does this automatically, so take one now and then and keep it off the app.
- **Restore** (on your own computer, in the repo, with `.env.local` filled in):
  ```bash
  npm run restore -- second-brain-2026-10-28.json                       # dry run: counts per table, writes nothing
  npm run restore -- second-brain-2026-10-28.json --apply               # adds only what is missing, by id
  npm run restore -- second-brain-2026-10-28.json --apply --overwrite   # also replaces rows that exist
  ```
  Afterwards the scheduler re-embeds notes and memories; for documents run Settings → Embeddings → re-embed. Sign in again and
  re-subscribe each phone to notifications (sessions and push addresses are not in the backup).

### 10.5 Runbook

- **Change the password:** edit `APP_PASSWORD` in Vercel and redeploy. Every session ends at once.
- **Rotate a secret:** `SUPABASE_SECRET_KEY` (create a new key, update Vercel, delete the old one); `CRON_SECRET` (change in Vercel, then
  update the header in cron-job.org); AI keys (revoke, set new, redeploy); VAPID keys (every phone must re-subscribe). If `.env.local`
  ever reached GitHub, rotate everything in it.
- **Supabase paused:** click Restore project in the Supabase dashboard; check the daily cron ran and `CRON_SECRET` is set. Keep an export file.
- **An AI model was retired:** set the replacement (`GEMINI_CHAT_MODEL`, `NVIDIA_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `MISTRAL_MODEL`, …) and redeploy.
- **A push did not arrive:** send a test from Settings → Notifications; check the VAPID keys exist; check System check → Scheduler; check the phone allows notifications for the installed app.
- **Scheduler stopped:** check the cron-job.org job is enabled and has the right URL and header. Test by hand:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/notify`; a 503 means missing VAPID keys.
- **The app is not updating on a phone:** it checks for a new build every 5 minutes and when it returns to the front, but never
  mid-voice-chat, game or call. Close and reopen it; if still old, confirm the Vercel deploy finished, then clear site data.
- **A Theatre film no longer plays:** `npm run theatre:links`, then edit the matching `lib/theatre/*-films.ts`.

---

## 11. Testing

```bash
npm test                            # unit tests (vitest)
npm run test:db                     # live checks against your Supabase project (adds and removes 2 test notes)
npm run build && npm run test:e2e   # Playwright: lock screen, wrong password, unlock → chat (AI stubbed) → lock, desktop + phone
npm run lint                        # ESLint
```

At the last run: 104 test files, 774 tests; type check and lint clean; 13 skipped because they need a database or the network.
Friends Theatre has its own large unit and browser test set. Run browser tests against a production build and skip tests that log
in with the real password (they share sessions with the live site). A manual walk-through is in [docs/manual-test.md](docs/manual-test.md).

**Not covered by tests:** session lockout and revocation, the open-path list, the offline layer, the backup export and restore,
`/api/cron/notify`, the web-task approval gate, the apps sandbox and build path, the habit alert runner, the voice routes, and
most 3D scenes. Details in [docs/08-testing-and-operations.md](docs/08-testing-and-operations.md).

---

## 12. Project layout

```text
app/(app)/...         owner pages (notes, memories, documents, projects, settings, games, ...)
app/(bridge)/         the home dashboard (no sidebar)
app/api/...           route handlers (owner-only via proxy; DB via server secret key)
proxy.ts              owner gate (Next 16 name for middleware)
lib/ai/               provider interface, Gemini, NVIDIA/OpenRouter/Mistral/Groq, router, embeddings, metadata
lib/rag/              chunker, retrieval (match_knowledge RPC), grounded answering
lib/knowledge.ts      create/update notes and memories (metadata, embedding, versioning)
lib/agents/           orchestrator, intent router, quick commands, chat tools
lib/web-agent/        web tasks (cloud browser runner, approval gate)
lib/imports/          portfolio MCP client and web page importer
lib/voice, lib/wake, lib/voiceprint   voice session, wake word, speaker check
lib/theatre/          Friends Theatre catalogue and room protocol
components/pet/       Nova: the on-screen pet, looks, voice, games
components/garden/    Nova's garden: three.js island and the flat fallback
public/sw.js          service worker (offline, push, share target)
supabase/             schema.sql and migrations 002 to 004
tests/, e2e/          vitest unit and live-DB tests, Playwright browser tests
scripts/              restore-backup, theatre link checks, and similar
docs/                 the detailed documentation
```

---

## 13. Known issues

The full list (about 55 items, each marked "Confirmed" or "Reported") is in [docs/known-issues.md](docs/known-issues.md). The ones
that matter most:

1. **The scheduler is outside the repo.** Everything periodic (reminders, briefs, Dream mode, Autopilot, web-task resume) depends on a
   cron-job.org job you set up by hand. Without VAPID keys the jobs still run but no push is sent.
2. **The "answer" pattern for approving a web task is very loose** (the words "yes", "no", "ok" unlock it).
3. **Config drift:** `schema.sql` alone is stale (run all four SQL files); the `graft/` index is empty.
4. **Data safety:** deleting
   notes, documents, photos and projects cannot be undone; there is no automatic backup.
5. **Voice:** the voiceprint is a speed bump, not a lock; locking does not clear the wake word or speaker model from the device.
6. **UX gaps:** reminders have no form (chat, voice or API only); chat history cannot be browsed; no light theme; some accessibility gaps
   (no focus trap in the palette, no skip link); festival decor is hard-coded through 2028.

*Fixed on 2026-11-11:* the 503 when VAPID keys were missing, note edits failing when embeddings are down, web tasks re-pausing at 40
steps after Continue, "remember that the meeting ..." going to the Scheduler agent, and the garbled `.env.example`.

---

## 14. Glossary

| Word | Meaning |
|---|---|
| Brain | Your saved notes, memories, documents, photos and projects |
| Memory | A short saved fact, decision, idea and so on, with importance and history |
| Embedding | A list of 768 numbers that stands for the meaning of a text, used for search |
| RAG | Answering from your own data: find the relevant pieces, then let the AI answer using only them |
| Organizer | The part that files new items into the right project |
| Autopilot | The background reader that tells you what needs attention |
| Dream mode | The nightly tidy-up of memories |
| Nova | The pocket pet |
| Wake word | The phrase you say to start a hands-free conversation |
| Voiceprint | A match of your voice used to guard risky spoken actions |
| Cron secret | The secret an outside scheduler sends to run background jobs |
| VAPID | The keys that let the server send push notifications |
| PWA | A website you can install on a phone like an app |
| RLS | Row-level security: the database blocks everything except the server key |
| Opener / room code | In Friends Theatre: the browser holding the room, and the permanent link's random code |

---

## 15. Further reading

| Topic | Document |
|---|---|
| Master index | [docs/HIVEMIND.md](docs/HIVEMIND.md) |
| Architecture, sign-in, push, offline, database | [docs/01-architecture-and-platform.md](docs/01-architecture-and-platform.md) |
| Notes, memories, documents, search, Ask My Brain | [docs/02-brain-and-ai.md](docs/02-brain-and-ai.md) |
| Voice, wake word, voiceprint | [docs/03-voice-and-wake-word.md](docs/03-voice-and-wake-word.md) |
| Autopilot, web tasks, apps, Dream, briefs | [docs/04-autopilot-web-tasks-apps.md](docs/04-autopilot-web-tasks-apps.md) |
| Habits, reminders, birthdays, career, calls, map, music | [docs/05-daily-life-habits-reminders-career.md](docs/05-daily-life-habits-reminders-career.md) |
| Nova, garden, games, comic, Wrapped, Journey | [docs/06-nova-garden-games-and-stories.md](docs/06-nova-garden-games-and-stories.md) |
| App shell, pages, navigation | [docs/07-app-shell-pages-and-navigation.md](docs/07-app-shell-pages-and-navigation.md) |
| Testing and operations | [docs/08-testing-and-operations.md](docs/08-testing-and-operations.md) |
| Every API route with descriptions | [docs/api-reference.md](docs/api-reference.md) |
| Everything broken, risky or missing | [docs/known-issues.md](docs/known-issues.md) |
| Friends Theatre | [docs/friends-theatre.md](docs/friends-theatre.md) |
| Manual test walk-through | [docs/manual-test.md](docs/manual-test.md) |
