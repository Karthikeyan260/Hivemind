# Things HIVEMIND does for you: Autopilot, Web tasks, Apps, Dream mode, Morning brief

This is the "working for you" side of HIVEMIND: things that happen without you typing a request each time. **Autopilot** looks over
your brain a few times a day and tells you what matters. **Web tasks** drive a real browser in the cloud. **Apps** are small tools
HIVEMIND writes from one sentence. **Dream mode** tidies your memories at night. The **Morning brief** (and the **day brief**, the
**weekly view**, **Goodnight**) gather your day and your news. **Panels** pin small live cards to the home screen.

> This document describes the code as it is (2026-11-10). Everything below was read in the code; where something could not be
> verified it says "not verified".

Contents: 1 What it does, 2 How to use it, 3 How it works, 4 API, 5 Data, 6 Configuration, 7 Security and privacy,
8 Limits and edge cases, 9 Tests, 10 Checked and notes.

---

## 1. What it does

- **Autopilot** (`/autopilot`): every few hours (default 4, between 08:00 and 21:00) it reads a snapshot of your schedule, habits,
  birthdays, projects, job analyses and recent memories, may look things up on the web, and writes 0 to 4 short **insights**
  (title, 1-3 sentences, optional link, optional one-tap "Do it" request). Urgent ones are pushed to your phone. It writes only
  its own feed: it never edits or deletes your notes, memories, reminders, habits and so on.
- **Web tasks** (`/web`): you give a goal ("find the price of X on Amazon and Flipkart"). HIVEMIND opens a cloud browser
  (Steel.dev), looks at the page, picks one action at a time, and keeps going. It **stops for your Approve** before anything it
  cannot undo, and hands logins, OTPs and CAPTCHAs to you in a live view. Each step has a screenshot you can replay.
- **Apps** (`/apps`, `/apps/<id>`): describe a tool ("track my petrol expenses"). Gemini writes one self-contained HTML page in
  about 30 seconds. It runs in a sealed box (no network, no access to HIVEMIND) and keeps its data through a small bridge.
  You can change it later in words, undo to an earlier version (8 kept), delete it, pin it to the home screen, and use its
  own voice commands.
- **Dream mode** (`/dream`): once a night it reads your recent memories and what you said to HIVEMIND in the last day, then
  merges duplicate memories, updates facts your own words made stale, and saves preferences you repeated. Every change has **Undo**.
- **Morning brief** (`/brief`): up to 4 topics you follow, researched on the web each morning (3 short dated points each, with
  sources), saved as a note in your brain, announced by a push, and readable or listenable on the page. A topic that looks like
  a job search ("AI jobs in Chennai") uses the real job search.
- **Your day** (top of `/brief`, the morning card, the voice "brief me"): today's reminders (overdue, today, tomorrow), habits
  still to do with streaks, birthdays this week, one old memory resurfaced, the news headline, and on Sundays your week.
  No AI is used, so it is instant.
- **Your week**: a Sunday-only part of the day brief: habit days done of due, night check-ins and average mood, games won, songs
  played, best habit.
- **Goodnight** ("Nova, good night" in the garden): two short lines about tomorrow (reminders, habits) and a calm song from
  the artist you played most this month. No AI.
- **Panels** (home screen): small cards pinned to home: weather, answered calls, routines, and any app HIVEMIND built.
  You choose and order them.
- **Agent-tool endpoint**: lets live voice run any chat tool (including all of the above) on the server.

## 2. How to use it

| You want | Do this |
|---|---|
| See what Autopilot found | Open **Autopilot** (`/autopilot`). Say "what did autopilot find?" |
| Run Autopilot now | **Run now** button, or say "run autopilot" (about 30 to 60 s; a manual run never pushes) |
| Use an insight | **Do it** opens the home chat with that request typed in; **Done** or **Not useful** (dismissed: it will not suggest similar things) |
| Change Autopilot's schedule | The row of controls: Run on its own, every N h, between hours, Notify me when it's urgent |
| Start a web task | `/web`, type a goal (optionally a start URL), **Start**. Or say "go to Zoho careers and list the ML roles" |
| Approve or reject a step | Card on `/web`, the small live window on any page, the notification buttons **Approve / Reject**, or say "approve it" |
| Take over (login, OTP) | **Open live view** then **Take control**, do it yourself, tap **Continue** |
| Stop, retry, delete a task | **Stop**, **Retry**, trash icon, **Clear finished** |
| Replay a task | Click any step, the thumbnails, or **Replay** |
| Build an app | `/apps`, describe it, **Build it**. Or say "HIVEMIND, make me an app to track petrol" |
| Change / undo an app | On the app page: type a change and press **Change**; **Undo...** menu lists earlier versions |
| Pin an app to home | **Pin to home** on the app page; reorder on the home screen with **Edit** under "Pinned" |
| Use an app by voice | Open the app; its commands appear ("3 voice commands"), e.g. "add 500 rupees petrol" |
| Tidy memories now | `/dream`, **Dream now** (about 20 s). Each line has **Undo** |
| Set Dream's hour | `/dream`, "Dream every night at HH:00" (0 to 6) |
| Follow news topics | `/brief`, add up to 4 topics; **Brief me now**; "Make it every morning" checkbox |
| Hear your day | **Hear your day** button (reads the day brief aloud), or say "brief me" |
| Bedtime | Garden page, moon button, or say "Nova, good night" |

Examples of apps to ask for are in `app/(app)/(pages)/apps/page.tsx` (`IDEAS`): petrol expenses, gym log, Tamil flashcards, bill split.

