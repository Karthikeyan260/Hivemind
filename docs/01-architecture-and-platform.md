# Architecture and platform

This is the foundation of HIVEMIND: how a request travels from your phone to the database, how the password gate and
sessions work, how secrets and small bits of state are stored, how notifications, offline mode and auto-update work, and
what the database looks like. Every other feature sits on top of this.

> Written from the code as it is on 2026-11-10. Every claim below was read in the files named; where something was not
> verified it says so.

Other docs cover the features themselves:

| Doc | Covers |
|---|---|
| `docs/02-brain-and-ai.md` | Memories, notes, documents, search, the AI router and agents |
| `docs/03-voice-and-wake-word.md` | Live voice, wake word, read-aloud |
| `docs/04-autopilot-web-tasks-apps.md` | Autopilot, web tasks, generated apps |
| `docs/05-daily-life-habits-reminders-career.md` | Habits, reminders, brief, career |
| `docs/06-nova-garden-games-and-stories.md` | The pet Nova, garden, games, stories |
| `docs/07-app-shell-pages-and-navigation.md` | Sidebar, tab bar, pages, settings |
| `docs/08-testing-and-operations.md` | Tests, deploy, running the app |
| `docs/friends-theatre.md` | Friends Theatre |

## Architecture at a glance

```text
 Phone / laptop browser (installable PWA)                         Friends / guests (no password)
 ┌──────────────────────────────────────────┐                     ┌────────────────────────────┐
 │ React pages + client components          │                     │ /call/…  /play/…  /theatre/…│
 │ service worker /sw.js (push, offline)    │                     └──────────────┬─────────────┘
 │ IndexedDB (offline notes/memories)       │                                    │
 └───────────────┬──────────────────────────┘                                    │
                 │  every request                                                │
                 ▼                                                               │
 ┌────────────────────────────────────────────────────────────────────────────────────────────┐
 │ Vercel: Next.js 16                                                                         │
 │   proxy.ts  (the gate)                                                                     │
 │     open: /unlock, /api/unlock, /manifest.webmanifest, /sw.js, /robots.txt, /api/ice,       │
 │           /api/peer/verify, call+game guest endpoints, /call/ /play/ /theatre/ pages       │
 │     everything else: needs cookie sb_owner  -> else 401 (API) / redirect /unlock (page)    │
 │     skipped by the gate entirely: build files, icons, api/cron/* (they check CRON_SECRET)  │
 │   route handlers  app/api/**   (handle() + zod parseBody)                                  │
 │   lib/db.ts  -> server-only Supabase client with the SECRET key                            │
 └───────┬───────────────────────────────┬───────────────────────────────┬────────────────────┘
         │                               │                               │
         ▼                               ▼                               ▼
 ┌─────────────────┐        ┌──────────────────────────┐     ┌────────────────────────────┐
 │ Supabase        │        │ Supabase Storage         │     │ Outside services           │
 │ Postgres+pgvector│       │ private bucket           │     │ Gemini / NVIDIA / Groq /   │
 │ 10 tables, RLS  │        │ "hivemind-private"       │     │ Mistral, web-push services,│
 │ on, no policies│        │ small JSON files (state, │     │ TURN relay (Cloudflare or  │
 └─────────────────┘        │ sessions, secrets, push) │     │ Metered), cron-job.org     │
                            └──────────────────────────┘     └────────────────────────────┘

 Schedulers that call in:  Vercel Cron (1x/day: /api/cron/keepalive)
                           cron-job.org (every few min: /api/cron/notify, and others) -> Bearer CRON_SECRET
```

Key idea: the browser never talks to Supabase. Only the server does, using a secret key that never leaves it. The
public Supabase key would be useless anyway, because every table has row level security (RLS) turned on with no policies.

## 1. What it does

- **Password gate.** One owner, one password. Every page and API is private except a short list of open paths.
- **Sessions.** Each unlock gets its own revocable session. You can log out one browser, or all of them. Changing the
  password logs everyone out.
- **Brute-force lockout.** Too many wrong passwords from one address, or from everywhere, locks the unlock for 15 minutes.
- **Safe defaults.** With no password set, a deployed app answers 503 instead of opening to the world. Locally there is no
  password.
- **Security headers** on every response (no framing, no sniffing, HTTPS only, no search-engine indexing).
- **Private JSON store.** Small app state (sessions, push devices, "brief sent today", etc.) lives as JSON files in a private
  Supabase Storage bucket. No migration needed for new state.
- **Push notifications** (reminders, brief, calls, failure alerts) to your devices when the app is closed.
- **Offline mode.** Notes and memories can be read and written with no network; changes sync later. App pages open offline.
- **Auto-update.** An installed app picks up a new deploy by itself without interrupting you.
- **Installable PWA** with home-screen shortcuts and an Android Share-menu target.
- **System check** in Settings: database, scheduler, table privacy, embeddings.
- **Daily keepalive** so the free Supabase project is never paused.
- **Safe fetching** of URLs the user or the AI supplies (no internal addresses).
- **Backup restore script** for the "Export Brain" file.

## 2. How to use it

| Task | Where |
|---|---|
| Unlock | Open the app; you are sent to `/unlock`, type the password, tap Unlock (`app/unlock/page.tsx`) |
| Log out this browser | Sidebar / phone menu (`components/sidebar.tsx`, `components/mobile-nav.tsx`) call `DELETE /api/unlock` |
| See signed-in devices, log out all | Settings, "Signed-in devices" (`components/sessions-card.tsx`, `GET /api/sessions`, `DELETE /api/unlock?all=1`) |
| Turn on notifications on a device | Settings, Notifications card (`components/notifications.tsx`) |
| Send a test notification | Same card, "Send a test" (`POST /api/push/test`) |
| Check health | Settings, System check card (`components/system-check-card.tsx`, `GET /api/health`) |
| Install as an app | Browser "Add to Home screen" (uses `app/manifest.ts`) |
| Long-press the app icon | Shortcuts: Talk now, Quick note, Today's brief, Remember this |
| Share into HIVEMIND (Android) | Share menu, choose HIVEMIND; opens `/share` |
| Restore from a backup | `npm run restore -- <export.json> [--apply] [--overwrite]` on your own computer |
| Run locally | `npm run dev` (no password). Production build locally: `npm run build && APP_PASSWORD=localtest npm start` |

