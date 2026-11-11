# Testing and operations

How HIVEMIND is tested, how it is deployed and kept alive, and what to do when something breaks. Written from the code,
config and tests in the repo (checked 2026-11-10). Where a statement could not be verified from the repo, it says
"not verified".

## 1. What it does

- **Unit tests** (`tests/`, vitest): 104 files, 774 tests. Pure logic and fakes. No network, no database, no AI.
- **Live tests** (opt-in): one file checks the real Supabase project, another runs every chat tool against the owner's data.
- **Browser tests** (`e2e/`, Playwright): lock screen, chat with a stubbed AI, a health sweep of every page, and Friends Theatre.
- **CI** (`.github/workflows/ci.yml`): lint, types, unit tests and a production build on every push to `main` and every pull request.
- **Scheduler and cron routes**: reminders, the morning brief, Autopilot, Dream mode, birthdays, habits, the keepalive.
- **Alerts**: a push notification when a background job fails, when the scheduler stops, or when a table loses row level security.
- **Backup**: "Export Brain" downloads one JSON file. `scripts/restore-backup.mjs` puts it back.
- **Manual test list**: `docs/manual-test.md` covers what no machine can check (mic, phone, notifications, two people).

## 2. How to use it

All commands run from the repo root (`second-brain`).

| What | Command | Needs |
|---|---|---|
| Unit tests | `npm test` (= `vitest run`) | Node and `npm install`. Nothing else. |
| One unit test file | `npx vitest run tests/ludo.test.ts` | Same. |
| Database tests | `npm run test:db` | `.env.local` with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the real project). Optional `SUPABASE_PUBLISHABLE_KEY` for the "public key can't read" test. Adds 2 throwaway notes and deletes them. |
| Live tool tests | `TOOLS_LIVE=1 npx vitest run tests/tools.live.test.ts` (no npm script) | `.env.local`, real Supabase, and AI keys. Creates and removes items named `HMTEST ...`. |
| Browser tests | `npm run build` then `npm run test:e2e` | A production build, a free port (3000, or set `E2E_PORT`), `.env.local` (real Supabase), password `localtest` (or set `E2E_PASSWORD`). |
| Page sweep | `npm run build` then `npm run test:sweep` | Same as browser tests. Writes screenshots and a JSON report to `test-results/sweep/`. |
| Theatre browser tests | part of `npm run test:e2e` | Same, plus PeerJS's free broker (they skip when it cannot be reached). |
| Types | `npx tsc --noEmit` | `npx next typegen` first on a fresh checkout (CI does this). |
| Lint | `npm run lint` (= `eslint`, whole repo) | Nothing else. |
| Film link check | `npm run theatre:links` | Internet. Exits 1 if a film is gone. |
| Restore a backup | `npm run restore -- <file.json> [--apply] [--overwrite]` | `.env.local` with the Supabase keys. |

Notes on the browser tests:

- `playwright.config.ts` starts `npx next start -p <port>` with `APP_PASSWORD=localtest`, or reuses a server already on that port.
  Two projects run (desktop Chrome and Pixel 7), one worker, 45 s timeout, no retries.
- The server uses `.env.local`, so it talks to the real Supabase project. Tests log out at the end and stub the AI, so they
  leave nothing behind and spend no quota. (Memory note: test logins share the real session store; always log out.)
- `e2e/sweep.spec.ts` skips itself unless run via `npm run test:sweep` or with `SWEEP` set.

### Which feature needs which kind of test

| You changed | Run at least |
|---|---|
| Any `lib/` logic | `npm test`, `npx tsc --noEmit`, `npm run lint` |
| Anything touching search or the database functions | the above plus `npm run test:db` |
| Login, proxy, headers, pages | `npm run build` then `npm run test:e2e` |
| Friends Theatre | `npm test` (theatre files) and the theatre e2e specs; see `docs/friends-theatre.md` |
| Voice, notifications, phone, calls | `docs/manual-test.md` on a real phone |

## 3. How it works