---

## 3. How it works

### 3.1 Who starts what (triggers and safeguards)

HIVEMIND on Vercel's free plan has only one Vercel cron (`vercel.json`: `/api/cron/keepalive` daily at 09:00 UTC). Everything
timed is driven by an **external scheduler** (cron-job.org, per the comment in `app/api/cron/notify/route.ts`) that calls
`/api/cron/notify` every few minutes with `CRON_SECRET`. That one call decides what is due.

| Process | Trigger | Safeguards |
|---|---|---|
| Autopilot run | Scheduler (`autopilotDue`), **Run now** button, voice `run_autopilot` | Read-only tools only; 12 tool calls and 35 s budget; one run at a time (3-minute lock); unsafe "ask" text and bad links removed; pushes capped at 3 a day |
| Web task leg | Owner POST `/api/web-tasks`, voice `web_task`, the task itself (next leg), scheduler (stalled tasks) | Approval gate, data-leak check, no passwords, bot-wall hand-over, 40-step cap, 15-minute browser life, cancel marker |
| App build | Owner POST/PATCH, voice/chat `create_app` / `change_app` (through `/api/cron/app-build`), scheduler (stuck builds) | Sandboxed output, validation of the result, 48 s budget, previous version kept, one automatic retry |
| Dream | Scheduler (once a night), **Dream now** | Only memories shown in full may change; max 5 of each kind; every step logged for Undo |
| Morning brief | Scheduler (once a morning), **Brief me now**, voice `morning_brief` | 4 topics, 45 s total budget, web text treated as information only |
| Day brief / week | Owner opens the app (first open each day after 4 am), `/brief`, voice | Read-only, no AI |
| Goodnight | Owner (garden) | Read-only, no AI |
| Panels | Owner | Pins whitelisted and capped |

### 3.2 Autopilot (`lib/autopilot.ts`)

1. **Due check.** `autopilotDue` is true when Autopilot is enabled, not already running, the local hour (home time zone,
   `HOME_TZ`, default Asia/Kolkata) is within `start_hour <= hour < end_hour`, and the last run was at least `every_hours` ago.
   Defaults: enabled, every 4 h, 08 to 21, push on.
2. **Snapshot (no AI).** `snapshot()` builds text from: now and your profile; the schedule (`agenda(3)`); habits with streaks and
   whether done today; birthdays in the next 14 days; active projects with "days since last activity" (from the newest memory
   or note); up to 5 analysed job applications (fit, gaps); memories saved in the last 7 days (12 titles); the insights it gave
   in the last 14 days (with DISMISSED marked); and whether a job search already ran in the last 20 hours.
3. **Think.** The `core`-style Autopilot agent runs with these tools only: `search_brain`, `recent_memories`, `web_search`,
   `get_weather`, `search_jobs`, `job_analyses`, `find_product`, `upcoming_birthdays`, `habits_status`, `list_reminders`,
   `list_projects`, `project_details`, `get_profile`. It has a tool budget of 12 and a hard 35-second stop. If Gemini fails, it
   thinks again over the snapshot **without tools** using OpenRouter, NVIDIA, Mistral, Groq.
4. **Parse.** The answer must be JSON. A bad item is dropped alone; an answer cut off mid-JSON is salvaged object by object
   (`salvage`). At most 5 insights are kept (the prompt asks for 0 to 4).
5. **Filter.** An insight is dropped if its key was already used, or its title shares 60% or more of its words with a title from
   the last 14 days (`similarToRecent`). A link is kept only if it is `https://...` or an in-app path. The one-tap `ask` is kept
   only if it passes `UNSAFE_ASK` (delete, remove, send, message, call, pay, buy, book, approve, share, lock, reset ... also in
   Tamil) **and** `unlocksAction()` from `lib/agents/intent.ts` is false. The Autopilot page re-checks with the same function.
6. **Save and push.** The feed (max 60 insights, 20 run logs) is written to the private store. On scheduled runs only, priority 2
   or 3 insights are pushed (best two per run, at most 3 a day) when push is on and configured. An activity line
   "Autopilot noticed N things" is logged. Before saving, state is re-read so something you dismissed while it ran stays dismissed
   (`tests/autopilot-race.test.ts`).

"Never changes or deletes anything" is enforced two ways: the tool list contains no write tools, and the one-tap requests that
could change something are blocked. What it does write: its own feed and settings, the activity log, and (when it calls
`search_jobs`) a "last job search" time. The README and the page subtitle make the same promise.

### 3.3 Web tasks (`lib/web-agent/*`)

**Cloud browser.** `steel.ts` creates a Steel.dev session (1280x800, ads blocked, 15 minute life, `persistProfile` so logins you
make in the live view are kept for next time; falls back to a plain session if profiles are not on the plan). HIVEMIND attaches
to it over CDP with `playwright-core` (`page.ts attach`). The browser keeps running between server calls. `debugUrl` is the live
view; it is shown only inside the locked app.

**Queue and legs.** A Vercel call lasts 60 s, so a task is driven in **legs** of about 45 s (`RUN_MS`):

1. `POST /api/web-tasks` saves the task as `queued` and answers at once; `after()` then calls `runTask`.
2. `runTask` takes the "driver seat" (a `runner` token and `heartbeat`; another driver with a heartbeat under 25 s old makes
   it return), creates the session on the first leg, attaches, then loops: read the page, screenshot, ask the AI for ONE action,
   do it.
