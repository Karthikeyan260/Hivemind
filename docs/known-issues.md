# Known issues, risks and gaps

This page collects, in one place, everything the documentation review found that looks broken, risky, unfinished or out of date.
Each area document has the details in its own **Checked and notes** section. Checked 2026-11-11 against the code at that time.

**How to read the evidence column**

- **Confirmed**: I looked at the cited code myself and it says what is described.
- **Reported**: the reader of that area found it in the code and wrote it down; I did not re-check it. Treat it as very likely
  but look before acting on it.
- Nothing here was found by running the app against the real database or the real AI providers.

Nothing in this list is a sign that the app is unsafe to use day to day. The security items matter mostly because a leaked
password, a leaked link or a malicious web page is the way in; the owner password gate itself was reviewed and is sound.

## Fix these first

1. **A missing VAPID key silently stops all background work** (A2). One setting, large effect.
2. **The scheduler that runs everything is not in the repo and not in the README** (A1, A3).
3. **Web tasks can't go past 40 steps and could be started by text on a web page** (D1, C5).
4. **Editing a note fails whenever the embedding model is down** (B4).
5. **Config and README drift**: `.env.example`, `schema.sql`, the "unlocked for a year" claim, and the AI provider order (E1 to E4).

## A. Background jobs and delivery

| # | Issue | Where | Evidence |
|---|---|---|---|
| A1 | Every push and background job depends on an **outside scheduler** (cron-job.org calling `/api/cron/notify` about every 5 minutes with `Authorization: Bearer <CRON_SECRET>`). `vercel.json` only has the daily keepalive. The README never explains the scheduler although four in-app messages say "see README". If it stops, no reminder, habit, birthday, check-in or morning push is sent; the watchdog notices after about 2 hours. | `vercel.json`, `README.md`, `app/api/cron/notify/route.ts` | Confirmed (`vercel.json`), Reported (the rest) |
| A2 | If the **VAPID push keys are missing**, `/api/cron/notify` returns 503 before doing anything. That also stops Dream mode, the Nova diary, Autopilot and web-task resume, and `lastRun` is never written, so Mission and the System check show the scheduler as silent even when it is calling correctly. | `app/api/cron/notify/route.ts:42` (503) and `:117` (`lastRun` written only at the end) | Confirmed |
| A3 | If **`CRON_SECRET` is not set**, the daily keepalive gets 401 (the free Supabase project can then pause) and the stale-scheduler alert, which lives in the same route, is silenced. Web tasks also cannot start or continue (`kick()` does nothing); apps have a fallback, web tasks do not. | `app/api/cron/keepalive`, `lib/web-agent/runner.ts` | Reported |
| A4 | An **open tab can take a reminder from your phone**: the reminders "due" endpoint and the cron share one claim and whoever asks first wins. | `app/api/reminders/due`, `lib/reminders.ts` | Reported |
| A5 | A reminder is only pushed if the scheduler ran within **6 hours** of its alert time; habit alerts must run within **20 minutes** of each scheduled time; birthday, morning and check-in alerts have fixed hour windows. "Every 5 minutes" is the safe setting. | `lib/reminders.ts`, `lib/habits.ts` | Reported |
| A6 | A habit snooze that runs past midnight into a rest day can leave `snoozeUntil` set, and the next scheduled day sends a spurious "Snooze's over". | `lib/habits.ts` | Reported (not seen live) |
| A7 | **Reminders have no form** on any page (chat, voice or the raw API only); the Mission "Bell" robot links to `/habits`, which does not show reminders; reminders have no snooze (only reschedule) and habits have no snooze button inside the app. | pages, `components/mission` | Reported |

## B. Data safety and loss