**Unit tests.** `vitest.config.mts` runs `tests/**/*.test.ts` in the `node` environment. It maps `@/` to the repo root and swaps
the `server-only` package for `tests/server-only-stub.ts` (the real one throws outside Next's server bundle). Most tests fake the
private store in memory so real modules run (`habits`, `pet`, `reminders`). The default per-test timeout is 5 s.

**Opt-in live tests.** Both use `describe.skipIf(!RUN)`. `db.integration.test.ts` runs when `DB_TESTS=1` or when started by
`npm run test:db`; it loads `.env.local` itself. `tools.live.test.ts` runs only with `TOOLS_LIVE=1`.

**CI.** One job on `ubuntu-latest` (Node 24, 15 min limit, one run per ref, older runs cancelled): `npm ci`, ESLint, `next typegen`,
`tsc --noEmit`, `npm test`, `npm run build`. It needs no secrets. The live DB tests and Playwright are not in CI.

**Scheduler.** Vercel's free plan runs its own cron only once a day, so a second, external scheduler (cron-job.org) must call
`/api/cron/notify` every few minutes. That job's settings are not in the repo (not verified: exact interval and URL). Each
run does the work in section 6.

**Alerts.** `lib/alerts.ts` sends one push per job per day when the brief, Dream mode, Autopilot or the scheduler fails. The
keepalive cron is a watchdog: if the scheduler has not run for 2 hours (`SCHEDULER_STALE_MS`), it pushes "Scheduler stopped".

### Files

| File | What it holds |
|---|---|
| `vitest.config.mts` | Unit test config (alias, `server-only` stub, include pattern). |
| `tests/server-only-stub.ts` | Empty replacement for `server-only`. |
| `playwright.config.ts` | Browser test config: port, password, desktop + phone projects, `next start` web server. |
| `e2e/*.spec.ts` | 7 browser specs (section 7). |
| `.github/workflows/ci.yml` | CI job. |
| `vercel.json` | The one Vercel cron (keepalive). |
| `scripts/check-theatre-links.mjs` | Checks every Theatre film still plays (YouTube oEmbed and Wikimedia Commons). |
| `scripts/restore-backup.mjs` | Restores from an export file. |
| `app/api/export/route.ts` | Builds the export file. |
| `app/api/cron/*/route.ts` | Scheduler, keepalive, app-build and web-task routes. |
| `app/api/health/route.ts`, `lib/health.ts` | Settings, System check. |
| `lib/alerts.ts` | Failure pushes and the stale-scheduler limit. |
| `app/api/version/route.ts`, `components/version-watcher.tsx` | Makes phones pick up a new build. |
| `next.config.ts` | Security headers, build id, packages kept out of the bundle. |
| `docs/manual-test.md` | The by-hand checklist. |
| `graft/` | See section 10. |

## 4. API (operations routes)

| Method | Path | Who may call | Purpose | Request | Response |
|---|---|---|---|---|---|
| GET | `/api/cron/keepalive` | Cron secret (`Authorization: Bearer <CRON_SECRET>`) | Daily database ping and scheduler watchdog | none | `{ok, at, scheduler: "ok"\|"stale"}`; 401 bad secret; 500 DB error |
| GET | `/api/cron/notify` | Cron secret, header or `?key=<CRON_SECRET>` | The every-few-minutes scheduler (section 6) | none | `{ok, reminders, brief, birthdays, habits, autopilot, web, dreaming, news, apps, reembedded, migrating}`; 401; 503 if VAPID keys are missing |
| GET | `/api/cron/app-build` | Cron secret (Bearer only) | Builds an app in the background | `?id=<uuid>` | 202 `{ok}`; 400 bad id; `{ok, nothing}` if nothing pending |
| GET | `/api/cron/web-task` | Cron secret (Bearer only) | Next leg of a web task | `?id=<uuid>` | 202 `{ok}`; 400; 401 |
| GET | `/api/health` | Owner session | System check list | none | `{checks: [{name, status, detail}]}` |
| GET | `/api/version` | Owner session | Build the server runs | none | `{build}` (no-store) |
| GET | `/api/export` | Owner session | Download the backup | none | JSON file `second-brain-YYYY-MM-DD.json` |

`/api/cron/` is excluded from the proxy matcher (`proxy.ts`), so these routes do their own secret check with a constant-time
compare (`safeEqual`). With no `CRON_SECRET` set they always answer 401.

## 5. Data

| Where | Key / table | What |
|---|---|---|
| Private store (`hivemind-private` bucket) | `notify-state` | Scheduler memory: `lastRun`, `lastSent`, and the date each daily job last ran (`brief`, `dream`, `diary`, `diaryFill`, `news`, `newsTry`, `rls`, `checkin`, `wrapped`). |
| Private store | `alert-state` | The day each failure alert was last sent (one per job per day). |
| Private store | `auth/sessions`, `auth/secrets`, `unlock-fails/*`, `unlock-fails-all/*` | Login state. Left out of backups on purpose. |
| Private store | `push-subscriptions` | Up to 10 device push addresses. Left out of backups. |
| Database | `keepalive()` function | `select now()`, in `supabase/schema.sql`. |
| Database | `tables_without_rls()` | Used by System check and the daily RLS alert (migration `004_rls_guard.sql`). |
| Browser | `sb_owner` cookie (180 days), `sb_trusted` cookie (1 year) | Session and "trusted device" marker. |
| File | `test-results/` | Playwright output. Ignore. |

Export file shape (version 2): `exported_at`, `version`, then these tables in full: `projects`, `notes`, `memories`,
`memory_versions`, `documents`, `document_chunks`, `conversations`, `messages`, plus `private` (every private-store file except
secrets). Embeddings are left out (`notes`, `memories` and `document_chunks` select named columns without them). Not included:
`auth/*`, `ratelimit*`, `unlock-fails*`, `web-tasks*`, `push-subscriptions.json`, `call-rooms.json`, `device-locations.json`.
Tables are read 1000 rows at a time (the database's cap) in a fixed order.

## 6. Configuration

### Environment variables

Found with `grep -rhoE "process\.env\.[A-Z_0-9]+" app lib components proxy.ts` plus `next.config.ts`, and the two dynamic
reads (`process.env[cfg.keyEnv]` in `lib/ai/openai-compatible.ts`, `${NAME}_SECRET` in `lib/secrets.ts`). Set them in `.env.local`
(local) and Vercel, Settings, Environment Variables (live). `.env.example` is the template.

**Required to run**

| Name | Meaning | Used in |
|---|---|---|
| `SUPABASE_URL` | Project URL | `lib/db.ts` |
| `SUPABASE_SECRET_KEY` | Server-only `sb_secret_...` key | `lib/db.ts` |
| `APP_PASSWORD` | The owner password. Empty locally means no lock. In production with it empty, every page answers 503 | `lib/session.ts`, `proxy.ts`, `app/api/unlock/route.ts` |
| `GEMINI_API_KEY` | Main AI and embeddings. Without it, embeddings fail | `lib/ai/gemini.ts`, `lib/apps.ts` |
| `CRON_SECRET` | Shared secret for the cron routes. Without it they all answer 401, and apps and web tasks build inline instead of in the background | cron routes, `lib/apps.ts`, `lib/web-agent/runner.ts` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push keys. Without them there are no notifications, and `/api/cron/notify` answers 503 (reminders, brief, birthdays and habits all stop) | `lib/push.ts`, `app/api/push/route.ts` |

**Optional: other AI providers** (each is skipped when its key is unset; fallback order is gemini, nvidia, openrouter, mistral, groq,
`lib/ai/providers.ts:25`)

| Name | Default | Meaning |
|---|---|---|
| `NVIDIA_API_KEY` / `NVIDIA_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | NVIDIA NIM fallback (25 s timeout) |
| `GROQ_API_KEY` / `GROQ_MODEL` | `qwen/qwen3.8-27b` | Groq (8 s timeout), intent router |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | `nvidia/nemotron-3.5-lightning:free` | OpenRouter free models (25 s). Not in README or `.env.example` |
| `MISTRAL_API_KEY` / `MISTRAL_MODEL` | `ministral-14b-latest` | Mistral (20 s) |
| `GEMINI_CHAT_MODEL` | `gemini-3.5-flash-lite` | Primary chat model (`lib/ai/gemini.ts`, `app/api/games/guess/route.ts`) |
| `GEMINI_FALLBACK_MODEL` | `gemini-2.5-flash` | Second Gemini model |
| `GEMINI_MODELS` | unset | Comma list that replaces both of the above |
| `GEMINI_EMBED_MODEL` | `gemini-embedding-001` | Embedding model (must give 768 numbers); the database keeps its recorded model until you re-embed |
| `GEMINI_APP_MODEL` | `gemini-3.5-flash-lite` | Model that writes apps (`lib/apps.ts`) |
| `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | `gemini-3.8-flash-tts`, voice default in code | Text to speech (`lib/tts.ts`, `app/api/live/token/route.ts`) |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` | Live voice (`app/api/live/token/route.ts`) |
| `WEB_SEARCH_MODELS` | `gemini-2.5-flash,gemini-2.5-flash-lite` | Models with Google Search grounding (`lib/external/web.ts`) |

**Optional: places, time, taste**

| Name | Default | Meaning |
|---|---|---|
| `APP_URL` | request origin | Public URL, used when the server calls itself (cron hand-offs, apps, web tasks, calls, OpenRouter referer) |
| `BRIEF_HOUR` | 8 | Local hour the morning brief opens (`/api/cron/notify`, `lib/mission-load.ts`) |
| `HOME_TZ` | `Asia/Kolkata` | Time zone for reminders and daily jobs (`lib/reminders.ts`, `lib/goodnight.ts`) |
| `HOME_CITY` | `Chennai` in `.env.example`; see `lib/external/weather.ts` | Default weather city |
| `MUSIC_LANGUAGE` | `tamil` | Default song language (`lib/music.ts`) |
| `PORTFOLIO_MCP_URL` | empty | Portfolio MCP endpoint; empty reads GitHub data files instead |
| `PORTFOLIO_DATA_REPO` | `Karthikeyan260/Portfolio-mcp` in `.env.example` | GitHub repo of portfolio data (`lib/imports/portfolio.ts`, `lib/origin.ts`) |
| `GITHUB_USER` | `Karthikeyan260` | Whose repos feed the evolution view (`lib/evolution.ts`) |

**Optional: extra services**

| Name | Meaning | Used in |
|---|---|---|
| `STEEL_API_KEY` | Cloud browser for Web tasks. Without it web tasks cannot run | `lib/web-agent/steel.ts` |
| `RAPIDAPI_KEY` (or `RAPIDAPI_SECRET`) | JSearch job search on the Career page; without it that feature answers 503 | `lib/external/jobs.ts` |
| `YOUTUBE_API_KEY` | Better video search; works without it (`lib/video.ts`, not verified how well) | `lib/video.ts` |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | Cloudflare TURN relay for calls, games and Theatre behind strict networks | `app/api/ice/route.ts` |
| `METERED_DOMAIN`, `METERED_API_KEY` | Metered TURN relay (alternative) | `app/api/ice/route.ts` |
| `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USER`, `NEXT_PUBLIC_TURN_PASS` | Static TURN server given to the browser (public by design) | `lib/ice.ts` |
| `VAPID_SUBJECT` | Contact for push, default `mailto:owner@hivemind.local` | `lib/push.ts` |
| `SESSION_SECRET`, `PEER_SECRET` | Optional signing keys (32+ characters). If unset, random ones are made and stored in the private bucket (`lib/secrets.ts`) | `lib/secrets.ts` |

**Set by the platform or the build:** `NODE_ENV`; `VERCEL_GIT_COMMIT_SHA` (becomes `NEXT_PUBLIC_BUILD`, the build id, in
`next.config.ts`; locally it is `local-<time>`, in dev `dev`). `NEXT_PUBLIC_BUILD` is read in `components/version-watcher.tsx` and
`app/api/version/route.ts`. Test-only: `E2E_PORT`, `E2E_PASSWORD`, `SWEEP`, `DB_TESTS`, `TOOLS_LIVE`, `SUPABASE_PUBLISHABLE_KEY`.

Variables in `.env.example` but never read in code: none found.

### Deployment steps (Vercel Hobby)

1. Supabase: create the project; in the SQL editor run `supabase/schema.sql`, then `supabase/migrations/002_single_user.sql`,
   `003_jarvis.sql`, `004_rls_guard.sql` in order. Copy the URL and the **secret** key.
2. Push the repo to GitHub (`.env*` is git-ignored except `.env.example`).
3. Vercel: Add New, Project, import the repo, framework Next.js.
4. Add all variables above (at least the "required" table, with a strong `APP_PASSWORD` and a random `CRON_SECRET`; make
   VAPID keys with `npx web-push generate-vapid-keys`, not verified in the repo but standard for the `web-push` package).
5. Deploy. Open the URL, enter the password once.
6. Add the scheduler: on cron-job.org create a job that calls `https://<your-app>/api/cron/notify` every few minutes, with the
   header `Authorization: Bearer <CRON_SECRET>` (or `?key=`). Not in the repo; set up by hand.
7. Settings, System check: Database, Scheduler, Table privacy and Embeddings should be green. Then run the "After a deploy" part of `docs/manual-test.md`.
8. Settings, Notifications: allow notifications on the phone and send a test.

A build id equal to the git commit is what makes phones refresh after a deploy (section 9).

### Scheduled jobs

| Job | Where | Schedule | Calls | Does |
|---|---|---|---|---|
| Keepalive | `vercel.json` (only entry) | `0 9 * * *` (09:00 UTC daily) | `/api/cron/keepalive` | Runs `keepalive()` so Supabase does not pause; pushes "Scheduler stopped" if `notify-state.lastRun` is over 2 h old |
| Scheduler | cron-job.org (outside the repo) | "every few minutes" per code comments | `/api/cron/notify` | Everything below |
| App build | self-call | on demand | `/api/cron/app-build?id=` | Builds an app that voice or chat asked for |
| Web task | self-call and scheduler | on demand | `/api/cron/web-task?id=` | Next 60 s leg of a web task |

What one `/api/cron/notify` run does, in order (`app/api/cron/notify/route.ts`): push reminders that just came due (returned if no
device took them); the "Good morning" push once a day from `BRIEF_HOUR` to 12:00 local; birthday and habit alerts and pet nudges;
"My Wrapped" on the 1st from 09:00; the 21:00 night check-in nudge (21:00 to 23:00); Dream mode (its hour until 07:00, only if
enabled); Nova's diary at 23:00 plus a morning catch-up; the news brief (up to 3 tries a morning, 10 min apart, only if topics are set);
Autopilot when due; re-embedding of rows saved while embeddings were down and any unfinished re-embed; a once-a-day RLS check;
recovery of stuck app builds and web tasks. It stamps `lastRun`, which Settings shows as "scheduler last checked".

### Free-tier limits

README table, checked against the code:

| Service | Limit | How the app copes | Verified |
|---|---|---|---|
| Vercel Hobby | 60 s per request; 4.5 MB body | Routes use `maxDuration = 60`; uploads capped at 4 MB (`MAX_UPLOAD_BYTES`, `app/api/documents/route.ts:23`); long jobs continue in `after()` or via self-calls | Yes (the 400 chunks figure not checked) |
| Vercel Hobby cron | once a day | One daily keepalive; real scheduling goes to cron-job.org | Yes |
| Supabase Free | 500 MB database; pauses after 7 idle days | 768-number embeddings; daily keepalive | Pause/keepalive yes, size not measured |
| Gemini free | per-minute and per-day limits | Falls through the provider chain | Chain is gemini, nvidia, openrouter, mistral, groq (README says "NVIDIA, then Groq", out of date) |
| NVIDIA NIM | trial credits; models retire | 25 s timeout; change `NVIDIA_MODEL` | Yes |
| Groq free | rate limits | 8 s timeout; keyword-rule fallback | Timeout yes |
| OpenRouter free | daily request cap | Backup only, 25 s | Not in README |
| Mistral free | small `ministral` models only | 20 s timeout | Not in README |
| Web Push | no fixed cap here | 10 s send timeout; at most 10 devices stored | Yes |

## 7. Tests

### Unit tests by area (`tests/`)

Result of `npx vitest run` today: **104 files (99 passed, 3 timed out under load, 2 skipped), 774 tests (757 passed, 4 timed out,
13 skipped)**. Rerunning the 3 timed-out files alone: 3 files, 8 tests, all passed in 3 s. The timeouts (5 s default) happened
while other work was using the machine, so treat them as load flakiness, but note these files are the heavy ones:
`habit-streak-oracle.test.ts`, `resolve-when-fuzz.test.ts`, `web-agent.test.ts`. The 13 skipped tests are the two opt-in live
files: `db.integration.test.ts` (5, needs `DB_TESTS=1` or `npm run test:db`) and `tools.live.test.ts` (8, needs `TOOLS_LIVE=1`).

| Area | Files | What they check |
|---|---|---|
| Login, security, API | `safe-fetch`, `scrub`, `db-fault`, `no-control-chars`, `tool-inputs`, `ice` | Blocked private addresses; secret scrubbing; what a database error means to the caller; no invisible control characters in source; tool text arguments; relay list |
| Chat, router, tools | `router`, `intent`, `instant`, `quick`, `no-tools`, `tools`, `brain-blank-lookup`, `empty-lookup`, `not-career-filter`, `contacts-find`, `web-task-delete`, `game-record-tool` | Rule-based routing; guarded actions; answers with no AI; quick screen switches; tool list never changes by accident; blank names find nothing |
| Guest mode, voice | `guest`, `live-markup`, `live-start`, `voice-plan`, `voice-pages`, `voiceprint`, `wake-match` | Guest limits; live transcript cleanup; starting and stopping live voice; which tools voice may use; every page voice can open; owner-voice policy; wake word matching |
| Search, RAG, embeddings, photos | `retrieval`, `chunker`, `fuzzy`, `embedding-migration`, `photos`, `resurface` | Search and fallbacks; chunking (including emoji splits); fuzzy score; the re-embed job; photo search; what resurfaces |
| Reminders and push | `reminders`, `resolve-when-fuzz`, `push-notify`, `alerts`, `autopilot-race`, `birthday-alerts-race`, `birthday-input`, `checkin`, `call-screen-race`, `week-review` | Natural-language times (Asia/Kolkata); dead push devices dropped; once-a-day failure alert; races where a dismiss or edit must not be undone by a slow push; 9 pm nudge |
| Habits and routines | `habit-date`, `habit-every-hours`, `habit-rate`, `habit-streak-oracle`, `routines`, `routine-match`, `routine-steps` | Day boundaries, every-N-hours, 30-day rate, streaks against a brute-force count; routine phrases |
| Dream, memory, mission | `dream-long-memories`, `mission`, `nova-diary`, `wrapped-run` | Dream touches only memories shown in full; crew build; diary; best habit run |
| Pet (Nova) | `pet-full` (30), `pet-looks`, `pet-months`, `pet-nudges`, `pet-seek`, `pet-talk`, `pet-voice`, `pet-week`, `pet-wishes`, `pet-words`, `pet-fireflies`, `pet-fireflies-record`, `pet-race`, `guest-pet` | Growth, mood, accessories, hungry nudge, hide and seek, chatter, voice, weekly stats, wishes, vocabulary, fireflies, race, a friend's pet |
| Garden and sky | `garden-layout`, `garden-season`, `garden-snapshot`, `garden-wrapped`, `habit-plants`, `bell-tower`, `sky`, `sky-wind`, `astro`, `beat-color` | What grows and where; seasons; moon and sun against NASA reference values; weather sky; music light colours |
| Games | `bingo`, `business`, `cards`, `chess-bot`, `chess-fast`, `chess-think`, `chess-time`, `chess-voice`, `connect4`, `dots`, `ludo`, `snakes`, `game-sim`, `game-names`, `party-rules`, `party-seat` | Rules for each game; chess move generator (perft); flag fall; random full-game simulations (60 s timeouts); game night seats and voice |
| Music, career, other | `music-retry`, `resume-model`, `kural`, `web-agent` | Music retries and "recently played"; resume LaTeX round trip; Thirukkural text; web agent data-leak check and failure give-up |
| Friends Theatre | `theatre-catalog`, `theatre-net-security`, `theatre-protocol`, `theatre-room`, `theatre-security`, `theatre-voice` | Catalogue; hostile peers and message limits; room codes; permanent room; open paths in `proxy`; voice commands (English and Tamil). Details in `docs/friends-theatre.md` |
| Live, opt-in | `db.integration`, `tools.live` | Real database search and privacy; every tool against owner data |

### Browser tests (`e2e/`)

| Spec | What it checks |
|---|---|
| `smoke.spec.ts` | 3 tests: everything locked without a session; wrong password refused; unlock, chat with stubbed reply, lock |
| `sweep.spec.ts` | Opt-in (`npm run test:sweep`): opens every page signed in on desktop and phone; reports crashes, errors, failed requests, console errors, sideways scroll |
| `theatre.spec.ts`, `theatre-lazy.spec.ts`, `theatre-rejoin.spec.ts`, `theatre-safety-voice.spec.ts`, `theatre-security.spec.ts` | Friends Theatre in real browsers. See `docs/friends-theatre.md`. Two-browser tests skip without PeerJS's free broker |

### Coverage map and honest gaps

| Area | Covered by | Not covered |
|---|---|---|
| Rules and pure logic (games, garden, pet, habits, reminders, routing) | Strong unit tests | Their UI components |
| Login and sessions | `smoke.spec.ts`, partly `theatre-security` | No unit test for `lib/session.ts`, lockout counters or "log out all devices" |
| Cron and scheduler (`/api/cron/notify`) | Only pieces (`alerts`, `push-notify`, race tests) | The route itself, the order of jobs, and the keepalive watchdog have no test |
| Backup and restore | None | `/api/export` and `scripts/restore-backup.mjs` untested; no round-trip test |
| Documents, notes, memories, projects routes | Only `chunker`, `retrieval`, `db.integration` (opt-in) | API routes and file upload (PDF, DOCX) |
| AI providers and fallback chain | None directly | `lib/ai/providers.ts` order, timeouts and errors |
| Voice and wake word | Matching logic and start/stop guards | Real microphone: `docs/manual-test.md` only |
| Push, PWA, offline, share target, service worker | `push-notify` only | `public/sw.js`, offline queue, version watcher: manual only |
| Calls, Draw and Guess, PeerJS | Rules only | Real two-person calls: manual only |
| Web tasks, Apps builder, Career PDF, Map, Music, Video | A few small tests | Mostly manual |
| Accessibility and visual layout | `sweep.spec.ts` checks sideways scroll and errors | No visual or accessibility test |

## 8. Backup and restore

**Back up.** Settings, "Export your brain", Download export (or open `/api/export` while signed in). You get
`second-brain-YYYY-MM-DD.json`. The app never does this by itself: there is no automatic backup in the repo, and Supabase's own
free-plan backups are not verified here. Take one now and then and keep it off the app.

**Restore.** The script only writes with `--apply`. Run on your own computer, in the repo, with `.env.local` filled in:

```
npm run restore -- second-brain-2026-10-28.json                       (dry run: counts per table, writes nothing)
npm run restore -- second-brain-2026-10-28.json --apply               (adds only what is MISSING, by id)
npm run restore -- second-brain-2026-10-28.json --apply --overwrite   (also replaces rows that exist)
```

It restores tables in this order so foreign keys exist: `projects, notes, memories, memory_versions, documents, document_chunks,
conversations, messages` (batches of 200, upsert on `id`), then the `private` files into the `hivemind-private` bucket. It skips
secret keys (`auth`, `ratelimit`, `unlock-fails`, `web-tasks`, `push-subscriptions`, `call-rooms`, `device-locations`). Exit code 2
if any batch failed. After a restore: notes and memories get their search vectors back from the scheduler (a few every few minutes);
for documents run Settings, Embeddings, re-embed. You will have to sign in again and re-subscribe each phone to notifications,
because sessions and push addresses are not in the backup.

## 9. Runbook

Check Settings, System check first: Database, Scheduler, Table privacy, Embeddings.

**Change the password.** Vercel, Settings, Environment Variables: edit `APP_PASSWORD`, redeploy. Every session ends at once
(each session stores a fingerprint of the password it was opened with, `lib/session.ts`), so all devices must sign in again.
Locally, edit `.env.local` and restart. Optionally also use Settings, "log out all devices" first.

**Rotate a leaked secret.**
- `APP_PASSWORD`: as above.
- `SUPABASE_SECRET_KEY`: Supabase, Project Settings, API Keys, create a new secret key, update Vercel and `.env.local`, redeploy, delete the old key.
- `CRON_SECRET`: change in Vercel, redeploy, then update the header in the cron-job.org job (until then the scheduler gets 401 and System check shows it stale after 2 h).
- AI keys (`GEMINI_API_KEY`, `NVIDIA_API_KEY`, ...): revoke at the provider, set the new one, redeploy.
- VAPID keys: new pair in Vercel; every phone must subscribe again (old subscriptions are bound to the old key).
- Signing secrets: delete `auth/secrets.json` from the private bucket (or set `SESSION_SECRET` and `PEER_SECRET`), which signs everyone out. Not tested; not verified beyond `lib/secrets.ts`.
- If a `.env.local` ever reached GitHub, rotate everything in it.

**Supabase is paused** (free plan, 7 idle days). Open the Supabase dashboard and click Restore project. The daily keepalive
should prevent it; if it happened, check that `vercel.json`'s cron ran and that `CRON_SECRET` is set. Pages answer database
errors (see `tests/db-fault.test.ts` for how errors map) until it is back. A paused project that stays paused for long can be
deleted by Supabase, so keep an export file.

**An AI model was retired.** Symptoms: a provider keeps failing and answers fall through to the next one; failure alerts say
"quota" or the raw error. Set the replacement in Vercel: `GEMINI_CHAT_MODEL` / `GEMINI_FALLBACK_MODEL` (or `GEMINI_MODELS`),
`NVIDIA_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `MISTRAL_MODEL`, `GEMINI_APP_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_LIVE_MODEL`,
`WEB_SEARCH_MODELS`. Redeploy. For the embedding model, set `GEMINI_EMBED_MODEL` then Settings, Embeddings, Re-embed everything
(must stay 768-d, or change the column in SQL).

**A push notification did not arrive.**
1. Settings, Notifications: send a test. If it fails, check `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` exist (without them `/api/cron/notify` answers 503).
2. Settings, System check, Scheduler: "last ran N min ago". If red, the cron-job.org job stopped or has the wrong secret; fix it there.
3. Phone: notifications allowed for the installed app and battery saver not blocking it. Re-subscribe from Settings, Notifications (expired devices, HTTP 404 or 410, are dropped automatically).
4. Only 10 devices are kept (`addSubscription`), the oldest drop off.
5. A reminder no device took is handed back and retried on the next run.
6. Morning brief: only sent from `BRIEF_HOUR` to 12:00 local, once a day, and only counts as sent when a device received it.

**The app is not updating on a phone.** `components/version-watcher.tsx` compares its build with `/api/version` every 5 minutes and when
the app returns to the front, and reloads, but never during a voice chat, a game, a call, on public pages, in focus mode, or while
typing. Close and reopen the app, or open a page other than a game. If it still shows the old version: confirm the deploy
finished in Vercel (`VERCEL_GIT_COMMIT_SHA` is the build id), then clear the site's data or reinstall the app. The service worker
(`public/sw.js`) caches pages and build files in production only.

**Restore from a backup.** Section 8. In short: dry run first, then `--apply`, only add `--overwrite` if you want the file's copy to win.

**Scheduler stopped (alert "Scheduler stopped").** Open cron-job.org, check the job is enabled, the URL, and the `Authorization`
header. Call the URL by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/notify`; a 503 means missing VAPID keys.

**A Theatre film no longer plays.** `npm run theatre:links`, then edit the matching `lib/theatre/*-films.ts`.

## 10. The `graft/` folder

`AGENTS.md` says the repo is indexed by "Graft": small linked markdown nodes in `graft/` that explain systems with file and line
spans, used by coding assistants (`graft ask`, `graft grep`, `graft callers`, `graft skeleton`, `graft map`). To refresh after big
code changes: `graft build` (deterministic, no API key). **In this checkout `graft/` exists but is empty** (no `INDEX.md`, no nodes),
so the index has not been built here; run `graft build` before relying on it. It is a developer aid; the app does not read it.

## 11. Manual test summary (`docs/manual-test.md`)

A tick-box list to run on the installed phone app, after the automated checks. Sections: 1 Sign-in and devices; 2 Voice (including
Tamil); 3 Wake word (per device); 4 Guest mode; 5 Notifications and scheduler; 6 Calls and games (needs a second person);
7 Everyday pages (notes, memories, documents, search, music, video, map, apps, career, kitchen mode, comic, autopilot, web tasks);
8 Phone app things (share target, shortcuts, offline queue, rotation); 9 After a deploy (home loads under about 3 s; GitHub Actions green).

## 12. Checked and notes

Run results (read-only commands, 2026-11-10):

- `npx tsc --noEmit`: clean, no output.
- `npx eslint .`: clean, no output (0 errors, 0 warnings).
- `npx vitest run`: see section 7. Three files timed out at the 5 s default while the machine was busy and passed on rerun alone (8 of 8).

Findings:

1. **README is out of date on the AI fallback.** It says Gemini falls back to NVIDIA then Groq; the code chain is gemini, nvidia, openrouter, mistral, groq (`lib/ai/providers.ts:25`). OpenRouter and `OPENROUTER_*` are not in `.env.example` or the README.
2. **README says unlocked "for a year"; the session cookie lasts 180 days** (`SESSION_MAX_AGE` in `lib/session.ts`). Only the `sb_trusted` cookie lasts a year.
3. **The scheduler setup is undocumented.** The code, the System check text and the watchdog alert all say "see README" for cron-job.org, but `README.md` has no such section (grep for "cron-job" finds nothing). The job's URL, interval and header live only in the owner's cron-job.org account. Nothing in the repo says how to recreate it. VAPID key generation and `CRON_SECRET` are also missing from the README's setup steps (`CRON_SECRET` is in `.env.example`; VAPID is not).
4. **`.env.example` is incomplete.** Variables read in code but absent from it include `VAPID_*`, `OPENROUTER_*`, `APP_URL`, `STEEL_API_KEY`, `RAPIDAPI_KEY`, `YOUTUBE_API_KEY`, TURN/Metered keys, `BRIEF_HOUR`, `HOME_TZ`, `MUSIC_LANGUAGE`, `GITHUB_USER`, `GEMINI_APP_MODEL`/`TTS`/`LIVE`. Also a stray fragment: the `MISTRAL_MODEL` comment line ends with `ministral-14b-latestqwen/qwen3.8-27b` (a paste error).
5. **No automatic backup.** Export is a manual download only. There is no test for the export route or the restore script, and no round-trip test. The restore script skips sessions and push subscriptions by design.
6. **CI lints a subset, local `npm run lint` lints everything.** CI runs `eslint lib app components tests e2e playwright.config.ts`; scripts and root config files are not linted there. Both pass today.
7. **`/api/cron/notify` has no test** and is a large route (181 lines) that does 12 jobs in a fixed order; a failure in one `await` outside a `.catch` could stop later steps (not verified for every call).
8. **`test:db` has two quirks.** `npm run test:db` and `DB_TESTS=1` both enable it; the "public key can't read" check also skips unless `SUPABASE_PUBLISHABLE_KEY` is set, so on a default setup that RLS check silently does not run. `tools.live.test.ts` has no npm script.
9. **`graft/` is empty** in this checkout although `AGENTS.md` tells assistants to use it.
10. **Keepalive depends on `CRON_SECRET`.** With it unset, the daily Vercel cron gets 401 and Supabase can still pause. The watchdog lives in that same route, so a missing secret silences both.
11. Verified working by reading: cron routes use constant-time secret compare and are excluded from the password gate (`proxy.ts` matcher); the export pages through tables at 1000 rows to avoid silent truncation (`app/api/export/route.ts:7,34`); restore never overwrites unless `--overwrite` (`scripts/restore-backup.mjs`, `ignoreDuplicates: !OVERWRITE`); failure alerts are limited to once a day per job (`lib/alerts.ts`); the version watcher avoids reloading mid-call or mid-typing.