3. When the 45 s are used it hands over: clears `runner`, saves, and calls `GET /api/cron/web-task?id=` (with `CRON_SECRET`) to start
   the next leg in a fresh function.
4. Voice or chat (`web_task`) creates the task and calls the same cron URL (`kick`); nothing is driven in that request.
5. The scheduler (`resumeStalled`, run on each `/api/cron/notify` call) restarts tasks that are `running` or `queued` with no
   heartbeat for 90 s (and 60 s old), and fails tasks waiting for you longer than the browser's life (15 minutes).

**What the AI sees.** `READ_PAGE` (in `page.ts`) lists up to 160 visible interactive elements as `[12] button "Apply"` plus up to
3,500 characters of page text, and writes the numbers onto the elements (`data-hm`). The prompt gets the goal, your profile text
(first 1,200 characters), brain facts it looked up, the last 12 steps and the page (elements 6,000 and text 2,500 characters).
It answers JSON with `thought`, `risky` and one `action`: goto, click, type, select, scroll, back, wait, **recall** (look up a fact
about you in your brain, 3 hits), **ask_owner**, or **done**. Models tried in order: Gemini, OpenRouter, NVIDIA, Mistral, Groq.

**The approval gate** (`runner.ts`). The action is **held for your Approve** (status `needs_approval`, push with Approve/Reject
buttons, sticky) when any of these is true:

- the AI set `risky: true` (the prompt says to for submit, pay, order, send, post, delete, book);
- a click whose target text matches `RISKY`: submit, apply, send, pay, payment, place order, buy, checkout, confirm, post, publish,
  delete, remove, book, transfer, sign up, register, subscribe, order now, proceed (whatever the AI thinks);
- typing with Enter into a field that is not a search box (could submit a form);
- `leaksOwnerData`: text typed or put in a URL that contains an email, an Indian mobile number, any 4-word run copied from a brain
  fact it looked up, or a query string over 300 characters. The label then says "(sends ... to the site)". The start URL gets the same check.

**Hand-over to you** (`needs_you`, push): a password field (the AI never types passwords, OTPs or card numbers), a bot wall or
"sign in to continue" page (`BLOCKER` regex, also re-checked when the AI says done), the AI choosing `ask_owner`, or reaching
40 steps. You act in the live view and tap **Continue**.

**Answering.** `decideTask` (called by `POST /api/web-tasks/<id>`, the notification buttons in `public/sw.js`, voice
`web_task_answer`): approve (the stored action runs first, exactly as shown), reject (a "don't do this" note is added to the
history), continue, cancel (a separate `.stop` marker file so a mid-step write cannot overwrite the cancel; the browser is released),
retry (new session, state cleared, steps kept).

**Finish.** `done` saves the result and releases the browser; `failed` after three failed steps in a row or an unreadable page; a push
announces done or stopped (not cancelled).

**Screenshots.** After each step a JPEG (quality 45) is saved as the latest (`web-tasks/<id>.jpg`) and as step k
(`web-tasks/<id>/s<k>.jpg`) for the replay. `GET .../shot` serves them (the latest with `no-store`, a step with a day of cache).

**Window on every page.** `components/web/live-window.tsx` (mounted in `app/layout.tsx`) polls `/api/web-tasks` (2.5 s while active,
15 s otherwise), shows the task that most needs you (waiting, then working, then finished within 2 minutes), with Approve /
Reject / Continue. It is off on public pages and hides on `/web` itself. It also tells voice when a task needs you or finishes.

### 3.4 Apps (`lib/apps.ts`, `components/apps/runner.tsx`)

**Writing.** `startApp` saves a record `building` at once (with `pending` = your request). `generate` asks Gemini with the `RULES`
system prompt: one HTML document, all CSS and JS inline, line 1 an `<!-- app: {...} -->` comment with name, emoji, description;
**no external resources or network**; store everything with `hive.get / set / remove / keys`; register 2 to 5 voice actions with
`hive.action(name, description, handler)`; use the host's CSS variables; Indian formats; no `alert/confirm/prompt`. Models are tried in
order `GEMINI_APP_MODEL` (default `gemini-3.5-flash-lite`, twice), `gemini-3.5-flash`, `gemini-2.5-flash`, sharing a 48 s budget
(a try needs 8 s left). The result must contain `<!doctype html>` or `<html>`, a closing `</html>`, and a `hive.get` or `hive.set` call, or
it is rejected as incomplete. A change sends the current HTML and asks to keep the same storage keys.

**Versions.** On a change, the old version (number, time, request, HTML) goes to `history` (8 kept). **Undo** (`restoreVersion`)
makes the old HTML the new version and keeps the replaced one in history as "before undo". A failed *change* leaves the app `ready`
as it was; a failed *first build* is `failed` with a "Try again" button.

**Who triggers a build.**

- The Apps page and the app page: `POST /api/apps` and `PATCH /api/apps/<id>` answer 202 and build in `after()`.
- Voice and chat (`create_app`, `change_app` in `lib/agents/tools/apps.ts`): the tool saves the record and `kickBuild` calls
  `GET /api/cron/app-build?id=` with `CRON_SECRET`, so the build runs in its own function. With no `CRON_SECRET`, it builds in the
  background of the current request instead (a warning is logged).
- The scheduler (`recoverStuckBuilds`): apps `building` for over 3 minutes are started once more (if they still have `pending`
  and `attempts < 1`); after that they become `ready` (if they have code) or `failed`.