| # | Issue | Where | Evidence |
|---|---|---|---|
| B1 | **Portfolio sync is delete-then-insert**, not atomic. A failure after the delete leaves the portfolio memories missing, and it wipes any edits you made to imported memories. | `lib/imports/portfolio.ts:145-161` | Reported |
| B2 | **Undoing the deletion of a memory loses its version history** (the versions are deleted with the memory by cascade; the activity log keeps only the row). | `lib/activity.ts`, `supabase` | Reported |
| B3 | Deleting a note, document, photo or project **cannot be undone**; notes keep no version history. | various | Reported |
| B4 | **Editing a note fails with a 500 when the embedding model is down**: `PUT /api/notes/:id` calls `embedOne` directly, while creating a note and editing a memory use a fallback (`tryEmbed`). | `app/api/notes/[id]/route.ts:48` | Confirmed (the direct call); the other paths Reported |
| B5 | **Documents have no "embed later" path**: if embeddings are down, an upload fails and leaves a `failed` row; `reembedMissing` only covers notes and memories. | `lib/documents`, `lib/knowledge.ts` | Reported |
| B6 | Supabase's **1,000-row limit** can silently truncate counts and lists (per-project counts, the `list_projects` tool); the Memory Explorer and Palace see only the newest 500 memories. | `app/api/brain`, `lib/memory-explorer.ts` | Reported (not verified whether the limit is raised) |
| B7 | **Dream mode**: a second "Dream now" on the same date overwrites that night's report (the changes stay applied and logged but vanish from the Dream page); the night is marked done before it runs, so a failure means no retry until the next night; it sees only the 200 most recently updated memories. | `lib/dream.ts` | Reported |
| B8 | Read-modify-write races (last write wins): the pet record (`pet` key) and the sessions file. Low impact for one owner. | `lib/pet.ts`, `lib/session.ts` | Reported |
| B9 | **My Wrapped** saves a new `wrapped/<month>-<date>` file every day for the current month and never deletes old ones (small, unbounded). | `lib/wrapped.ts` | Reported |
| B10 | Long notes are embedded from only their **first 8,000 characters**. | `lib/ai/embeddings.ts` | Reported |
| B11 | **No automatic backup**: export is a manual download; `/api/export` and `scripts/restore-backup.mjs` have no tests. | `app/api/export`, `scripts/` | Reported |

## C. Security and privacy

| # | Issue | Where | Evidence |
|---|---|---|---|
| C1 | The **voiceprint is a speed bump, not a lock**: it is checked only in the browser, `/api/agent-tool` cannot see it, and when unsure it falls back to an on-screen tap by whoever holds the device. (It is built and active, not on hold.) | `components/voice/provider.tsx`, `components/wake/listener.tsx` | Reported |
| C2 | **Locking / signing out does not clear the wake word, the voiceprint or the 29 MB speaker model** from the device; it clears the offline store, the queue, saved pages and a pending share. | `lib/offline.ts` (`clearOfflineCache`) | Confirmed (what it clears); the other keys' names Reported |
| C3 | The **downloaded speaker model** (Hugging Face `resolve/main`) and the **ONNX WASM runtime** (jsDelivr) are not pinned or integrity-checked, and the CSP does not limit scripts or connections (by design: three.js, PeerJS and Gemini Live connect to several origins). | `lib/voiceprint`, `lib/wake`, `next.config.ts` | Reported |
| C4 | `/api/ice` is **open with no rate limit** and can spend TURN relay credentials (an in-memory cache of about 30 minutes softens this). | `app/api/ice` | Reported |
| C5 | **`web_task`, `create_app` and `run_autopilot` are not in the owner-intent guard**, so instructions injected through web text could start a web task (the approval gate and leak check limit the harm). The `web_task_answer` pattern is very loose: "yes", "no", "ok", "done" unlock it and approve and reject share one pattern, and the server does not insist on a clear yes. | `lib/agents/intent.ts:27` (the pattern) | Confirmed (the pattern); the guard gap Reported |
| C6 | `/api/live/token` mints a Gemini Live token **without connection constraints**, so the browser supplies the final session config. Low risk (owner only). | `app/api/live/token` | Reported |
| C7 | **Scores are trusted from the browser** (walks, firefly score 0 to 500, Paattu up to 100,000, game results); they feed Nova's growth and the Crown outfit. | `app/api/pet`, `app/api/games` | Reported |
| C8 | `/api/unlock` is the one POST route outside `handle()` and zod and reads cookies by hand; the `sb_trusted` cookie exempts only the global lockout, not the per-address one. | `app/api/unlock/route.ts` | Reported |
| C9 | The public **call-screening** endpoints can use up to 150 AI or voice calls a day per room if a call link leaks; the game **knock** window is stamped before the push is sent, so it is used up even if nobody receives the push. | `app/api/call`, `app/api/games/knock` | Reported |
| C10 | `GET /api/places` has **no cap on the `km` radius**; the web-task screenshot route and the app-data `GET` do not validate the id the way other routes do; the risky-click check reads only visible text, not image `alt`. | various | Reported |
| C11 | The session cookie lasts **180 days** (the README says a year); only the `sb_trusted` cookie lasts a year. | `lib/session.ts:10-11` | Confirmed |

The password gate, the brute-force guard (8 per address, 60 global, 15-minute window), the apps sandbox (no `allow-same-origin`, no-network CSP), Autopilot being read-only, and Dream logging a deleted row before deleting it were all reviewed and found sound.

