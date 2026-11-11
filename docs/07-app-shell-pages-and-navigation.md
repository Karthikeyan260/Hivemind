# App shell, pages and navigation

The "shell" is everything around the features: how you sign in, how you move between pages (sidebar on a laptop, tab bar on a
phone), the home dashboard, the Ctrl K search box, installing the app on a phone, working offline, turning on notifications,
and the small rules about language, look and accessibility. This file also holds the **page index**: every URL in the app,
what it is for, which API routes it calls and which document explains it in depth.

> Describes the code as read on 2026-11-10. Feature internals live in the other docs: `docs/02-brain-and-ai.md`,
> `docs/03-voice-and-wake-word.md`, `docs/04-autopilot-web-tasks-apps.md`, `docs/05-daily-life-habits-reminders-career.md`,
> `docs/06-nova-garden-games-and-stories.md`, `docs/friends-theatre.md`. (Those numbered files may not all exist yet when you read this.)

Contents:

1. [What it does](#1-what-it-does)
2. [How to use it](#2-how-to-use-it)
3. [How it works](#3-how-it-works)
4. [API](#4-api)
5. [Data](#5-data)
6. [Configuration](#6-configuration)
7. [Security and privacy](#7-security-and-privacy)
8. [Limits and edge cases](#8-limits-and-edge-cases)
9. [Tests](#9-tests)
10. [Page index](#10-page-index)
11. [Checked and notes](#11-checked-and-notes)

---

## 1. What it does

- **Password gate.** One owner, one password. Every page and API route is locked until you sign in on `/unlock`. Only a few
  guest pages (calls, game invites, theatre rooms) are open.
- **Two layouts.** On a laptop (width 768 px and up) a slim **sidebar** on the left lists 28 pages. On a phone there is a
  slim title bar on top and a **bottom tab bar** (Home, Memories, Career, Journey, More). "More" opens a sheet with every
  other page.
- **Home dashboard** (`/`). A full-screen "bridge": a 3D knowledge galaxy in the middle, the chat console on the right,
  profile / agenda / habits / pinned cards on the left. Voice and typed chat both live here.
- **Command palette** (Ctrl K, or `/`). A search box that jumps to any page, one of your apps, a project or a habit, and
  also finds notes, memories and documents by meaning. It navigates; it does not run actions.
- **Installable app (PWA).** "Add to Home screen" gives a full-screen app with an icon, four long-press shortcuts, and a
  slot in Android's Share menu.
- **Offline.** In a production build the app pages open with no network, and notes and memories can be read, created, edited
  and deleted offline; changes sync when you are back online. A small status pill shows what is happening.
- **Notifications.** A card in Settings turns on push notifications for this device (reminders, morning brief, incoming
  calls, habit and web-task buttons).
- **Language.** A Settings card chooses the language HIVEMIND answers in: match me, Tamil, English.
- **Look.** One dark "HUD" theme (amber for the AI, ice-blue for data). There is no light theme.
- **Accessibility basics.** Labelled controls, a visible focus ring, 44 px touch targets, reduced-motion support, a
  dialog-style "More" sheet. Gaps are listed in section 11.

## 2. How to use it

### Sign in

1. Open the app. Without a session you are sent to `/unlock`.
2. You see the HIVEMIND "core" animation, the word HIVEMIND, "Identify yourself.", a password box (focused already) and an
   **Unlock** button. The button reads "Verifying…" while it works and the core switches to its "thinking" state.
3. A wrong password shows the server's message under the box ("Wrong password", or "Too many wrong attempts. Try again in N
   min."). A right one goes to `/` and stays signed in for up to 180 days on that browser.
4. **Lock** (bottom of the sidebar, or bottom of the phone "More" sheet) signs this browser out and returns to `/unlock`. The
   Lock button only appears when a password is set on the server.

### Move around

| Where | How |
|---|---|
| Laptop, any page except home | Left sidebar: click a page. A search button at the top of it opens the palette. |
| Laptop, home | The home page has **its own top bar** (Overview, Memories, Notes, Projects, Career, Autopilot, Web, Map, Search, and a "More" drop-down with 14 more). No sidebar there. |
| Phone | Bottom tabs for Home, Memories, Career, Journey; **More** opens a 3-column grid of all other pages plus your own apps and Lock. The title bar shows the current page name and a search icon that opens the palette. |
| Anywhere (not home) | **Ctrl K** (Cmd K on Mac) opens the palette; **/** opens it when you are not typing in a field. |

### Command palette

Type to filter. With nothing typed you see the "Go to" list (all pages) and a few apps, projects and habits. Arrow keys move,
**Enter** opens, **Esc** closes. After you pause for about 0.3 s and have typed 3+ letters, a "From your notes and memories"
group appears with meaning-based hits; picking one opens that note, memory or document. The last row is always "Search
everything for ..." which opens `/search`.

### Keyboard shortcuts (all that the code defines for the shell)

| Key | Where | What |
|---|---|---|
| Ctrl/Cmd K | every page under `app/(app)` (not home, not call/play/focus/theatre rooms) | Open or close the palette |
| `/` | same pages, when not typing | Open the palette |
| `/` | home page, when not typing | Focus the chat box (`app/(bridge)/page.tsx`) |
| Space | every owner page, when focus is not in an input, button, link or editable area | Start or end the live voice conversation (`components/voice/provider.tsx`) |
| Esc | every owner page | Stops live voice; on home also stops speech, clears galaxy focus and selection |
| Up / Down / Enter / Esc | inside the palette | Move, open, close |
| Esc | "More" sheet (phone) | Close the sheet and return focus to the More button |

### Install as an app

- **Android (Chrome):** menu, "Install app" / "Add to Home screen". It opens full screen (`display: standalone`, portrait).
  Long-press the icon for four shortcuts: **Talk now** (`/focus?talk=1`), **Quick note** (`/notes?new=1`), **Today's brief**
  (`/?brief=1`), **Remember this** (`/memories?new=1`).
- **iPhone:** Share, "Add to Home Screen". Notifications only work from the installed app (the Settings card says so).
- There is no custom "Install" button: the code has no `beforeinstallprompt` handler (checked by grep).

### Share from another Android app

Tap Share in any app, choose HIVEMIND. The service worker keeps the shared title, text, link and up to 5 files, then opens
`/share`, which saves them with your signed-in session (links are read and summarised, photos described, PDFs and Word files go
to Documents). Accepted file types are listed in `app/manifest.ts`.

### Offline, as you see it

- A small pill at the bottom left appears only when something is off: "Offline · notes & memories still work", "N changes
  waiting", "Syncing…", or a sync error. Tap it to sync now (disabled while offline or syncing).
- Pages you have opened open again from the last saved copy. A page not saved yet shows a plain offline screen with links to
  Notes and Memories and a "Try again" button.
- Offline writes are limited to **notes and memories**. Other pages that need the server will show their normal load errors.

### Turn on notifications

Settings, "Notifications" card, **Turn on for this device**. The browser asks permission only after you press that button. The
card then sends a test notification. States it can show: checking, unsupported browser, iPhone-not-installed, server keys
missing, blocked, off, on. Once on you get "Send a test" and "Turn off here", a list of subscribed devices, and a line saying
when the scheduler last ran (see section 11).

### Language

Settings, "Language" card: **Match me** (Tamil to Tamil, Tanglish to Tanglish, English to English), **தமிழ்** (always Tamil),
**English** (always English, still understands Tamil). Live voice picks up a change the next time you start it.

## 3. How it works

### Page structure

```
app/layout.tsx  (root: every page)
 |- VoiceProvider wraps everything
 |- always-on overlays: VoiceDock, GuestBanner, OwnerCheckCard, HandoffCard, ServiceWorker, OfflineStatusPill,
 |  WebTaskWindow, MusicPlayer, MiniConcert, VideoPlayer, LocationReporter, MobileNav, ReminderWatcher,
 |  NightCheckin, LivingSky, BeatLights, Nova, WakeListener, VersionWatcher
 |
 |- app/(bridge)/page.tsx          "/"  home (own top bar, no sidebar, no palette)
 |- app/(app)/layout.tsx           Sidebar + CommandPalette + <main> with bottom padding for tab bar and music player
 |    '- app/(app)/(pages)/layout.tsx   adds page padding (px-4 py-6, md:px-10 md:py-10)
 |         '- /autopilot /web /memories /notes ... (all pages in the index below)
 |- app/unlock, app/call/[room], app/play/[room], app/theatre/[room], app/focus, app/share-in   (outside (app): no sidebar)
```

Route groups in parentheses (`(app)`, `(bridge)`, `(pages)`) do not appear in the URL. Note: the file `app/(app)/page.tsx` does
**not** exist; the home page is `app/(bridge)/page.tsx`. `app/(app)/layout.tsx` is `force-dynamic` and passes
`passwordRequired()` to the sidebar so Lock is hidden when no password is configured.

### The root layout

`app/layout.tsx` sets the title template ("Notes · HIVEMIND"), `robots: noindex`, Apple web-app flags, `viewportFit: cover`
(edge to edge, safe-area insets handled in CSS) and a dark `themeColor` `#0d1117`. Fonts are Geist and Geist Mono. `<html lang>`
is fixed to `en`.

Because `MobileNav`, `OfflineStatusPill`, `ServiceWorker`, the voice dock and the floating pet live in the root layout, they
appear on the home page too. Each hides itself on **public pages** using `isPublicPage()` in `lib/public-paths.ts`
(`/unlock`, `/call/`, `/play/`, `/theatre/`): a friend never sees owner-only widgets and the service worker is not registered
there.

### Sidebar and tab bar

- `components/sidebar.tsx` exports `NAV`, the single list of 28 pages (label, URL, icon). The sidebar, the palette and the phone
  title bar all read it. Active page: `aria-current="page"`; "/" matches only exactly, others by prefix.
- Your own built apps (from `useMyApps()` in `components/apps/nav-apps.tsx`) are added under a divider: at most 8, only ready
  apps (not "failed", not named "New app"). One shared fetch of `/api/apps` serves every menu and refreshes when the brain
  changes.
- The sidebar is hidden under 768 px (`hidden md:flex`); the title bar is hidden at 768 px and up.
- `components/mobile-nav.tsx` keeps its own copy of the page list (`TABS` of 4, `MORE` of 24) because tab bar items are not in
  `NAV`. It sets `html.has-tabbar` so `--tabbar-h` (3.5 rem plus the home-indicator inset) reserves space; the main area adds
  `--music-h` for the music mini player.
- The "More" sheet is a dialog: `role="dialog" aria-modal`, focus moves to the first link, Esc closes, focus returns to the
  More button, and it closes after you navigate.

### Home dashboard (`app/(bridge)/page.tsx`, 1098 lines)

Calls `GET /api/brain` and `GET /api/galaxy` on load. Layout: top bar, then three columns on large screens (left 292 px,
centre galaxy, right 380 px console); on a phone the stage is on top, then four tabs (**Console, Panels, Profile, Activity**).

| Region | What it shows |
|---|---|
| Boot log | A short "HIVEMIND OS // cold start" animation, once per browser session (`sessionStorage` key `hivemind-booted`); skipped under reduced motion (`components/bridge/boot.tsx`). |
| Top bar | Logo, 9 main links + "More", a status word (STANDING BY, SCANNING LATTICE, LIVE · LISTENING ...), telemetry, a clock, a sound on/off toggle. |
| Galaxy (centre) | 3D map of your notes, memories, documents and projects (`components/galaxy/*`, loaded lazily with `next/dynamic`, ssr off). It starts when the browser is idle (2.5 s timeout), or waits for a tap when Data Saver is on. Project chips focus a constellation; **ORGANIZE** files unfiled knowledge into projects (`POST /api/brain`). |
| Left column | `HomePanels` (pinned weather, routines, answered calls, built apps; "Edit" to pin / reorder), the Operator card (profile and counts), `AgendaPanel`, `HabitsPanel`, composition meters, focus areas, and the "Autonomous log" with a refresh-understanding button and per-entry undo. |
| Right column (console) | Chat with HIVEMIND: streamed answers, sources, the agents and tools used, action buttons, job cards, a live-voice button, "speak answers" toggle, and `ActionChips` (the three most urgent Autopilot suggestions as one-tap buttons). |

Chat sends `POST /api/hivemind` as a stream (`streamHivemind` in `lib/client-api.ts`). Details are in `docs/02-brain-and-ai.md`;
live voice in `docs/03-voice-and-wake-word.md`.

URL parameters the home page understands:

| URL | Effect |
|---|---|
| `/?project=<id>` | Focus that project in the galaxy |
| `/?brief=1` | Runs the fixed "Give me today's brief ..." request (the home-screen shortcut) |
| `/?ask=<text>` | Runs the text **only if** `sessionStorage["hivemind-ask"]` equals it (set by HIVEMIND's own "Do it" button in this tab); otherwise it only fills the box. This stops a crafted link from acting for you. |

`components/home/action-chips.tsx` reads `GET /api/autopilot`; any suggestion whose request "could change or delete something"
(`unlocksAction` in `lib/agents/intent.ts`) is shown as a link to Autopilot, never a one-tap button. `components/home/panels.tsx`
reads and writes `/api/panels`.

### Command palette (`components/command-palette.tsx`)

- Mounted only in `app/(app)/layout.tsx`. It opens on Ctrl/Cmd K, on `/` outside text fields, or on the window event
  `hivemind:palette` (`PALETTE_EVENT`, fired by the sidebar search button and the phone title bar search icon).
- On open it fetches `GET /api/projects` and `GET /api/habits` (each time it opens).
- It builds four local groups with `score()` from `lib/fuzzy.ts` (exact 100, prefix 80, word-prefix 60, substring 40,
  in-order letters 10): **Go to** (all 28 pages), **Your apps**, **Projects**, **Habits**. Without text each group is capped
  at 4 (Go to: 40); with text, 5 per group, best match first.
- From 3 typed characters, after 280 ms, it calls `POST /api/search` with `{query, limit: 6}`; results become "From your notes
  and memories" and open `/notes?open=<id>`, `/memories?open=<id>` or `/documents?open=<id>`.
- Accessibility: `role="dialog"`, input `role="combobox"` with `aria-controls` and `aria-activedescendant`, list
  `role="listbox"`, items `role="option"` with `aria-selected`.

### Shared UI (`components/ui.tsx`, `components/core.tsx`, `components/fx.tsx`)

| Piece | Behaviour |
|---|---|
| `Button` | Variants primary / ghost / danger / quiet; sizes sm and md. On touch screens height grows to 36 px (sm) and 44 px (md) via `pointer-coarse:`. |
| `Input`, `Textarea` | Shared field style with a 2 px focus ring. If there is no `aria-label` they use the placeholder as the accessible name. `Select` does not do this. |
| `PageHeader`, `Empty`, `Skeleton`, `ErrorText`, `Badge`, `ProjectSelect`, `RichText` | Page heading with eyebrow, empty and loading states, error box, tag, project picker, and a small safe-markdown renderer (headings, bold, italic, lists, quotes, `[n]` citations; no raw HTML). |
| `Core` (`components/core.tsx`) | The animated HIVEMIND emblem (SVG) with states idle / thinking / answering, an `aria-label` per state; used on the unlock page. |
| `CountUp`, `Decrypt` (`components/fx.tsx`) | Number count-up and text "decrypt" effects. Both skip the animation when the user prefers reduced motion. `fx.tsx` has nothing else; the sky and beat effects are in `components/fx/`. |

### Installing, the service worker and offline

- `app/manifest.ts` is the web app manifest (name, standalone, portrait, `#0d1117`, three icons in `public/icons/`, four
  shortcuts, the share target).
- `components/notifications.tsx` `ServiceWorker` registers `/sw.js?cache=1` in production and plain `/sw.js` in development
  (the dev worker deletes its caches so stale build files are never served). It skips public pages and also calls
  `startOfflineSync()`.
- `public/sw.js` (198 lines) does four jobs:
  1. **Share target:** a POST to `/share-in` is read into the `hivemind-share` cache (title, text, url, up to 5 files) and the
     browser is redirected to `/share`.
  2. **Cache build files:** `/_next/static/*` and `/icons/*` are cache-first (cap 500 entries, drops the oldest 100).
  3. **Pages:** page navigations (not `/api/`, `/unlock`, `/call/`) are network-first; a good copy is stored, redirects are never
     stored, and the stored copy is used when the network fails; otherwise the built-in offline page.
  4. **Push:** shows notifications (vibration, actions) and handles taps. Web-task Approve / Reject and habit Done / Snooze
     work from the notification without opening the app by calling `/api/web-tasks/<id>` and `/api/habits/<id>/check|snooze`;
     any other tap focuses an open HIVEMIND window or opens the target URL.
- `lib/offline.ts` (449 lines): IndexedDB database `hivemind-offline` (stores `cache`, `outbox`, `meta`). GET reads of
  `/api/notes`, `/api/memories*`, `/api/projects` are copied in. While offline, creating / editing / deleting a note or memory
  goes to the outbox with a temporary `local-<uuid>` id, shows at once, and is sent in order when online ("last write wins").
  After sign-in and every 5 minutes at most it "warms" `/api/notes`, `/api/memories`, `/api/memories/explore`, `/api/projects`,
  and asks the worker to keep `/`, `/notes`, `/memories`. **Lock** calls `clearOfflineCache()`: tries to flush the outbox (4 s
  limit), clears the three IndexedDB stores and deletes the `hivemind-pages` and `hivemind-share` caches.
- `components/offline-status.tsx` is the pill described above; it listens to the `hivemind:offline-status` event.
- `components/version-watcher.tsx`: when the app returns to the foreground (and periodically) it asks `GET /api/version`; if
  the build id differs from `NEXT_PUBLIC_BUILD` it reloads the page, but never during live voice, games, calls, theatre, focus
  mode, or while text is typed in a field. Off in development.

### Notifications (`NotificationsCard`)

Flow: `GET /api/push` (are keys configured, public key, devices, scheduler last run) then, if supported and not blocked, check
for an existing subscription. If this browser is subscribed but the server lost it, it quietly re-registers. **Turn on**:
`Notification.requestPermission()`, subscribe with the VAPID public key, `POST /api/push` with the subscription and a device
label ("Android app", "Windows browser" ...), then `POST /api/push/test`. **Turn off**: `DELETE /api/push` then unsubscribe.
Sending notifications is covered in `docs/05-daily-life-habits-reminders-career.md`.

### Language card

`components/language.tsx` reads `GET /api/prefs` and saves with `PUT /api/prefs` `{language: "auto"|"en"|"ta"}` (optimistic
update; reloads on failure). The setting itself is applied by the brain and voice code (`docs/02-brain-and-ai.md`,
`docs/03-voice-and-wake-word.md`).

### Theming

All colours are CSS variables on `:root` in `app/globals.css` (oklch): graphite background, amber `--core` (the AI, primary
buttons), ice `--data` (readouts, links), red `--alert`, green `--ok`; `color-scheme: dark`. Tailwind v4 reads them through
`@theme inline`. There is **no** `prefers-color-scheme`, no `data-theme` and no toggle anywhere in `app`, `components` or `lib`
(grep). Dark/light switching is therefore not a feature; the browser chrome is always dark (`themeColor`, manifest colours).

## 4. API

The shell itself owns only these routes. All others are listed in the index (section 10) and documented in the feature docs.
Every route below is behind the owner gate in `proxy.ts` unless stated.

| Method | Path | Who may call | Purpose | Request | Response |
|---|---|---|---|---|---|
| POST | `/api/unlock` | **open** (no session) | Sign in | JSON `{password}` | `{ok:true}` and sets `sb_owner` (180 days, httpOnly, sameSite lax, secure in production) and `sb_trusted` (1 year) cookies; 401 `{error:"Wrong password"}`; 429 `{error:"Too many wrong attempts. Try again in N min."}` with `Retry-After`. If no `APP_PASSWORD` is set, always `{ok:true}`. |
| DELETE | `/api/unlock` | **open** (no session) | Sign out this browser; `?all=1` ends every session (needs a valid session) | none | 204; 401 for `?all=1` without session |
| GET | `/api/panels` | owner | Pinned home cards and the data they need | none | `{pinned, apps, weather, calls, routines}` |
| PUT | `/api/panels` | owner | Save pins / order | `{pinned: string[]}` (body schema in `lib/panels.ts`, not re-read here) | pins |
| GET / PUT | `/api/prefs` | owner | Read / set language | PUT `{language?: "auto"\|"en"\|"ta"}` | prefs object |
| GET / POST / DELETE | `/api/push` | owner | Notification state and (un)subscribe | see `docs/05-daily-life-habits-reminders-career.md` | see `docs/05-daily-life-habits-reminders-career.md` |
| POST | `/api/push/test` | owner | Send a test notification | none | `{sent: n}` |
| GET | `/api/version` | owner | Current build id for the update watcher | none | `{build}` |
| POST | `/share-in` | **blocked by the gate unless the worker answers first** (see section 11) | Android share target fallback | multipart form | 303 redirect to `/share?error=1` |

Open (no session) paths in `proxy.ts`: `/unlock`, `/api/unlock`, `/manifest.webmanifest`, `/sw.js`, `/api/call/ring`,
`/api/call/screen`, `/api/games/knock`, `/api/peer/verify`, `/api/ice`, `/robots.txt`, plus everything under `/call/`, `/play/`,
`/theatre/`. Static assets under `icons/`, `chess/`, `mascots/nova-`, `theatre/`, `api/cron/` are outside the proxy matcher
(cron routes have their own secret check, see the other docs).

## 5. Data

| Where | Key / name | What |
|---|---|---|
| Cookie | `sb_owner` | Signed session id (`v2.<id>.<sig>`), 180 days |
| Cookie | `sb_trusted` | Marks a browser that has unlocked before; 1 year; survives logout |
| Private store | `auth/sessions` | Hashed session ids, expiry, device label, password fingerprint (max 30 per password) |
| Private store | `unlock-fails/<hash>`, `unlock-fails-all` | Failed-attempt markers for the lockout (IPs are hashed) |
| IndexedDB | `hivemind-offline` (`cache`, `outbox`, `meta`) | Offline copies and queued writes |
| Cache Storage | `hivemind-pages`, `hivemind-static`, `hivemind-share` | Saved pages, build files, the pending Android share |
| sessionStorage | `hivemind-booted` | Boot animation already shown |
| sessionStorage | `hm-warmed-at` | Last offline warm-up time |
| sessionStorage | `hivemind-ask` | Lets `/?ask=` run by itself (set by the in-app "Do it" button) |
| localStorage | `hivemind-speak-all` | "Always speak answers" toggle on home |
| localStorage / state | sound on/off | `isMuted()` / `setMuted()` in `lib/sfx.ts` (storage detail not re-read) |
| Prefs (server) | `language` | `auto`, `en` or `ta` |
| Panels (server) | `pinned` | List such as `weather`, `routines`, `calls`, `app:<id>` |

## 6. Configuration

| Name | Required? | Meaning | Default |
|---|---|---|---|
| `APP_PASSWORD` | yes in production | The one password. Without it a production deploy answers 503 "APP_PASSWORD is not set" and the Lock button is hidden | none |
| `NEXT_PUBLIC_BUILD` | set at build | Build id compared by `VersionWatcher` | empty: watcher off |
| VAPID keys | for notifications | Server-side; the card says "add the VAPID keys" when missing (names are read in `lib/push.ts`, not re-read here) | none |
| cron-job.org job | for closed-app notifications | The card expects `/api/cron/notify` to run about every 5 minutes | none |

## 7. Security and privacy

- **Gate:** `proxy.ts` runs for every page and API call. No valid `sb_owner` cookie means pages redirect to `/unlock` and API
  routes return 401 `{error:"Locked"}`. A production deploy with no password returns 503 instead of opening up.
- **Brute-force guard** (`app/api/unlock/route.ts`): 8 wrong passwords per address per 15 minutes locks that address; 60 across
  all addresses locks everyone except browsers carrying the trusted cookie; each failure waits 0.8 s; the compare is constant
  time. The in-memory burst counter reserves the slot before any `await`, so parallel guesses cannot slip through.
- **Guest pages** (`/call/*`, `/play/*`, `/theatre/*`) are open by design. They load none of the owner widgets (`isPublicPage`).
- **Matcher:** public files are listed by prefix, never by extension, so `/api/x/file.png` cannot bypass the gate (comment in
  `proxy.ts`).
- **`/?ask=` link safety** and the "no one-tap for risky Autopilot suggestions" rule are described in section 3.
- **Home-screen shortcut URLs** only open pages; the brief shortcut runs a fixed sentence.
- **Notifications:** the permission prompt is shown only after a click. Subscriptions are stored on the server with a device label.
- **Offline copies** of notes, memories and projects sit in IndexedDB on the device. Lock clears them.
- **Search engines:** `robots: noindex` in metadata plus `app/robots.ts`.

## 8. Limits and edge cases

| Thing | Value |
|---|---|
| Session length | 180 days; trusted cookie 365 days |
| Unlock lockout | 8 per address, 60 global, window 15 min |
| Own apps in menus | at most 8 |
| Palette | 6 meaning-search hits, minimum 3 characters, 280 ms pause; 5 per group while searching |
| Home Autopilot chips | 3 |
| Android share | 5 files kept by the worker; accepted types in `app/manifest.ts`; `/share` keeps uploads under about 4.2 MB (Vercel's 4.5 MB request cap) |
| Static cache | 500 entries (trims 100) |
| Offline warm-up | at most every 5 min per tab session |
| Focus mode (`/focus`) | mic and screen lock released after 30 min of silence |
| Home galaxy | starts after idle (2.5 s max wait); on Data Saver waits for a tap |
| Home data failure | red "LINK FAILURE" banner only when nothing at all has loaded; a failed refresh keeps old data |
| WebGL missing | `/garden` falls back to the flat picture |
| Reduced motion | global CSS rule shortens all animations to about 0 ms; the boot log, count-up, decrypt and many effects also check the setting directly |

## 9. Tests

| File | Covers |
|---|---|
| `e2e/smoke.spec.ts` | Everything locked without a session (page redirects, API 401, wake model redirect); wrong password refused; unlock, chat reply, lock |
| `e2e/sweep.spec.ts` | Opens 25 listed pages (plus project and app detail pages found at run time) on desktop and phone, looking for console errors, bounce to `/unlock`, and layout problems |
| `tests/fuzzy.test.ts` | The palette's `score()` |
| `tests/no-control-chars.test.ts` | Source files free of stray control characters |
| `e2e/theatre*.spec.ts` | Theatre rooms (see `docs/friends-theatre.md`) |

Not covered by a test I could find: the command palette itself, the sidebar and tab bar, the "More" sheet, the offline queue
and service worker, the notifications card, the language card, the share target, the unlock lockout. (I did not search every
file in `tests/` for these names; only filename matches and the two e2e files were read.)

---

## 10. Page index

"Calls" lists the API routes the page's own code (and the components it mounts, where I checked) uses. Pages marked "owner" sit
behind the password. Detail docs: **02** `docs/02-brain-and-ai.md`, **03** `docs/03-voice-and-wake-word.md`, **04**
`docs/04-autopilot-web-tasks-apps.md`, **05** `docs/05-daily-life-habits-reminders-career.md`, **06**
`docs/06-nova-garden-games-and-stories.md`, **FT** `docs/friends-theatre.md`.

### Owner pages with the sidebar

| URL | Purpose | Calls | Detail |
|---|---|---|---|
| `/` (`app/(bridge)/page.tsx`) | Home dashboard: galaxy, chat console, profile, agenda, habits, pinned cards. No sidebar, no palette | `/api/brain` (GET, POST), `/api/galaxy`, `/api/hivemind` (stream), `/api/panels`, `/api/autopilot`, plus voice, agenda and habits routes via child components | this doc; 02, 03 |
| `/autopilot` | List of what HIVEMIND found on its own runs; mark done or dismiss; never changes things by itself | `/api/autopilot` | 04 |
| `/web` | Web tasks: a cloud browser works for you, asks Approve before irreversible steps, live view for logins | `/api/web-tasks`, `/api/web-tasks/<id>` | 04 |
| `/mission` | "Mission control": 3D crew scene showing each agent's state (Working, Ready, Asleep, Needs you); tour mode; polls every 6 s | `/api/mission` | 04 |
| `/theatre` | Friends Theatre shelf, search by text or voice, "My room" permanent link | `/api/theatre/room` | FT |
| `/map` | Where you are, your devices, places near you and directions (OpenStreetMap) | `/api/location` (other routes via child components, not re-read) | 05 |
| `/apps` | Describe a tool, HIVEMIND builds it as a sandboxed mini-app; list of your apps | `/api/apps`, `/api/apps/<id>` | 04 |
| `/apps/<id>` | Run one built app; pin or unpin it on the home screen | `/api/apps/<id>`, `/api/panels` | 04 |
| `/routines` | Named multi-step routines triggered by a phrase or Run | `/api/routines` | 05 |
| `/brief` | Morning brief: day at a glance plus up to 4 news topics searched every morning | `/api/brief`, `/api/brief/day` | 05 |
| `/dream` | Overnight "dream" log: merged memories, updated facts, undoable changes | `/api/dream` | 02 |
| `/calls` | Calls HIVEMIND answered for you, with summaries; share your call link | `/api/calls` | 03 |
| `/share` | Save a link, text, photo or file into the brain; receives Android shares | `/api/share`, `/api/reminders`; reads the `hivemind-share` cache | 02 |
| `/comic` | Your day as a four-panel comic with your mascot | `/api/comic` | 06 |
| `/games` | Menu of 11 games (cards linking to each) plus your record | none directly (game record child component) | 06 |
| `/games/party` | Game night lobby: one link for up to 5 friends, pick a game | `/api/games/room` | 06 |
| `/games/paattu` | Paattu Quiz: hear a song clip, guess the Tamil film | `/api/games/paattu`, `/api/music/stream` | 06 |
| `/games/chess` | Chess vs bot or a friend with a clock | `/api/games/room` | 06 |
| `/games/cards` | Colour Clash (Uno-style) vs HIVEMIND or a friend | `/api/games/room` | 06 |
| `/games/business` | Indian property trading game | `/api/games/room` | 06 |
| `/games/bingo` | Bingo, up to 6 players | `/api/games/room` | 06 |
| `/games/connect4` | Connect Four | `/api/games/room` | 06 |
| `/games/snakes` | Snakes & Ladders | `/api/games/room` | 06 |
| `/games/ludo` | Ludo vs bots or friends | `/api/games/room` | 06 |
| `/games/dots` | Dots & Boxes | `/api/games/room` | 06 |
| `/games/draw` | Draw & Guess with a friend and HIVEMIND guessing | `/api/games/room` | 06 |
| `/projects` | Workspaces auto-created from your portfolio and saves; evolution view | `/api/projects`, `/api/projects/evolution`, `/api/brain` | 02 |
| `/projects/<id>` | One project and its related knowledge | `/api/projects/<id>` | 02 |
| `/memories` | Browse, add, edit memories; palace and explore views | `/api/memories`, `/api/memories/explore`, `/api/projects` | 02 |
| `/photos` | Add photos; HIVEMIND describes them with place and time; search them | `/api/photos` (and `/api/photos/<id>`) | 06 |
| `/wrapped` | "My Wrapped": a month as story cards (7 s each, tap right or left); voice-controllable | `/api/wrapped` | 06 |
| `/garden` | Nova's garden, 3D island (flat fallback); query flags `fest`, `goodnight`, `season`, `mood`, `visitors` | `/api/pet/garden`, `/api/pet/goodnight`, `/api/diary`, `/api/brief/day` (via child components) | 06 |
| `/career` | "Job match": paste a job description, get a match, tailored resume PDF, cover letter, interview prep | `/api/career`, `/api/career/<id>` | 05 |
| `/journey` | Interactive life timeline "from school uniform to the Zinnov office", built from the portfolio | `/api/journey` | 06 |
| `/habits` | Habits and birthdays: tick off, streaks, reminders | `/api/habits`, `/api/birthdays` | 05 |
| `/notes` | Notes with AI summary, category, tags and embedding on save | `/api/notes`, `/api/notes/<id>`, `/api/projects` | 02 |
| `/documents` | Upload PDF, TXT, MD, DOCX, CSV (up to 4 MB); chunked and embedded | `/api/documents`, `/api/projects` | 02 |
| `/sources` | Import your own data (portfolio and others); re-sync replaces the previous import | `/api/import` | 02 |
| `/search` | Semantic search over notes, memories, documents | `/api/search`, `/api/projects` | 02 |
| `/settings` | AI provider status, language, voice, wake word, voiceprint, location, notifications, sessions, system check, export | `/api/export` (link) plus each card's routes (`/api/prefs`, `/api/push`, ...) | this doc; 03 |

### Owner pages without the sidebar

| URL | Purpose | Calls | Detail |
|---|---|---|---|
| `/focus` | Kitchen mode: screen stays awake (Screen Wake Lock), big orb, hands-free voice; `?talk=1` starts talking; idle 30 min stops mic | none directly (uses the site voice session) | 03 |
| `/unlock` | Password screen (open) | `/api/unlock` | this doc |
| `/share-in` (POST only, route handler) | Android share fallback; normally the service worker answers first | none | this doc |

### Guest pages (no password)

| URL | Purpose | Calls | Detail |
|---|---|---|---|
| `/call/<room>` | Private browser-to-browser voice call between you and an invited person (PeerJS). Host adds `?host=1&name=...`, guest `?from=...` | `/api/call/ring`, `/api/memories` (host side), `/api/ice`, `/api/peer/verify` (via helper libs) | 03 |
| `/play/<room>` | A friend joins a game. `?g=` is `ludo`, `cards`, `chess`, `dots`, `party`; default Draw & Guess. Name kept in `sessionStorage` `hm-play-<room>` | `/api/games/knock` | 06 |
| `/theatre/<room>` | A friend opens a Friends Theatre room; `?m=` names the film; the server loads just that film | none on the page itself | FT |

Totals: 45 `page.tsx` files (1 home, 39 under `(pages)` including 12 under `games/`, plus `/unlock`, `/focus`, `/call/<room>`, `/play/<room>`, `/theatre/<room>`) and one route handler, `app/share-in/route.ts`. Counted with `find app -name page.tsx`.

---

## 11. Checked and notes

**Verified by reading**

- Sign-in flow matches the description: `app/unlock/page.tsx:12-26` posts the password; `app/unlock/page.tsx:35` has `autoFocus` and
  `required`; the e2e smoke test uses the field label "Password" and button "Unlock".
- Sidebar, command palette and phone title bar all read one list: `NAV` in `components/sidebar.tsx:10`, imported at
  `components/command-palette.tsx:6`.
- Mobile sheet is a proper dialog (focus in, Esc, focus back): `components/mobile-nav.tsx:66-80`.
- Reduced motion: global rule at `app/globals.css:574`; direct checks in `components/fx.tsx:5`, `components/bridge/boot.tsx:18`,
  and the home entrance animation (`app/(bridge)/page.tsx`); `motion-safe:` on the ping animations.
- Visible keyboard focus: `app/globals.css:585` (`:focus-visible` outline) and `ring-2` on fields (`components/ui.tsx:35`).
  The faint text colour is tuned to at least 4.5:1 contrast (comment at `app/globals.css:16`; not measured by me).
- Notification permission is requested only from a button click (`components/notifications.tsx:enable`).
- Lock clears offline data and cached pages (`lib/offline.ts:435-448`).
- No light theme exists (grep for `prefers-color-scheme`, `data-theme` returned nothing).

**Findings the owner should know**

1. **Home has no sidebar, no Ctrl K and a shorter menu.** The palette lives only in `app/(app)/layout.tsx`, and home is in
   `app/(bridge)`. On a laptop's home page Ctrl K does nothing and `/` focuses the chat box instead. The home top bar (9 links +
   14 under "More", `app/(bridge)/page.tsx:62-90`) leaves out five pages that the sidebar has: Mission control, Friends theatre,
   Photos, My Wrapped, Nova's garden. From laptop home you can only reach them by voice/chat or by going to another page first.
   (Phone is fine: the tab bar's More sheet lists them.)
2. **Three copies of the page list.** `NAV` (`components/sidebar.tsx`), `TABS` + `MORE` (`components/mobile-nav.tsx`) and
   `NAV` + `NAV_MORE` (home page) are hand-kept separately. They already differ (finding 1). A new page must be added in up to
   three places.
3. **`/share-in` fallback is behind the password gate.** `proxy.ts` does not list `/share-in` as open. When the service worker is
   not running, the POST goes to the server and is redirected to `/unlock`, not to the "share once more" message the route
   (`app/share-in/route.ts`) intends (only matters if the session is also missing; with a session it works as written). The
   comment in the route says the worker normally catches it. Not verified on a device.
4. **Palette focus handling.** The palette overlay focuses its input on open, but I found no code that returns focus to the
   previously focused element on close, and no focus trap (Tab can leave the dialog). Its input is a `role="combobox"` with a bare
   `aria-expanded` (true) and the "Close" backdrop button is `tabIndex={-1}`. The "More" sheet also has no Tab trap.
5. **No skip link, and a fixed `lang="en"`.** Tamil text (language card, answers) is not marked `lang="ta"`, so screen readers
   may mispronounce it. `Select` (`components/ui.tsx`) does not borrow an accessible name the way `Input` and `Textarea` do. These
   are small gaps, not breakage.
6. **No install button and portrait is forced.** The app relies on the browser's own install menu; `manifest.ts` sets
   `orientation: "portrait"`, which locks installed Android use to portrait (games and the theatre in landscape rely on the
   browser, not the installed app; not verified on a device).
7. **Notification reliability depends on an outside scheduler.** The card warns "Scheduler has never run: set up the
   cron-job.org job" if `/api/cron/notify` has not been called in the last 15 minutes. Without that job no closed-app
   notifications arrive (see `docs/05-daily-life-habits-reminders-career.md`).
8. **Counts drift:** the numbers in this page index (45 pages, 11 games, 28 sidebar entries) will go out of date as pages are added.
9. **Missing tests:** no unit or e2e test for the palette, tab bar, offline queue, service worker, notification card or share
   target (see section 9). The page sweep (`e2e/sweep.spec.ts`) does not include `/mission`, `/photos`, `/wrapped`, `/garden`,
   `/games/*` except `paattu` and `draw`, or `/theatre`.
10. **Dead or unusual details:** `components/fx.tsx` has only two small helpers (count-up, decrypt); nothing else in the file affects
    the shell. `app/(app)/page.tsx` is referenced in some mental models but does not exist; the home page lives in `(bridge)`.
    Not found: any other dead code in the files read.

Not verified: real device behaviour (install prompt, share sheet, push delivery, offline page after a cold start), colour
contrast numbers, and the body schema of `PUT /api/panels`.