**The sandbox** (`components/apps/runner.tsx`). The app runs in an `<iframe sandbox="allow-scripts allow-forms">` with **no
`allow-same-origin`**, so it has an opaque origin and cannot read HIVEMIND's cookies, storage, pages or APIs. A Content-Security-Policy
(`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img/media/font: data: and blob: only; connect-src 'none';
form-action 'none'; base-uri 'none'`) is injected as a `<meta>` before the app's own code and is also set on the frame with the
`csp` attribute. The page is loaded with `srcDoc`. The only way out is `window.hive`, a postMessage bridge:

- `get / set / remove / keys`: the **host page** reads the app's data once with `GET /api/apps/<id>/data`, serves reads from memory,
  and writes back with a 500 ms debounce through `PUT /api/apps/<id>/data` (and `sendBeacon` POST on leaving the page).
  Only messages from this frame's own window are accepted.
- `action(name, description, handler)`: registers a **voice action**. The app page turns each into a voice command `app_<name>`;
  when voice calls it, the host posts the input to the frame and waits up to 8 s for the answer.

**Voice and apps.** Voice can create, open, list, change and delete apps from anywhere (tools above; delete needs a spoken confirm
and `askedToDelete`). On an app's page the registered actions and two built-ins (`app_change`, `app_undo`) are added to the voice
action list.

### 3.5 Dream mode (`lib/dream.ts`)

1. **When.** The scheduler starts it once a night when Dream is enabled, the local hour is at or after the chosen hour (0 to 6, default 3)
   and before 07:00, and today's date is not marked done. The date is marked *before* it runs, so it is not started twice.
2. **Reads.** The 200 most recently updated memories (title, type, first 350 characters) and the owner's own messages from the last
   26 hours (up to 80, 300 characters each).
3. **Asks** Gemini (then OpenRouter, Mistral) for JSON with `merges`, `updates`, `learned` (temperature 0.1). Rules: at most 5
   of each, high confidence only, only given ids, web or document text is information not instructions.
4. **Applies**, with these guards:
   - **Shown in full:** a memory longer than 350 characters (after trimming spaces) is never merged into, rewritten or deleted
     (`shownInFull`), because the dream only saw its beginning.
   - **Merge:** the kept memory gets the merged text through `updateMemory` (with a change reason); each duplicate's **full row** is
     written to the activity log first and only then deleted.
   - **Update:** the memory's content is replaced; the previous title and content go in the activity log.
   - **Learned:** a new `preference` memory (tags `dream`, `learned`) is created and logged.
5. **Report.** `dreams/<date>` holds the changes, counts and a note ("Not enough memories", "Everything already looked tidy", or
   "Couldn't think it through tonight"). The morning push adds "Last night I merged 1, learned 2 memories."
6. **Undo.** `undoDreamChange` undoes every logged step of one change, newest first, with `undoActivity`, and marks it undone.
   A failure of the AI raises one push alert a day (`alertFailure`).

### 3.6 Morning brief and day brief

**Brief** (`lib/brief.ts`). `makeBrief` researches each topic two at a time. Each topic gets 30 s; after a 45 s total budget the
rest are skipped with an error line ("Try Refresh"). A normal topic uses `webSearch` (Google grounding) with the prompt "what is NEW in
the last 48 hours; at most 3 one-sentence bullets with the date or source; else write 'Nothing new'". A topic matching
`jobs|openings|vacancies|hiring` first uses `searchJobs` (posted this week, top 5 with apply links); if fewer than 3, it is topped up
from the web. The brief is saved to `briefs/<date>` and, if anything was found, as a **note** "Morning brief - <date>" (tags `brief`,
`news`) so you can ask about it later. A rerun the same day deletes and replaces that day's note.

**Schedule** (`app/api/cron/notify/route.ts`). The news brief runs after the response when it is enabled, has topics, the hour is
`BRIEF_HOUR` (default 8) up to 11:59, it is not already done today, fewer than 3 tries were made, and the last try was over
10 minutes ago. It counts as done only when saved with at least one point. A push "Your morning brief" carries the first headline.
If nothing could be researched, a failure alert is pushed.

A separate **"Good morning" push** (also from the scheduler, same window) lists birthdays, today's reminders, weather, the Dream summary
and the Kural.

**Day brief** (`lib/day-brief.ts`, `GET /api/brief/day`). Reads (all in parallel, errors tolerated): `agenda(2)`, `habitsWithStats`,
`upcomingBirthdays(7)`, today's brief headline, `weekReview` (Sundays only, by the home date), and `resurfacedToday`. It returns the
data plus a spoken script ("Today you have ...", "overdue", "Habits to do ...", birthdays, week, tomorrow, news). Used by:
the `/brief` page, the morning card (`components/reminders/watcher.tsx`, once a day after 4 am, read aloud if the browser already
allows sound), the garden card (`components/garden/tower-card.tsx`) and the voice `morning_brief` tool (which also makes today's news
if it is missing).

**Week** (`lib/week.ts`). Seven days ending today: habit days done and due, check-ins and their average mood, wins, songs played (the
play log of the months involved), and the habit with the most done days. The headline is "A strong week" at 85% or more, "A decent
week" at 50% or more, else "A slower week" (or "A quiet week" / "A week without habits set up").

**Goodnight** (`lib/goodnight.ts`). Line 1 is tomorrow's first two reminders (with times); line 2 is up to two habits due tomorrow;
line 3 is "Good night, <name>. Sleep well". The song search is "<top artist this month> soft melody", or "Ilaiyaraaja night melody".

### 3.7 Panels (`lib/panels.ts`, `components/home/panels.tsx`)