## D. Behaviour and user experience

| # | Issue | Where | Evidence |
|---|---|---|---|
| D1 | **Web tasks cannot continue past 40 steps.** At `MAX_STEPS` the runner pauses and asks you to continue; Continue and Retry only add more steps, so it re-pauses at once. | `lib/web-agent/runner.ts:148` | Confirmed (the pause); the loop Reported |
| D2 | **"remember that the meeting moved to 4" goes to the Scheduler agent**, not the Memory agent: the scheduler rule (which matches "meeting") comes before the remember rule. | `lib/agents/router.ts` lines 44 and 51 | Confirmed by reading the rule order; not run |
| D3 | The home console label **"VOICE: WHEN SPOKEN TO" is misleading**: `send()` is never called with `spoken: true`, so only the ALWAYS switch turns chat speech on. | `app/(bridge)/page.tsx` | Reported |
| D4 | **Autopilot** settings do not check that the start hour is before the end hour (if not, it never runs); dismissed insights older than 14 days can reappear. | `lib/autopilot.ts` | Reported |
| D5 | Changes made from the app's own page do not set `pending`, so a cut-off build cannot be retried by `recoverStuckBuilds`; it just restores the old app. | `lib/apps.ts` | Reported |
| D6 | **Chat history is saved but cannot be browsed**: `/api/conversations*` exists and no page calls it; "New session" drops the conversation id. | `app/api/conversations` | Confirmed (no callers found); the rest Reported |
| D7 | Redrawing an old day's **comic** ignores habits (it reads habit status for today only); nothing generates comics automatically. The comic uses no image model: Gemini picks four moments and writes the words, the art is the mascot's 18 pre-drawn frames. | `lib/comic.ts` | Reported |
| D8 | **Festival outfits and island decor** (Deepavali, Karthigai Deepam) are hard-coded for 2026 to 2028 and stop after 2028; the dates were not checked against a Tamil Nadu calendar. | `lib/pet-looks.ts` (`MOVING`) | Confirmed (list ends 2028) |
| D9 | The **Galaxy** has no non-WebGL fallback (the home page centre is empty on such a device); the garden and Journey do. | `components/galaxy` | Reported |
| D10 | Snakes, Business, Bingo and Connect Four **cannot be joined by an invite link**; they work solo or at game night only. | `app/play`, `app/api/games/knock` | Reported |
| D11 | The tailored **resume PDF** is not forced to one page. **Music** (JioSaavn) and **video** search use unofficial endpoints that can break without notice. | `lib/resume`, `lib/music.ts`, `lib/video.ts` | Reported |
| D12 | The `tick_habit` voice tool picks the **first habit whose name contains the spoken text**. | `lib/agents/tools` | Reported |
| D13 | **"My voice"** (voice clone) may not work on the current Gemini key; `lib/tts.ts` falls back to the usual voice for an hour when the clone is rejected. Not verified live. | `lib/tts.ts`, `lib/my-voice.ts` | Reported |
| D14 | The home page `/` lives in `app/(bridge)/page.tsx`, **outside the app layout**, so it has no sidebar or Ctrl K; its own top bar omits Mission control, Friends theatre, Photos, My Wrapped and Nova's garden. The page list is kept by hand in three places (sidebar, mobile nav, home page) and they already disagree. | `app/(bridge)`, `components/sidebar.tsx`, `components/mobile-nav.tsx` | Confirmed (location); the rest Reported |
| D15 | `/share-in` is **not in the open paths** of `proxy.ts`: if the service worker is not running, the Android share POST is redirected to `/unlock`. Not verified on a device. | `proxy.ts` | Confirmed (not listed); the effect Reported |
| D16 | **Accessibility**: the command palette and the phone "More" sheet have no Tab focus trap; no skip link; `lang="en"` is fixed so Tamil text is not marked as Tamil; `Select` has no accessible name; **no light theme** and no theme toggle; no custom install button; the manifest forces portrait. | `components/command-palette.tsx`, `components/ui.tsx`, `app/layout.tsx` | Confirmed (no light theme); the rest Reported |
| D17 | The "Make it every morning" checkbox on `/brief` has no error handling. | `app/(app)/(pages)/brief` | Reported |

## E. Documentation, configuration and housekeeping