## 3. How it works

### 3.1 Request flow

1. The browser asks for a page or an API route.
2. `proxy.ts` runs first (Next 16's name for middleware). Its `config.matcher` skips build files and a few public asset
   folders (see 3.2). For everything else:
   - open paths and guest pages go straight through;
   - if `APP_PASSWORD` is missing in production, answer **503** with a plain-text hint;
   - if the `sb_owner` cookie is a valid, live session, continue;
   - otherwise API paths get `401 {"error":"Locked"}` and pages get a redirect to `/unlock`.
3. The route handler runs. Most are wrapped in `handle()` and read input with `parseBody(req, zodSchema)` (`lib/api.ts`).
4. Data access goes through `db()` (`lib/db.ts`): a single server-only Supabase client with the secret key.
5. The response goes back with the security headers from `next.config.ts`.

On the client, `lib/client-api.ts` `api()` is the single fetch wrapper: a `401` sends the browser to `/unlock`; a network
failure falls back to the offline layer (section 3.9).

### 3.2 The gate: which paths are open

From `proxy.ts`:

| Open because | Paths |
|---|---|
| Needed to log in | `/unlock`, `/api/unlock` |
| Installing the app / notifications work without cookies | `/manifest.webmanifest`, `/sw.js`, `/robots.txt` |
| Guests of calls, games, theatre | `/api/call/ring`, `/api/call/screen`, `/api/games/knock`, `/api/peer/verify`, `/api/ice`, and any page under `/call/`, `/play/`, `/theatre/` |

The matcher also lets these skip the proxy completely: `_next/static`, `_next/image`, `favicon.ico`, `icon.svg`,
`apple-icon.png`, `icons/`, `chess/`, `mascots/nova-*`, `theatre/` (posters), and **`api/cron/`**. The cron routes are not
behind the password; each checks `CRON_SECRET` itself (section 3.6). The comment in `proxy.ts` explains why the matcher
never excludes by file extension: `/api/x/anything.png` would then bypass the password.

Everything else in `public/` (for example `journey/`, `projects/`, `models/`, `wake/`, `sky/`, `tex/`, `mascots/karthik-*`)
goes through the gate and needs a session.

`lib/public-paths.ts` `isPublicPage()` is the client-side twin: on `/unlock`, `/call/`, `/play/`, `/theatre/` the owner-only
widgets (service worker, offline pill, version reload) stay off.

### 3.3 Login and sessions (`lib/session.ts`, `app/api/unlock/route.ts`)

**Cookies**

| Cookie | Value | Lifetime | Purpose |
|---|---|---|---|
| `sb_owner` | `v2.<48 hex session id>.<64 hex HMAC>` | 180 days (`SESSION_MAX_AGE`) | The login. `httpOnly`, `sameSite=lax`, `secure` in production, path `/` |
| `sb_trusted` | `<24 hex>.<64 hex HMAC>` | 365 days (`TRUSTED_MAX_AGE`) | Marks a browser that has unlocked before. Survives logout. Skips only the all-addresses lockout |

**Login (`POST /api/unlock`)**

1. If no `APP_PASSWORD` is set, answer `{ok:true}` (nothing to unlock; no cookie is set).
2. Count this attempt in memory first (per IP, before any `await`, so a burst cannot all slip past).
3. Count stored failure markers: per address (hashed IP, 24 hex chars) and global (`unlock-fails-all`), within a 15 minute window.
4. Locked if: 8 attempts per address in the window, or 60 failures global and the browser is not trusted. Answer
   `429` with `Retry-After`.
5. Compare the password with `safeEqual` (SHA-256 both sides, then `timingSafeEqual`).
6. Wrong: add a marker to both counters, wait 800 ms, answer `401 "Wrong password"`.
7. Right: clear that address's markers, create a session, set `sb_owner`, and set `sb_trusted` if the browser did not have a valid one.

The client IP is `x-real-ip` (Vercel sets it), falling back to the first `x-forwarded-for` entry (a local-only fallback).

**How a session is stored.** Each unlock makes a random 24-byte id. The server keeps `{id: sha256(sid), created, expires,
device (first 80 chars of the user agent), pw}` in the private store file `auth/sessions`. `pw` is a fingerprint (HMAC) of
the current `APP_PASSWORD`. The cookie carries the id plus an HMAC signed with a random server secret
(`lib/secrets.ts`), so the cookie reveals nothing about the password.

**Checking a session (`isUnlocked`)**
- No `APP_PASSWORD`: unlocked unless production (`misconfigured()`).
- Cookie must match the `v2.` shape and its signature must verify.
- The session must exist, not be expired, and carry the current password fingerprint.
- Each server instance caches the session list for 10 s. A signed cookie not found in the cache triggers one fresh read
  (at most once a second), so a login on another instance works at once.
- If storage fails, the owner gets in only if this instance saw that exact session alive moments ago (a logged-out or
  pre-password-change session stays out).

**Revoking**
- `DELETE /api/unlock`: ends this browser's session and deletes `sb_owner` (the trusted cookie stays).
- `DELETE /api/unlock?all=1`: needs a valid session; wipes every session.
- Change `APP_PASSWORD`: every old session fails the fingerprint check.
- At most 30 live sessions are kept **per password fingerprint**, so test logins with another password cannot push out
  real devices (`save()` in `lib/session.ts`).

### 3.4 "No password locally / 503 without password in production"

`passwordRequired()` is true when `APP_PASSWORD` is set. `misconfigured()` is true when it is **not** set and
`NODE_ENV === "production"`. So:

| Situation | Result |
|---|---|
| `npm run dev`, no password | No gate, everything open (dev convenience) |
| `next start` or Vercel, no password | Proxy answers 503 for every gated path; `isUnlocked` returns false |
| Any build with a password | Normal gate |

README says the same (a local production build "refuses to start without one"; precisely, it starts but answers 503).

### 3.5 Secrets (`lib/secrets.ts`, env, `server-only`)

- All keys in `.env.example` are server-only; nothing is sent to the browser except the intentionally public
  `NEXT_PUBLIC_*` values (`NEXT_PUBLIC_BUILD`, optional `NEXT_PUBLIC_TURN_*`).
- `lib/db.ts`, `lib/private-store.ts`, `lib/push.ts`, `lib/secrets.ts`, `lib/safe-fetch.ts`, `lib/api.ts`, `lib/alerts.ts`,
  `lib/health.ts`, `lib/origin.ts` start with `import "server-only"`, so importing them from client code fails the build.
- Signing keys are separate from the password. `session` and `peer` are each 32 random bytes, created the first time they
  are needed and stored in `auth/secrets` in the private store. An env var `SESSION_SECRET` or `PEER_SECRET` (32+ chars)
  wins if set. Two instances racing to create one: the last write wins and both re-read it.
- `peerProof()` (in `lib/session.ts`) is an HMAC with the `peer` secret that proves to a guest that a call or game host is
  really the owner. Used by `POST /api/peer/proof` (owner) and `POST /api/peer/verify` (open).

### 3.6 Cron and the cron secret

| Job | Caller | Schedule | Route |
|---|---|---|---|
| Keepalive | Vercel Cron (`vercel.json`) | `0 9 * * *` (daily 09:00 UTC) | `GET /api/cron/keepalive` |
| Reminders, brief, Autopilot, dream, etc. | cron-job.org (external; Vercel's free plan only runs cron daily) | every few minutes | `GET /api/cron/notify` |
| Web task / app build workers | external scheduler | not verified | `GET /api/cron/web-task`, `GET /api/cron/app-build` |

All four routes compare the `Authorization: Bearer <CRON_SECRET>` header with `safeEqual`. `notify` also accepts
`?key=<CRON_SECRET>`. If `CRON_SECRET` is unset, every cron route answers 401. Vercel sends the Bearer header
automatically when `CRON_SECRET` is set in the project.

**Keepalive** calls the `keepalive()` SQL function (returns `now()`), which keeps a free Supabase project from pausing after
~7 idle days. It also acts as a **watchdog**: it reads `notify-state.lastRun`; if the external scheduler has been silent for
more than 2 hours (`SCHEDULER_STALE_MS`) it sends a push alert "Scheduler stopped" (`lib/alerts.ts`).

### 3.7 The private JSON store (`lib/private-store.ts`)

A tiny key-value store on Supabase Storage, bucket `hivemind-private` (created on first use, `public: false`).

| Function | What it does |
|---|---|
| `readJSON(db, key, fallback)` | Reads `<key>.json`. Returns the fallback **only** if the file does not exist (404) or is not valid JSON. Any other error throws, so a read-modify-write never saves an empty value over real data because of a blip |
| `writeJSON(db, key, value)` | Upserts `<key>.json` |
| `addMarker / countMarkers / clearMarkers` | One tiny file per event under a prefix. Counting files avoids lost updates when requests run in parallel (used for login failures). `countMarkers` also deletes expired markers |
| `writeFile / readFile / removeFiles / listFiles` | Binary files (e.g. web-task screenshots) |
| `readAllJSON(db, skip, maxFiles=600)` | Walks the bucket (depth 3) for backups, skipping secret paths |

Keys containing control characters (a NUL) are treated as "not there". `lib/safe-decode.ts` (`safeDecode`) and
`lib/scrub.ts` (`scrub`) are related hygiene helpers: `safeDecode` never throws on a stray `%`; `scrub` removes NUL and
lone emoji halves so the database does not reject a save.

Keys seen in this area: `auth/sessions`, `auth/secrets`, `push-subscriptions`, `notify-state`, `alert-state`,
`unlock-fails/<hash>/…`, `unlock-fails-all/…`. Other docs list their own keys (`ratelimit/*`, call rooms, habits, pet...).

### 3.8 Push notifications (`lib/push.ts`, `app/api/push/**`, `public/sw.js`)

- **Setup.** Needs `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (optional `VAPID_SUBJECT`, default `mailto:owner@hivemind.local`).
  Without them `pushConfigured()` is false, `notify()` returns 0, and `POST /api/push` answers 503.
- **Subscribing.** Settings card asks permission, registers the service worker, subscribes with the public key, and posts
  the subscription to `POST /api/push` along with a device label like "Android app". The server keeps the **last 10**
  subscriptions (same endpoint replaces the old). On iPhone the card tells you to add to Home Screen first.
- **Sending.** `notify(db, {title, body, url?, tag?, sticky?, actions?, data?})` sends to every device in parallel with a
  10 s timeout. TTL 3600 s (60 s for sticky/calls), urgency high for sticky. A 404 or 410 removes that device (re-reading
  the list first so a device that subscribed meanwhile is not wiped). Returns how many got it.
- **Service worker.** `push` shows the notification (vibration, tag replaces old ones, `requireInteraction` when sticky).
  `notificationclick` handles: web-task Approve/Reject (`POST /api/web-tasks/<id>`), habit Done/Snooze
  (`POST /api/habits/<id>/check|snooze`), and otherwise focuses an open HIVEMIND window or opens the url.
- **Failure alerts (`lib/alerts.ts`).** `alertFailure(db, job, err)` for `brief`, `dream`, `autopilot`, `scheduler`: at most
  one push per job per day (state in `alert-state`, date in `HOME_TZ`). `reasonOf()` turns errors into plain words and
  strips `key=`, `token=`, `secret=` values.
- **Scheduler status** on the Settings card: `notify-state.lastRun` is shown; more than 15 minutes old shows in red.

### 3.9 Offline layer (`lib/offline.ts`, `public/sw.js`, `components/offline-status.tsx`)

Two parts:

1. **Service worker caching** (production only, registered as `/sw.js?cache=1`):
   - `/_next/static/*` and `/icons/*`: cache first (cache `hivemind-static`, trimmed past 500 entries).
   - Page navigations (not `/api/`, `/unlock`, `/call/`): network first, last good copy when offline (cache
     `hivemind-pages`); redirects are never stored. Otherwise a small built-in "You're offline" page with links to Notes and Memories.
   - The app asks the worker to "warm" `/`, `/notes`, `/memories` and their build files while online.
   - In dev (`/sw.js` without `cache=1`) it caches nothing and deletes old caches.
2. **IndexedDB** database `hivemind-offline` with stores `cache`, `outbox`, `meta`:
   - Reads of `/api/notes`, `/api/memories*`, `/api/projects` are copied into the cache. Offline, `offlineRead` answers from
     it (it can even filter the memory list locally for search).
   - Creating, editing or deleting a note or memory offline goes into an **outbox**, shows at once with a temporary
     `local-<uuid>` id, and is sent in order when online. A create carries `client_id` (its temp id) so a retry after a lost
     reply cannot duplicate. Edits to an unsynced item fold into its create. Last write wins.
   - Flush stops on network error, `401` ("Unlock HIVEMIND to sync") or `5xx/429` and retries (every 60 s while items wait,
     and when the browser goes online). A `4xx` other than 404 drops that item and shows "Couldn't sync…".
   - The status pill (`OfflineStatusPill`) shows offline / N changes waiting / syncing / an error; tap to sync now. Hidden when all is well and on public pages.
   - **Lock or logout** calls `clearOfflineCache()`: flush (up to 4 s), then wipe the three stores and the page and share caches.
3. **Share target.** `public/sw.js` intercepts `POST /share-in` (the manifest's Android share target), stores up to 5
   files plus title/text/url in cache `hivemind-share`, and redirects to `/share`. If the worker is not running,
   `app/share-in/route.ts` redirects to `/share?error=1`.

### 3.10 Auto-update (`components/version-watcher.tsx`, `app/api/version/route.ts`, `next.config.ts`)

- At build time `next.config.ts` sets `NEXT_PUBLIC_BUILD` to `VERCEL_GIT_COMMIT_SHA`, or `dev` in development, or
  `local-<timestamp>` for a local build.
- `GET /api/version` returns the server's `{build}` with `Cache-Control: no-store`. It is behind the password (it is not in the open list).
- `VersionWatcher` checks when the app comes to the front and every 5 minutes. If the server's build differs it reloads
  the page, **unless**: a voice session is on, the path is `/games…`, `/focus…` or a public page, or an input has text in it.
  It does nothing in development, when hidden, offline, or when `NEXT_PUBLIC_BUILD` is empty.

### 3.11 Health / System check (`lib/health.ts`, `GET /api/health`)

`systemCheck()` returns a list of `{name, status: ok|warn|fail, detail}`:

| Check | Fail / warn when |
|---|---|
| Database | `select` on `projects` errors |
| Scheduler | `notify-state.lastRun` missing (fail) or older than 2 h (fail) |
| Table privacy | `tables_without_rls()` lists any table (fail); function missing = warn "run 004 migration" |
| Embeddings | re-embed running (warn), stored vs configured model differ (warn), rows missing a vector (warn), error (fail) |

The Settings card (`components/system-check-card.tsx`) also drives re-embedding via `/api/embeddings` (covered in
`docs/02-brain-and-ai.md`). The scheduler also checks table privacy once a day and pushes "Database table not private" (`app/api/cron/notify/route.ts`).

### 3.12 Safe fetching (`lib/safe-fetch.ts`)

`safeFetch(url)` is for user- or AI-supplied URLs (page import, shared links). It allows only `http(s)`, no credentials in
the URL, no `localhost`, `.local`, `.internal`. It blocks private, loopback, link-local (cloud metadata), CGNAT,
multicast and reserved IPv4 and IPv6 ranges (including IPv4 hidden in IPv6, NAT64, 6to4). The connection uses a custom DNS
lookup that refuses the name if **any** answer is internal (stops DNS rebinding), and every redirect hop (max 4) is
re-checked. Bodyless requests only; gzip/deflate/brotli are decoded.

### 3.13 Theming (`app/globals.css`, `app/layout.tsx`)

There is **one dark theme** (no light mode). CSS variables on `:root`: `--bg`, `--bg-raised`, `--bg-sunken`, `--line`,
`--fg`, `--soft`, `--faint` (contrast tuned to 4.5:1), `--core` (amber, the AI/primary), `--data` (ice blue, links/readouts),
`--alert` (red), `--ok` (green), declared in oklch. Tailwind 4 maps them with `@theme inline` (`bg-core`, `text-soft`...).
`--tabbar-h` makes room for the phone tab bar. The layout loads Geist and Geist Mono from `next/font/google`.

### 3.14 Root layout (`app/layout.tsx`)

Sets the title template `"%s · HIVEMIND"`, `robots` noindex, Apple web-app meta, a dark `themeColor` (`#0d1117`),
`viewportFit: cover`. It mounts, inside `VoiceProvider`, the site-wide widgets: `VoiceDock`, `GuestBanner`, `OwnerCheckCard`,
`HandoffCard`, `ServiceWorker`, `OfflineStatusPill`, `WebTaskWindow`, `MusicPlayer`, `MiniConcert`, `VideoPlayer`,
`LocationReporter`, `MobileNav`, `ReminderWatcher`, `NightCheckin`, `LivingSky`, `BeatLights`, `Nova`, `WakeListener`,
`VersionWatcher`. Route groups: `app/(bridge)/page.tsx` is the home ("/") console; `app/(app)/` holds the other pages
(see `docs/07-app-shell-pages-and-navigation.md`).

### 3.15 Files

| File | What it holds |
|---|---|
| `proxy.ts` | The password gate, open paths, matcher |
| `next.config.ts` | Security headers, build id, Turbopack root, external packages, trace includes |
| `vercel.json` | One cron: keepalive daily |
| `package.json` | Scripts and dependencies (section 6) |
| `tsconfig.json` | Strict TS, `@/*` alias to repo root, bundler resolution, target ES2017 |
| `eslint.config.mjs` | `eslint-config-next` core-web-vitals + typescript; ignores `.next`, `out`, `build` |
| `vitest.config.mts` | Node environment, `tests/**/*.test.ts`, alias `@/`, stubs `server-only` with `tests/server-only-stub.ts` |
| `playwright.config.ts` | E2E config: desktop Chrome + Pixel 7, 1 worker, starts `next start` with a test password |
| `.env.example` | Environment template |
| `app/layout.tsx`, `app/globals.css` | Root layout, theme |
| `app/manifest.ts`, `app/robots.ts` | PWA manifest (shortcuts, share target), `Disallow: /` |
| `app/unlock/page.tsx` | Lock screen |
| `app/(bridge)/page.tsx` | Home console (galaxy, chat, panels): see `docs/02-brain-and-ai.md` and `docs/07-app-shell-pages-and-navigation.md` |
| `app/share-in/route.ts` | Fallback for the share target |
| `lib/session.ts` | Sessions, cookies, trusted device, peer proof, `safeEqual` |
| `lib/secrets.ts` | Random signing secrets |
| `lib/db.ts` | Supabase client with retry |
| `lib/private-store.ts` | JSON store and markers |
| `lib/api.ts` | `handle`, `HttpError`, `parseBody`, `dbError`/`dbFault`, `toVector` |
| `lib/client-api.ts` | Browser `api()`, `useFetch`, event names, stream reader, shared types |
| `lib/safe-fetch.ts`, `lib/safe-decode.ts`, `lib/scrub.ts` | Safe URL fetch, safe decode, text scrub |
| `lib/public-paths.ts` | `isPublicPage` |
| `lib/origin.ts` | `originOf()`: where a document or memory came from (source URL, apply link, portfolio repo) |
| `lib/push.ts`, `lib/alerts.ts` | Web push, failure alerts |
| `lib/offline.ts` | IndexedDB offline layer |
| `lib/health.ts` | System check |
| `public/sw.js` | Service worker |
| `supabase/schema.sql`, `supabase/migrations/*.sql` (002 to 004) | Database |
| `scripts/restore-backup.mjs`, `scripts/check-theatre-links.mjs` | Restore a backup; check theatre film links |

`public/` contents: `sw.js`; `icons/` (`icon-192.png`, `icon-512.png`, `maskable-512.png`); `chess/` (12 piece SVGs +
`CREDITS.txt`); `mascots/` (karthik and nova direction/reaction sprite sheets, `.webp`); `projects/` (13 project card
images); `journey/` and `journey-3d/` and `journey-env/` (3D avatar, animations `.fbx`, furniture models `.glb`, photos);
`models/xbot.glb`; `sky/` (planet and Milky Way textures, `lines.json`); `tex/` (terrain textures); `theatre/posters/`
(film posters); `wake/` (two ONNX models for the wake word); default Next SVGs (`file.svg`, `globe.svg`, `next.svg`,
`vercel.svg`, `window.svg`). `app/icon.svg` and `app/apple-icon.png` are the favicons.

## 4. API

Every route is behind the owner session (proxy) unless the table says otherwise. `handle()` turns thrown `HttpError` into
its status, a zod error into `400 {error:"Invalid input", issues}`, and anything else into `500 {error:"Something went wrong"}`.

| Method | Path | Who may call | Purpose | Request | Response |
|---|---|---|---|---|---|
| POST | `/api/unlock` | open | Log in | JSON `{password}` (not schema-checked; non-string counts as wrong) | `{ok:true}` + cookies; `401 Wrong password`; `429` locked with `Retry-After` |
| DELETE | `/api/unlock` | open (cookie read) | Log out this browser | none | `204`, deletes `sb_owner` |
| DELETE | `/api/unlock?all=1` | owner session | Log out every device | query `all=1` | `204`; `401 Locked` if not signed in |
| GET | `/api/version` | owner session | Server build id | none | `{build}`, no-store |
| GET | `/api/health` | owner session | System check | none | `{checks:[{name,status,detail}]}` |
| GET | `/api/push` | owner session | Push setup state | none | `{configured, publicKey, schedulerLastRun, devices:[{endpoint,device,added}]}` |
| POST | `/api/push` | owner session | Save this device | `{subscription:{endpoint(url), keys:{p256dh,auth}}, device?(<=80)}` | `{devices:n}`; `503` if VAPID missing |
| DELETE | `/api/push` | owner session | Remove a device | `{endpoint(url)}` | `204` |
| POST | `/api/push/test` | owner session | Send a test notification | none | `{sent:n}` |
| GET | `/api/sessions` | owner session | Signed-in browsers (used by Settings) | none | `{sessions:[{created,expires,device}]}` |
| GET | `/api/cron/keepalive` | cron secret | Keep Supabase awake + scheduler watchdog | header `Authorization: Bearer <CRON_SECRET>` | `{ok, at, scheduler:"ok"|"stale"}`; `401`; `500` if the RPC fails |
| GET | `/api/ice` | open | Short-lived TURN logins for calls and games | none | `{iceServers:[...]}` (empty if no relay configured), no-store |
| POST | `/api/peer/proof` | owner session | Sign a guest's challenge | `{kind: call/draw/ludo/cards/chess/dots/party, room: 8-40 alnum, nonce: 16-64 [a-z0-9-]}` | `{proof}` |
| POST | `/api/peer/verify` | open | Guest checks the host's proof | same plus `proof` (<=128) | `{ok:boolean}` |

Other cron routes (`/api/cron/notify`, `/api/cron/web-task`, `/api/cron/app-build`) use the same secret scheme and are
described in the docs of the features they run (`docs/05-daily-life-habits-reminders-career.md`, `docs/04-autopilot-web-tasks-apps.md`).

`/api/ice` details: tries Cloudflare Realtime TURN (`TURN_KEY_ID` + `TURN_KEY_API_TOKEN`, ttl 3600 s), then Metered
(`METERED_DOMAIN` + `METERED_API_KEY`). Result is cached in memory for half the ttl; on error it serves the cached list or an empty one.

## 5. Data

### 5.1 Database (Supabase Postgres + pgvector)

Setup order (README): `supabase/schema.sql`, then `002_single_user.sql`, `003_jarvis.sql`, `004_rls_guard.sql`.
**The schema file alone is not the final schema.** After 002, `user_id` columns and the `owner_all` policies are gone.

Final tables (all in `public`, all with RLS enabled and **no policies**, so only the secret key can read or write):

| Table | Columns (final) | Notes |
|---|---|---|
| `projects` | `id uuid pk`, `name`, `description`, `status` (default `active`), `metadata jsonb`, `source_key text`, `created_at`, `updated_at` | Unique on `lower(name)` and on `source_key` (where not null) |
| `notes` | `id`, `project_id -> projects (on delete set null)`, `title`, `content`, `summary`, `category`, `tags jsonb`, `metadata jsonb`, `embedding vector(768)`, `created_at`, `updated_at` | |
| `memories` | `id`, `project_id`, `title`, `content`, `memory_type` (check: fact, knowledge, experience, decision, idea, preference, project_context, learning), `category`, `importance int 1..10` (default 5), `confidence real 0..1` (default 1), `tags`, `metadata`, `embedding vector(768)`, timestamps | |
| `memory_versions` | `id`, `memory_id -> memories (cascade)`, `version_number`, `title`, `content`, `change_reason`, `created_at` | Unique `(memory_id, version_number)` |
| `documents` | `id`, `project_id`, `filename`, `file_type`, `status` (check: processing, ready, failed), `summary`, `chunk_count`, `error`, `source_url`, `created_at` | `file_type` check constraint dropped in 002 |
| `document_chunks` | `id`, `document_id -> documents (cascade)`, `chunk_index`, `content`, `metadata jsonb`, `embedding vector(768)`, `created_at` | |
| `conversations` | `id`, `title`, `created_at` | |
| `messages` | `id`, `conversation_id -> conversations (cascade)`, `role` (user/assistant), `content`, `metadata`, `created_at` | |
| `brain_profile` | `id int pk default 1 check (id=1)`, `summary`, `facts jsonb`, `updated_at` | Single row: what the AI understands about the owner |
| `activity` | `id`, `kind`, `message`, `payload jsonb`, `undone bool`, `created_at` | Autonomous actions log with undo |

The code uses only these ten tables (`grep` of `.from("…")` over `app`, `lib`, `components`).

Indexes: `notes_user_idx`, `memories_user_idx`, `documents_user_idx` (these were on `user_id` columns, dropped with them by 002 via
`drop column ... cascade`; replaced by `notes_updated_idx`, `memories_updated_idx`, `documents_created_idx`),
`chunks_doc_idx (document_id, chunk_index)`, `versions_memory_idx`, `messages_conv_idx`, HNSW cosine indexes
`notes_embedding_idx`, `memories_embedding_idx`, `chunks_embedding_idx`, `documents_source_url_idx`, `memories_source_idx`
(on `metadata->>'source'`), `notes_project_idx`, `memories_project_idx`, `documents_project_idx`, `activity_created_idx`,
`projects_source_key_idx`, `projects_name_lower_idx`.

Functions (RPC):

| Function | Defined in | Purpose | Access |
|---|---|---|---|
| `match_knowledge(query_embedding vector(768), match_count=8, filter_project=null, min_similarity=0.35)` | `schema.sql` | Semantic search over notes, memories and document chunks (union, top N each, filtered by similarity, best N overall). `security invoker`, `search_path = public, extensions` | Execute revoked from `anon`, `authenticated` in 002 |
| `keepalive()` | `schema.sql` | Returns `now()`; used by the daily cron | Execute revoked from `anon` in 002 (`authenticated` still has it from the original grant) |
| `tables_without_rls()` | `004` | Lists public tables with RLS off. `security definer`, `search_path=''` | `service_role` only |
| `rls_auto_enable()` + event trigger `rls_auto_enable` on `ddl_command_end` | `004` | Any table created in `public` gets RLS enabled automatically | Not callable by clients |

Extension: `vector` in schema `extensions`. Embedding size is fixed at 768 (Gemini `gemini-embedding-001`).
RLS policies: after 002 **none exist**; the original `owner_all` policies (for `authenticated` users scoped by `user_id`) were dropped.

### 5.2 Private store keys (this area)

| Key (file `<key>.json`) | Content |
|---|---|
| `auth/sessions` | List of sessions `{id (hashed), created, expires, device, pw}` |
| `auth/secrets` | `{session, peer}` random hex secrets |
| `push-subscriptions` | Up to 10 push subscriptions with `device`, `added` |
| `notify-state` | Scheduler bookkeeping (`lastRun`, `brief` date, `rls` date, etc.; shared with other docs) |
| `alert-state` | `{brief?, dream?, autopilot?, scheduler?}` last alert date |
| `unlock-fails/<hash>/…`, `unlock-fails-all/…` | Marker files, one per wrong password |

### 5.3 Browser storage

| Where | Key | Meaning |
|---|---|---|
| IndexedDB `hivemind-offline` | stores `cache`, `outbox`, `meta` (`idmap`) | Offline copies, queued writes, temp-id to real-id map |
| sessionStorage | `hm-warmed-at` | Last time lists were refreshed (5 min throttle) |
| sessionStorage | `hivemind-ask` | One-tap request marker (set by HIVEMIND itself) |
| Cache Storage | `hivemind-pages`, `hivemind-static`, `hivemind-share` | Pages, build files, shared files |
| Cookies | `sb_owner`, `sb_trusted` | See 3.3 |

## 6. Configuration

### Environment variables

Template: `.env.example`. A real `.env.local` exists in the repo folder (git-ignored per README); its values were not read for this doc.

| Name | Required? | Meaning | Default |
|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Yes | Database. Missing throws "not set" in `db()` | none |
| `APP_PASSWORD` | Required on Vercel (503 otherwise); empty locally | The owner password | none |
| `CRON_SECRET` | Needed for cron routes | Bearer secret for `/api/cron/*` | none (routes 401) |
| `SESSION_SECRET`, `PEER_SECRET` | No (not in template) | Override auto-generated signing secrets; 32+ chars | generated into the private store |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | For push (not in template) | Web Push keys | none (push off) |
| `VAPID_SUBJECT` | No | Contact for push services | `mailto:owner@hivemind.local` |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | No (not in template) | Cloudflare TURN relay for `/api/ice` | none |
| `METERED_DOMAIN`, `METERED_API_KEY` | No (not in template) | Metered TURN relay | none |
| `NEXT_PUBLIC_TURN_URL/USER/PASS` | No | A fixed TURN relay in `lib/ice.ts`; these are public to the browser | none |
| `APP_URL` | No | Public origin used by Autopilot, agent tool and OpenRouter headers | request origin / empty |
| `VERCEL_GIT_COMMIT_SHA` | Set by Vercel | Becomes the build id | `dev` / `local-<time>` |
| `PORTFOLIO_MCP_URL`, `PORTFOLIO_DATA_REPO` | No | Portfolio source (`lib/origin.ts` uses the repo name) | repo `Karthikeyan260/Portfolio-mcp` |
| `HOME_CITY`, `HOME_TZ`, `BRIEF_HOUR` | No | Weather city, time zone used for "today", brief hour | `Chennai`, see `lib/reminders.ts`, 8 |
| AI keys and models (`GEMINI_*`, `NVIDIA_*`, `GROQ_*`, `MISTRAL_*`, `OPENROUTER_MODEL`, `WEB_SEARCH_MODELS`...) | Per feature | See `docs/02-brain-and-ai.md` | |
| `E2E_PORT`, `E2E_PASSWORD` | Tests only | Playwright port (3000) and password (`localtest`) | |

Other variables read in code (`STEEL_API_KEY`, `YOUTUBE_API_KEY`, `RAPIDAPI_KEY/SECRET`, `GITHUB_USER`, `MUSIC_LANGUAGE`) belong to other docs.

### `next.config.ts`

- Security headers on `/:path*`: `X-Frame-Options: DENY`; CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`
  (no `script-src`, deliberately, because three.js, PeerJS and Gemini Live use several origins); `X-Content-Type-Options: nosniff`;
  `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy: microphone=(self), camera=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()`;
  `X-Robots-Tag: noindex, nofollow`; HSTS `max-age=63072000; includeSubDomains`.
- Override for `/api/career/:id/resume`: `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` (the Career page previews the PDF in an iframe).
- `poweredByHeader: false`; `serverExternalPackages: ["@react-pdf/renderer", "playwright-core"]`; `outputFileTracingIncludes` ships playwright-core with `/api/web-tasks/**` and `/api/cron/web-task`; `turbopack.root`.

### Scripts (`package.json`)

| Script | Runs | Why |
|---|---|---|
| `dev` | `next dev` | Local development |
| `build` / `start` | `next build` / `next start` | Production build and server |
| `lint` | `eslint` | Lint |
| `test` | `vitest run` | Unit tests in `tests/` |
| `test:db` | `vitest run tests/db.integration.test.ts` | Live Supabase checks (needs a database) |
| `test:e2e` | `playwright test` | Browser tests against a production build |
| `test:sweep` | `playwright test e2e/sweep.spec.ts` | Page sweep |
| `restore` | `node scripts/restore-backup.mjs` | Restore an export |
| `theatre:links` | `node scripts/check-theatre-links.mjs` | Check that theatre films still play |

### Main dependencies (and why)

| Package | Why |
|---|---|
| `next` 16, `react`/`react-dom` 19.2.8 | The framework |
| `@supabase/supabase-js` | Database and storage client |
| `zod` 4 | Input validation in routes |
| `web-push` | Web Push sending with VAPID |
| `server-only` | Fail the build if a secret module is imported client-side |
| `@google/genai`, `openai` | Gemini, and the OpenAI-compatible APIs (NVIDIA, Groq, Mistral, OpenRouter) |
| `@react-pdf/renderer`, `mammoth`, `unpdf` | Make resume PDFs; read `.docx`; read PDFs |
| `playwright-core` | Drive a remote browser for web tasks |
| `peerjs` | Browser-to-browser calls, games, theatre |
| `three`, `postprocessing`, `gsap`, `@gsap/react` | 3D galaxy, journey, effects, animation |
| `leaflet` | Map page |
| `chess.js` | Chess games |
| `onnxruntime-web` | Wake-word models in the browser |
| `lucide-react` | Icons |
| Dev: `@playwright/test`, `vitest`, `eslint`, `eslint-config-next`, `tailwindcss` + `@tailwindcss/postcss`, `typescript`, `@types/*` | Tests, lint, styling, types |

`overrides` pins `mammoth`'s `argparse` to `^2.0.1`.

## 7. Security and privacy

- **Who can reach what.** Everything needs the session except the open list in 3.2; cron routes need the secret; guest
  endpoints only work for rooms the owner created (checked in their own routes, other docs).
- **Password handling.** Constant-time comparison (hash first, so length is not timeable). The password never goes into the
  cookie. Cookie signing key is random and separate from the password; changing the password invalidates all sessions.
- **Brute force.** 8 wrong tries per address per 15 min, 60 global (trusted browsers exempt from the global one), 800 ms delay
  per wrong guess, IPs stored only as a 24-char SHA-256 prefix.
- **Cookies.** `httpOnly`, `sameSite=lax`, `secure` in production.
- **Headers.** See section 6. No framing, noindex, HSTS, restricted device permissions.
- **Database.** Secret key server-side only; RLS on with no policies; `004` makes new tables private automatically; daily check and push alert if any table is open.
- **Safe fetch.** Blocks internal addresses and DNS rebinding (3.12). Tested in `tests/safe-fetch.test.ts`.
- **Logging.** `reasonOf` strips `key=`/`token=`/`secret=` values from failure alerts; DB errors log the message only for 5xx.
- **Offline data.** Private copies on the device are wiped on logout/lock.
- **Open endpoints with side effects:** `/api/ice` (spends your TURN relay quota, no rate limit seen, cached 30 min) and
  `/api/peer/verify` (HMAC check only).

## 8. Limits and edge cases

| Thing | Value |
|---|---|
| Session lifetime | 180 days |
| Trusted cookie | 365 days |
| Sessions kept | 30 per password fingerprint |
| Session cache per instance | 10 s |
| Login attempts | 8 per address / 15 min; 60 global / 15 min (trusted exempt) |
| Wrong password delay | 800 ms |
| Push subscriptions kept | 10 |
| Push timeout | 10 s; TTL 3600 s (60 s sticky) |
| Failure alert | once per job per day |
| Scheduler stale | 2 h (system check, watchdog); Settings card shows red after 15 min |
| Version check | every 5 min and on focus |
| Offline sync retry | every 60 s while pending |
| List refresh throttle | 5 min |
| Static cache size | trimmed when over 500 entries |
| Share inbox | 5 files |
| Supabase retry | 2 retries (350 ms, 700 ms) on 5xx, network error, or 401 "JWT issued at future" |
| Private store file walk | depth 3, max 600 files per backup |
| `safeFetch` redirects | 4 |
| Cron route time | `maxDuration = 60` on notify, web-task, app-build |

Failure behavior: if the session store cannot be read, only a session seen alive in this instance's memory is accepted. If
login-marker counting fails, it counts as 0 (the in-memory counter still applies). If notifications are not set up, pushes
quietly return 0 sent.

## 9. Tests

| Test | Covers |
|---|---|
| `tests/alerts.test.ts` | Once-a-day failure alert, plain reasons without secrets |
| `tests/push-notify.test.ts` | Sending to all devices with timeout, dropping 410 devices, no wipe of a new subscription, no-op when unconfigured |
| `tests/safe-fetch.test.ts` | `isBlockedAddress` ranges |
| `tests/scrub.test.ts` | NUL and lone-surrogate removal |
| `tests/db-fault.test.ts` | Database error to HTTP status mapping |
| `tests/ice.test.ts` | Relay list cleanup (`lib/ice.ts`) |
| `tests/no-control-chars.test.ts` | No stray control characters in source (mangled regex escapes) |
| `tests/db.integration.test.ts` | Live: `match_knowledge`, RLS (`npm run test:db`; not run for this doc) |
| `e2e/smoke.spec.ts` | Locked without a session, wrong password refused, unlock then chat then lock |
| `e2e/sweep.spec.ts` | Page sweep (not read in detail) |

Not covered by any test I found: `lib/session.ts` (cookie parsing, lockout, revocation, password-change invalidation),
`proxy.ts` open-path list, `lib/offline.ts` (outbox, id map, flush), `lib/private-store.ts`, `lib/health.ts`,
`app/api/unlock` lockout, `/api/cron/*` auth, `/api/peer/*`, the service worker, `VersionWatcher`.

## 10. Checked and notes

Verified by reading:
- Gate logic and open list: `proxy.ts:9-27`; matcher `proxy.ts:34`. 503 rule: `lib/session.ts:16`, `proxy.ts:17`.
- Session cookie lifetimes `lib/session.ts:10-11`; cap of 30 per password `lib/session.ts:54-61`; logout-all `app/api/unlock/route.ts:69-78`.
- Cron auth uses `safeEqual` on all four cron routes (`app/api/cron/*/route.ts`).
- Private store only falls back on a true 404 (`lib/private-store.ts:28-50`).

Findings:
1. **README says "That browser stays unlocked for a year"** (README deploy step 4), but the session cookie lasts 180 days
   (`lib/session.ts:10`). Only the trusted cookie is 365 days.
2. **`supabase/schema.sql` alone is stale.** It still defines `user_id` columns, `auth.uid()` defaults and `owner_all` policies
   that migration 002 removes, and lacks `source_url`, `brain_profile`, `activity`, `metadata` on projects. The README does say to
   run all four files in order, but a fresh setup must not stop after `schema.sql`. Also `notes_user_idx`, `memories_user_idx`,
   `documents_user_idx` in the schema are dropped silently with the `user_id` column.
3. **`.env.example` has a garbled line:** `# MISTRAL_MODEL=ministral-14b-latestqwen/qwen3.8-27b` (two values joined). It also omits
   variables the code reads: `VAPID_*`, `TURN_*`/`METERED_*`, `SESSION_SECRET`, `PEER_SECRET`, `APP_URL`, `HOME_TZ`, `BRIEF_HOUR`.
   Notifications silently stay off until the VAPID keys are added.
4. **`/api/cron/notify` returns 503 when VAPID keys are missing** (`app/api/cron/notify/route.ts:42`) before doing anything, so without push the
   scheduler never records `lastRun`, and System check shows "Scheduler: Has never run" even if cron-job.org is calling correctly.
5. **Only one cron lives in `vercel.json`.** Reminders, the brief and Autopilot depend on an external cron-job.org job that is not
   in the repo. The keepalive watchdog and System check are the only safety net, and the only mention of the setup is a pointer to the README.
6. **`/api/ice` is open and unauthenticated** and every call may spend TURN relay credentials (mitigated by a 30 minute in-memory
   cache per instance). No rate limit seen. `NEXT_PUBLIC_TURN_PASS` (if used) is shipped to every browser by design.
7. **`/api/unlock` does not validate its body with zod** (`await req.json().catch(() => ({}))`); a non-string password counts as a wrong
   attempt, which is fine, but it is the one POST route outside `handle()`. A successful login with no `APP_PASSWORD` set returns
   `{ok:true}` without a cookie, including in production (harmless, since the proxy returns 503 there).
8. **The `sb_trusted` cookie is not cleared on logout** (by design, comment in `lib/session.ts:8`). Lockout is per address as well, and a
   trusted browser is only exempt from the global limit, not the per-address limit (`app/api/unlock/route.ts:44`).
9. **Sessions are one JSON file** read-modify-written by every login/logout (`lib/session.ts:46-63`). Two simultaneous logins on
   different instances can overwrite each other (last write wins); a lost session just means logging in again.
10. **`keepalive()` is still executable by `authenticated`** (only `anon` was revoked in 002). Harmless (`select now()`) and no
    `authenticated` role is used.
11. Only a dark theme exists; `viewport.themeColor` and the manifest are fixed to `#0d1117`. Not a bug, but there is no light mode.
12. The `(bridge)/page.tsx` home page is a ~1100 line client component (chat stream, 3D galaxy, voice, panels). Works as designed,
    but it is the largest single file in this area and has no tests.
13. Dead or placeholder: `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` are Next.js template files; no
    reference to them exists in `app/`, `components/` or `lib/` (grep).