A panel is a "pin" on the home screen. The pin names are `weather`, `calls`, `routines`, or `app:<uuid>`. The defaults are weather,
routines, calls. `GET /api/panels` returns the pins plus the data each pinned card needs (weather for where you are now, the last 3
answered calls and unread count, routine names), and the list of ready apps. App panels run the same sealed `AppRunner` right on the home
page (`app/(bridge)/page.tsx` renders `HomePanels`). **Edit** pins, unpins and reorders (max 8).

### 3.8 The agent-tool endpoint (`app/api/agent-tool/route.ts`)

Live voice runs in the browser, but the tools (search brain, create app, start web task, ...) live on the server. The voice client
(`components/voice/provider.tsx:442`) calls `POST /api/agent-tool` with `{name, args, said, routine, guest, state}`. The route looks the
tool up in `TOOLS`, applies the same guards as chat, and runs it with the **owner's database access** (`db()`).

**Authority.** The route is behind the password gate (`proxy.ts`; only `/api/cron/*` and a short list of paths are open, and
`/api/agent-tool` is not), so only the signed-in owner can call it. It has no tool-level permission beyond that: any tool in `TOOLS` can
run. The guards are:

- **Guest mode** (`guest: true`): only the tools in `GUEST_TOOLS` (read-only plus music/video); `web_search` runs without saving.
- **Owner intent** (`isGuarded` / `intentCheck`): for guarded tools (delete, send, call, approve, change, ... including `delete_app`,
  `change_app`, `web_task_answer`, `web_task_delete`, `autopilot_update`) the caller's `said` text (what the owner said this turn)
  must match that tool's pattern.
- **Routines** (`routine: true`): guarded tools are refused outright.
- Multi-turn state (last job list, a memory awaiting delete confirmation, location) is carried by the caller and size-limited by the schema.

---

## 4. API

All routes below are **owner session** (cookie set by `/unlock`) unless the table says otherwise. The gate is `proxy.ts`; every
route uses `handle()` from `lib/api.ts` (errors become JSON) and the Supabase service client `db()`.

| Method | Path | Who | Purpose | Request | Response |
|---|---|---|---|---|---|
| GET | `/api/autopilot` | owner | Feed, settings, last 10 runs | none | `{settings, items, runs, lastRun, running}` |
| POST | `/api/autopilot` | owner | **Run now** (manual, nothing pushed). 409 if already running | none | `{insights, ms, error?, feed}` |
| PATCH | `/api/autopilot` | owner | Mark an insight, or change settings | `{id: uuid, status: "new"\|"done"\|"dismissed"}` or `{settings: {enabled?, every_hours 1-24?, start_hour 0-23?, end_hour 1-24?, push?}}` | the insight, or `{settings}` (404 if no such insight) |
| GET | `/api/web-tasks` | owner | Tasks newest first, and whether Steel is configured | none | `{configured, tasks}` |
| POST | `/api/web-tasks` | owner | New task, driven after the response. 503 if `STEEL_API_KEY` is missing | `{goal: string 3-1000, start_url?: url}` | the task, 201 |
| DELETE | `/api/web-tasks` | owner | "Clear finished": delete all non-active tasks | none | `{deleted}` |
| GET | `/api/web-tasks/<id>` | owner | One task | none | the task (404) |
| POST | `/api/web-tasks/<id>` | owner | Answer the task | `{decision: "approve"\|"reject"\|"continue"\|"cancel"\|"retry"}` | the task |
| DELETE | `/api/web-tasks/<id>` | owner | Delete (a working task is stopped first) | none | 204 |
| GET | `/api/web-tasks/<id>/shot` | owner | Latest screenshot, or `?step=N` (0-999) | query | `image/jpeg` or 404 |
| GET | `/api/cron/web-task?id=` | **cron secret** | Next leg of a task | header `Authorization: Bearer <CRON_SECRET>`, `id` uuid | 202 `{ok}`; 401, 400 |
| GET | `/api/apps` | owner | List apps (index records) | none | `{apps}` |
| POST | `/api/apps` | owner | Build a new app in the background | `{request: string 5-1500}` | `{id, status}`, 202 |
| GET | `/api/apps/<id>` | owner | One app with its HTML and history (without old HTML) | none | app (404) |
| PATCH | `/api/apps/<id>` | owner | Change the app, or restore a version | `{change: string 3-1500}` or `{restore: int >= 0}` | `{ok, status}` 202, or `{ok, version}` |
| DELETE | `/api/apps/<id>` | owner | Delete app and its data | none | 204 |
| GET | `/api/apps/<id>/data` | owner | The app's saved data | none | JSON object |
| PUT / POST | `/api/apps/<id>/data` | owner | Replace the app's data (POST for `sendBeacon`). 404 unknown app, 413 over 512 KB | `{data: record, keys <= 200 chars}` | `{ok}` |
| GET | `/api/cron/app-build?id=` | **cron secret** | Build or change an app from its `pending` request | header `Authorization: Bearer <CRON_SECRET>`, `id` uuid | 202 `{ok}`, or `{ok, nothing}`; 401, 400 |
| GET | `/api/dream` | owner | A night's report (latest by default), dates, settings | `?date=YYYY-MM-DD` | `{settings, dates, date, dream}` |
| POST | `/api/dream` | owner | **Dream now**, or undo one change | `{now: true}` or `{undo: 0-50, date}` | `{dream}` (404 no such change) |
| PATCH | `/api/dream` | owner | Settings | `{enabled?: bool, hour?: 0-6}` | `{settings}` |
| GET | `/api/brief` | owner | A day's brief (latest by default), dates, topics | `?date=` | `{settings, dates, date, today, brief}` |
| POST | `/api/brief` | owner | Make today's brief now (422 if no topics) | none | `{brief}` |
| PATCH | `/api/brief` | owner | Topics (max 4, 80 chars each) and on/off | `{enabled?, topics?}` | `{settings}` |
| GET | `/api/brief/day` | owner | The day brief | none | `DayBrief` (greeting, overdue, today, tomorrow, habits, birthdays, news, week, memory, speech) |
| GET | `/api/pet/goodnight` | owner | Goodnight lines and song (this route is in the Nova area, but the logic is `lib/goodnight.ts`) | none | `{name, lines, song}` |
| GET | `/api/panels` | owner | Pins and the data for each | none | `{pinned, apps, weather, calls, routines}` |
| PUT | `/api/panels` | owner | Save the pins (unknown names dropped, duplicates removed, max 8) | `{pinned: string[] <= 8}` | `{pinned}` |
| POST | `/api/agent-tool` | owner | Run one chat tool on the server for voice (section 3.8) | `{name, args, said, routine, guest, state}` | `{result, sources, actions, changed, jobs, pending_delete}`; 404 unknown tool |
| GET | `/api/tools/weather` | owner | Weather and 4-day forecast | `?place=` or `?lat=&lng=` | weather JSON |
| POST | `/api/tools/web` | owner | Web search; with `save` also researches in depth and files a note | `{query: 2-500, save?}` | search result, or `+ saved` (201) |
| GET | `/api/tools/origin` | owner | Where a memory, note or document came from | `?type=&id=` | `{origin}` |