| # | Issue | Where | Evidence |
|---|---|---|---|
| E1 | The README says a browser "stays unlocked for a year"; the session cookie lasts 180 days. | `README.md`, `lib/session.ts` | Confirmed |
| E2 | The README says the AI fallback is Gemini, then NVIDIA, then Groq. The code order is **gemini, nvidia, openrouter, mistral, groq**; OpenRouter is not in the README or `.env.example`. | `lib/ai/providers.ts:25` | Confirmed |
| E3 | **`.env.example`** has a garbled line (`MISTRAL_MODEL=...latestqwen/qwen3.8-27b`) and omits variables the code reads: `VAPID_*`, `SESSION_SECRET`, `PEER_SECRET`, `APP_URL`, `HOME_TZ`, `BRIEF_HOUR`, the TURN and Metered keys, and (reported) `OPENROUTER_*`, `STEEL_API_KEY`, `RAPIDAPI_KEY`, `YOUTUBE_API_KEY`, `MUSIC_LANGUAGE`. | `.env.example` | Confirmed (garbled line, VAPID, SESSION_SECRET, PEER_SECRET, APP_URL, HOME_TZ, BRIEF_HOUR); the rest Reported |
| E4 | **`supabase/schema.sql` on its own is stale**: it still has `user_id`, `auth.uid()` and the owner-only policies that migration 002 removes, and lacks `source_url`, `brain_profile`, `activity` and `projects.metadata`. A fresh setup needs all four SQL files in order. | `supabase/` | Confirmed (the `user_id` lines); the missing columns Reported |
| E5 | The **`graft/` folder is empty** although `AGENTS.md` tells assistants to use it; run `graft build` first. | `graft/`, `AGENTS.md` | Confirmed |
| E6 | CI lints only a subset of the repo; `npm run lint` covers everything (both pass today). | `.github` | Reported |
| E7 | `test:db`: the "public key can't read notes" test silently skips unless `SUPABASE_PUBLISHABLE_KEY` is set; `tools.live.test.ts` has no npm script (it needs `TOOLS_LIVE=1`). | `tests/` | Reported |
| E8 | Unused Next.js template files in `public/`: `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`. | `public/` | Confirmed |
| E9 | **Dead code**: `streamGemini`, `ANSWER_PROVIDERS`, the `maxTokensCap` option, a leftover `void relMems`, and the legacy `STORE_MEMORY` / `CREATE_PROJECT` check in the home page. | `lib/ai`, `app/(bridge)/page.tsx` | Reported |

## F. Test gaps

The suite is large (104 files, 774 tests at the last run: type check and lint clean, 13 skipped because they need a database or
the network; three files timed out at 5 seconds once while the machine was busy and passed when run alone). What it does **not**
cover, as reported by the area readers:

- **Platform**: `lib/session.ts` (lockout, revocation), the open paths in `proxy.ts`, `lib/offline.ts`, `lib/private-store.ts`,
  `lib/health.ts`, the cron-secret checks, the service worker, `/api/cron/notify` (12 jobs in one route), the backup export and restore.
- **Brain**: the organizer, undo, share, imports, document parsing, and the AI provider fallback order.
- **Voice**: `Speaker`, `SentenceStream`, TTS and its voice-clone fallback, `lib/my-voice.ts`, and the routes `/api/tts`,
  `/api/live/token`, `/api/live/log`, `/api/voice/mine`.
- **Working for you**: the web-task approval gate, the apps sandbox and build path, brief, day brief, goodnight, panels and the
  agent-tool guards.
- **Daily life**: the habit alert runner, `dueAlerts`, the resume-tailoring guardrails, job analysis and the call ring route.
- **Play**: `lib/comic.ts`, `lib/journey.ts`, `lib/games/paattu.ts`, the knock route, `getGarden`, `lib/goodnight.ts`,
  `lib/beat.ts`, the 3D scenes and the `/play` page.
- **Shell**: the command palette, sidebar and tab bar, the offline queue, the notifications card, the language card, the share
  target and the unlock lockout. The Playwright "sweep" skips `/mission`, `/photos`, `/wrapped`, `/garden`, `/theatre` and most
  game pages.

Friends Theatre is the exception: it has its own large unit and browser test set (see [friends-theatre.md](friends-theatre.md)).

## What was checked and found good

- The **password gate** (`proxy.ts`): every page and API is private except a short, named list of open paths.
- The **brute-force guard** on sign-in, and that Lock clears the offline copies.
- `/?ask=` only auto-runs when `sessionStorage["hivemind-ask"]` matches.
- The **notification permission prompt** appears only after a button click.
- **Autopilot** has only read tools, and its one-tap requests are filtered.
- The **apps sandbox** (no `allow-same-origin`, no-network CSP).
- **Dream mode** logs the full deleted row before deleting and skips long memories.
- `/api/agent-tool` sits behind the password gate; guest and routine modes can only restrict.