Routes with `maxDuration`: 60 s for autopilot, web-tasks, apps, dream, brief, tools/web and both cron routes; 120 s for agent-tool.

---

## 5. Data

All of this lives in the **private store** (`lib/private-store.ts`: JSON files in the private Supabase Storage bucket
`hivemind-private`, no tables), except where a table is named.

| Key / file | Holds |
|---|---|
| `autopilot` | `{items (max 60), runs (max 20), running, lastRun, lastJobSearch, pushes: {date, count}}` |
| `autopilot-settings` | `{enabled, every_hours, start_hour, end_hour, push}` |
| `web-tasks/index` | list of task ids (newest 30) |
| `web-tasks/<id>` | the task: goal, status, steps, session id, live URL, pending action, notes, result, error, shots |
| `web-tasks/<id>.jpg`, `web-tasks/<id>/s<k>.jpg` | latest and per-step screenshots |
| `web-tasks/<id>.stop` | cancel marker |
| `web-agent` | `{profileId}`: the Steel profile that keeps your logins |
| `apps/index` | list of app records (no HTML) |
| `apps/<id>` | the app: html, name, emoji, description, status, version, history (8), pending, building_since, attempts |
| `apps/<id>.data` | the app's own data, key to JSON value (max 512 KB) |
| `dreams/<date>`, `dreams/index`, `dreams/settings` | night reports (index keeps 120 dates); settings `{enabled, hour}` |
| `briefs/<date>`, `briefs/index`, `briefs/settings` | briefs (index keeps 120 dates); settings `{enabled, topics}` |
| `home-panels` | pin list |
| `notify-state` | scheduler memory: `brief`, `dream`, `news`, `newsTry`, ... "done today" marks (shared with other areas) |

Tables touched: `memories` (read by Autopilot and Dream; Dream edits, deletes and creates), `notes` (Autopilot reads project activity;
the brief creates and deletes its own note), `messages` (Dream reads your user messages), `projects`, `activity` (the undo log), plus
whatever habits, reminders, birthdays, check-ins, plays and game results use (read only, via their lib modules).

Browser side: apps keep no localStorage; the `hive` bridge stores in the private store. `hivemind-checkin-skip` and the brief
"already shown today" key (`BRIEF_KEY` in `components/reminders/watcher.tsx`) belong to the day card.

## 6. Configuration

| Name | Required? | Meaning | Default |
|---|---|---|---|
| `STEEL_API_KEY` | for Web tasks | Steel.dev cloud browser key. Without it `/api/web-tasks` POST returns 503 and the page shows a notice | none (**not listed in `.env.example`**) |
| `CRON_SECRET` | yes, for scheduler and background legs | Bearer secret for `/api/cron/*`; also used by `kick` and `kickBuild` | none |
| `APP_URL` | recommended | Public origin used for the next-leg and build calls | request origin |
| `GEMINI_API_KEY` | yes | Writes apps, powers Autopilot, search | none |
| `GEMINI_APP_MODEL` | no | Fast model for app writing | `gemini-3.5-flash-lite` |
| `BRIEF_HOUR` | no | Hour (home time) the "good morning" push and the news brief may start | 8 |
| `HOME_TZ` | no | Time zone for "today", Autopilot hours, Dream hour | `Asia/Kolkata` |
| VAPID keys | for pushes | The scheduler returns 503 without them (so nothing timed runs) | none |
| Autopilot settings | no | Page controls, stored in `autopilot-settings` | enabled, 4 h, 08-21, push on |
| Dream settings | no | `/dream` controls | enabled, hour 3 |
| Brief settings | no | `/brief` topics and checkbox | enabled, no topics |

Hard-coded numbers are in section 8. There are no feature flags for apps or web tasks beyond the keys above.

## 7. Security and privacy

- **Access.** Every page and API in this area needs the owner's session (`proxy.ts`). The two cron routes are excluded from the gate by
  the matcher and instead require `Authorization: Bearer <CRON_SECRET>`, compared with `safeEqual` (constant time). `/api/cron/notify`
  also accepts `?key=<CRON_SECRET>`.
- **What leaves the server.** Autopilot snapshots (profile, schedule, habits, birthdays, memory titles, job gaps) go to the AI
  provider (Gemini first). Dream sends memory text (first 350 characters each) and your last day of messages to Gemini, OpenRouter or
  Mistral. Web tasks send page content (elements and text), the goal, and your profile text (1,200 characters) to the AI providers;
  the cloud browser (Steel) sees every page it visits. Morning brief topics go to Google search grounding.
- **Prompt injection (web text).** Autopilot, the brief, Dream and the web agent all tell the model that web or document text is data, not
  instructions. Hard stops behind that: Autopilot cannot call write tools and its one-tap requests are filtered; the web agent holds risky
  and data-carrying actions for your Approve; Dream only changes memories it saw in full and logs everything; the intent guard in
  `agent-tool` refuses guarded tools unless **your** words this turn asked for them.
- **Secrets.** The agent never types passwords, OTPs or card numbers; it hands those to you in the live view. The live-view URL is
  unauthenticated by design (comment in `steel.ts`) and is only returned to the owner's session.
- **Apps are untrusted code.** Gemini writes them. They run in an iframe with an opaque origin and no network (section 3.4). Data size is
  capped. The app's name, emoji and description are rendered as text.
- **Undo.** Dream changes and app versions can be undone; web actions and Autopilot pushes cannot (they happen outside HIVEMIND).
- **Rate limits.** None of these routes has its own rate limit (the owner is the only caller). Costs are bounded by the budgets in section 8.

## 8. Limits and edge cases

| Thing | Limit |
|---|---|
| Autopilot | 35 s run budget, 12 tool calls, up to 5 insights kept, 60 insights and 20 run logs stored, "running" lock expires after 3 min, 3 pushes a day (best 2 per run, priority 2 or 3, scheduled runs only) |
| Autopilot text | title 120 chars, body 600, link label 60, ask 300 |
| Autopilot fallback | If Gemini fails or times out: OpenRouter / NVIDIA / Mistral / Groq without tools (4000 output tokens) |
| Autopilot errors | Shown as a short sentence ("AI free limit reached ..."); a failed scheduled run raises a once-a-day alert |
| Web task | goal 3-1000 chars; 45 s per leg; 40 steps; 12 steps in the prompt; 160 elements; browser session 15 min; 30 tasks kept; 3 failed steps in a row ends it; 8 s default action timeout; goto 20 s |
| Web task pauses | A pause longer than 15 minutes fails ("browser closed"); retry starts a new browser |
| Web task push | Approve and "needs you" pushes are sticky |
| Apps | request 5-1500 chars; build 48 s; output up to 16,000 tokens; 8 versions kept; data 512 KB, keys 200 chars; 8 s for a voice action; stuck build retried once after 3 min |
| App sandbox | No network, no storage outside `hive`, no popups, no top navigation (sandbox flags) |
| Dream | 200 memories, 80 messages, 26 hours, 350 chars shown, 5 of each change kind, hour 0 to 6, ends at 07:00 |
| Brief | 4 topics (80 chars each), 2 at a time, 30 s each, 45 s total, 3 tries a morning 10 min apart, up to 5 job lines per topic |
| Panels | 8 pins |
| Goodnight | uses this month's play log only |

Failure behaviour in short: a failed first app build shows "Try again"; a failed change keeps the old app; a stalled web task is restarted by the
scheduler; a Dream or brief failure leaves your data unchanged and sends one alert; an unparseable Autopilot answer logs an error run and saves nothing.

## 9. Tests

| File | Covers |
|---|---|
| `tests/autopilot-race.test.ts` | A dismissal made while Autopilot sends pushes stays dismissed; new insight saved and pushed |
| `tests/dream-long-memories.test.ts` | `shownInFull`; merging short duplicates; never touching long memories; mixed merges |
| `tests/web-agent.test.ts` | `leaksOwnerData` with malformed addresses; `safeDecode`; "three failures in a row" |
| `tests/web-task-delete.test.ts` | `web_task_delete` with blank, word and "finished" requests; `open_link` with odd addresses |
| `tests/week-review.test.ts` | `reviewWeek` headlines and wording |
| `tests/empty-lookup.test.ts` | `findApp("")` finds nothing (among other modules) |
| `tests/quick.test.ts` | Only `quickGoodNight` (the spoken "good night" detection), not `lib/goodnight.ts` |
| `e2e/sweep.spec.ts` | Opens `/apps`, `/autopilot`, `/brief`, `/dream`, `/web` and one app page and checks they load |

**Not covered by any test I found:** `runAutopilot` end to end (parsing, filters, `UNSAFE_ASK`, `similarToRecent`, `salvage`),
`autopilotDue`; the web runner loop and the approval gate (`RISKY`, `BLOCKER`, `decideTask`, `resumeStalled`); app generation (`parse`),
`restoreVersion`, `recoverStuckBuilds`, the app data route and size cap, the iframe sandbox; `dream()` updates, learned and undo
(`undoDreamChange`); `lib/brief.ts`; `lib/day-brief.ts`; `lib/goodnight.ts`; `lib/panels.ts`; `/api/agent-tool` guards. (Searched the `tests/` and `e2e/` folders.)

---

## 10. Checked and notes

**Verified by reading**

- Autopilot cannot write: its tool list (`lib/autopilot.ts:177`) contains only read tools, and the run context has no pending-delete or write
  path; the one-tap request filter is `UNSAFE_ASK` plus `unlocksAction` (`:203`, `:320`) and is repeated on the page
  (`app/(app)/(pages)/autopilot/page.tsx` `safeAsk`).
- The schedule is as described: window and interval in `autopilotDue` (`lib/autopilot.ts:87`), called from `app/api/cron/notify/route.ts:153`.
- Web approval gate, data-leak check, password and bot-wall hand-over, cancel marker and stalled restart are all in `lib/web-agent/runner.ts`
  (`:25`, `:38`, `:217`, `:225`, `:437`). Notification Approve / Reject goes through `public/sw.js:148` to the same `POST /api/web-tasks/<id>`.
- Apps are sandboxed without `allow-same-origin` and with a no-network CSP (`components/apps/runner.tsx`), and app data can only be reached
  by the host page through `/api/apps/<id>/data`.
- Dream logs the full deleted row before deleting it, and refuses long memories (`lib/dream.ts:45`, `:99`); covered by a test.
- Brief topic cap of 4 is enforced on the server (`lib/brief.ts:26`, `app/api/brief/route.ts:31`) and in the UI.
- `/api/agent-tool` is behind the password gate (`proxy.ts` matcher only skips `api/cron/`), and guest and routine modes can only restrict.

**Bugs and risks**

1. **Web task cannot continue past 40 steps.** At `lib/web-agent/runner.ts:148` the loop pauses with "tap Continue" whenever
   `task.steps.length >= 40`, but **Continue** only adds a step (`:427`), so the next leg pauses again at once. The same happens after
   **Retry** of a task that already has 40 steps (retry keeps the steps). In practice the 15-minute browser life usually ends a task first,
   but the message promises something the code cannot do.
2. **Web tasks need `CRON_SECRET` to continue.** `kick` (`runner.ts:392`) silently returns when `CRON_SECRET` or the origin is missing. Then a
   task started by voice or chat never starts, and a task from the page stops after its first 45 s leg (the scheduler's `resumeStalled` uses
   the same `kick`). Apps have a fallback for this case; web tasks do not. `STEEL_API_KEY` is also missing from `.env.example`.
3. **`web_task`, `create_app` and `run_autopilot` are not in the owner-intent guard** (`lib/agents/intent.ts`). A web page read during a chat could
   try to start a web task (goal injected). The approval gate and leak check limit the harm, but the task itself would run. Unverified in
   practice.
4. **Intent pattern for `web_task_answer` is very loose** (`intent.ts:27`): words like "no", "yes", "ok", "done" unlock it, and approve and reject use
   the same pattern, so "no" said about something else also unlocks an approve call. The voice prompt tells the model to approve only on a clear
   yes, but the server check does not enforce that.
5. **`RISKY` only looks at a click's visible name** (`describe()` reads text, value, aria-label, title; not an image's `alt`). An icon-only "Pay"
   button without a label would depend on the AI setting `risky`. Not verified on a real site.
6. **Dream rerun overwrites the night's report.** "Dream now" a second time on the same date replaces `dreams/<date>` (`save`, `lib/dream.ts:142`).
   Changes from the first run stay applied and stay in the activity log (Undo from the Activity log still works), but they disappear from the Dream
   page. The scheduler marks the night "done" before running, so a crash or AI failure means no retry until the next night.
7. **Dream sees only the 200 most recently updated memories** (`lib/dream.ts:60`), so duplicates among older ones are never merged.
8. **Autopilot settings are not cross-checked.** `start_hour` and `end_hour` have no rule that start is before end (`SettingsInput`); if start is at or
   after end, `autopilotDue` is never true. The page selects allow it. Dismissed insights older than 14 days are no longer shown to the model
   or compared, so a similar one can reappear after two weeks.
9. **UI-made app changes have no `pending`.** `PATCH /api/apps/<id>` calls `markBuilding` without the request (`app/api/apps/[id]/route.ts:27`), so if that
   build is cut off, `recoverStuckBuilds` cannot retry it (it needs `pending`) and just restores the old app with "That change didn't finish". Voice and
   new-app builds do keep `pending`.
10. **Loose id handling on two routes.** `GET /api/web-tasks/<id>/shot` passes the id to the store without the UUID check that `getTask` uses, and
    `GET /api/apps/<id>/data` does not check the app exists (the store key is `apps/<id>.data.json`). Both are owner-only and the store appends fixed
    suffixes, so the reach is small; not verified further.
11. **Brief subtitle says "3 short lines"**, but job topics return up to 5 lines. Cosmetic.
12. **The "Make it every morning" checkbox** on `/brief` has no error handling if the PATCH fails (`brief/page.tsx`, `void api(...).then(...)`); the checkbox state follows the server only after a reload.

**Dead or odd code**

- `components/day/kural-card.tsx` and `components/day/night-checkin.tsx` are in the folder named in my scope but belong to the Kural and
  night check-in features (documented elsewhere); only `your-day.tsx` is part of the day brief.
- `Autopilot` agent id is `"core"` (`lib/autopilot.ts:155`) but it carries its own instructions and tool list, so nothing is shared with the chat agent.
- `BRIEF_HOUR` is read in `app/api/cron/notify/route.ts` only; the `/brief` page text says "every morning" without the hour.

**Missing tests:** see section 9 (the approval gate, the sandbox and the app build path have none).
