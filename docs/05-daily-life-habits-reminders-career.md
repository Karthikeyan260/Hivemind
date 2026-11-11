# Daily life: habits, birthdays, reminders, routines, check-ins, mission, career, map, music, video, kural, calls

This area is everything HIVEMIND does for your ordinary day: it nags you kindly about habits, birthdays and reminders, runs
phrases like "good morning", asks how your day was, shows its background workers as robots, turns a job advert into a
tailored resume, finds places, plays music and video, gives you a Thirukkural each morning, and answers calls you miss.

> This document describes the code as it is (2026-11-10). Everything here was read in the code; where something was not
> checked it says "not verified".

Contents: [1 What it does](#1-what-it-does) | [2 How to use it](#2-how-to-use-it) | [3 How it works](#3-how-it-works) |
[4 API](#4-api) | [5 Data](#5-data) | [6 Configuration](#6-configuration) | [7 Security and privacy](#7-security-and-privacy) |
[8 Limits and edge cases](#8-limits-and-edge-cases) | [9 Tests](#9-tests) | [10 Checked and notes](#10-checked-and-notes)

---

## 1. What it does

- **Habits.** Things you want to do on chosen weekdays at set times ("Exercise, 07:00, every day"). HIVEMIND pushes a
  notification at each time. You tick the habit off in the app, by voice, or with the **Done** button on the notification.
  A **Snooze 30 min** button is on the notification too. Streaks, best streak and a 30-day hit rate are shown.
- **Birthdays and anniversaries.** Alerts a week before, the evening before, and on the morning of the day. On the day the
  notification opens a sheet with an AI-written wish you can edit and send on WhatsApp (if the person's number is in your
  brain).
- **Reminders.** One-off items ("dentist, tomorrow 3 pm"). They are notes tagged `reminder`. A push arrives 15 minutes
  before (9 am for all-day items), and an open tab shows a toast with a chime. There is a home-page agenda
  (overdue / today / tomorrow / this week).
- **Routines.** One phrase runs several steps ("good morning" = weather, schedule, habits, a relaxing song).
- **Night check-in.** At 9 pm a nudge asks "How was your day?". Your mood and a few words become a diary note; habits you
  mention are ticked; unfinished reminders can move to tomorrow.
- **Mission Control** (`/mission`). A 3D "command deck" where each background job is a robot with a mood
  (working, ready, asleep, needs you).
- **Career** (`/career`). Paste a job description; get a fit score, ATS keyword match, strengths, gaps, a cover letter,
  interview questions and a learning plan; then a **tailored resume PDF** made from your master resume.
- **Map and places** (`/map`). Where you are, your devices' last spots, places near you, and directions (OpenStreetMap).
- **Music.** A bottom player that streams full songs from JioSaavn, controlled by voice or chat.
- **Video.** A floating player for YouTube videos, found by search, controlled by voice or chat.
- **Today's Kural.** One Thirukkural couplet each morning, picked from what you said last night, with Tamil and English
  meaning. The verse always comes from a bundled text, never from the AI.
- **Calls** (`/calls`). A permanent "call me" link. If you do not pick up, HIVEMIND answers as your assistant, asks who is
  calling and why, and sends you a one-line summary.

## 2. How to use it

| Want to | Do this |
|---|---|
| Add a habit | `/habits` > "New habit" (name, one time, every day / weekdays / weekends). For several times a day, say "drink water every 2 hours". |
| Tick a habit | Tap it on `/habits`, on the home card, say "I did my exercise", or tap **Done** on the notification. |
| Snooze a habit | Tap **Snooze 30 min** on the notification, or say "snooze exercise". There is no snooze button inside the app. |
| Add a birthday | `/habits` > "Add a birthday or anniversary", or say "Arif's birthday is 12 March". |
| Send a wish | Tap the gift icon on a birthday, or tap the "Today is X's birthday" notification. Edit, then **Send on WhatsApp** or **Copy wish**. |
| Add a reminder | Say or type "remind me to call the bank tomorrow at 3 pm". The `/api/reminders` route exists but no page form was found; the home **agenda** panel only lists, ticks and cancels. |
| Move or cancel a reminder | Say "move the meeting to 4 pm" / "cancel tomorrow's meeting". The agenda has a tick and a cancel button. |
| Make a routine | `/routines` > "New routine" (name, other phrases, one step per line, max 8), or say "when I say gym mode, play workout songs...". |
| Run a routine | Tap **Run** (it sends "Run my X routine" to chat), say "good morning", or "run my gym routine". |
| Night check-in | Tap the 9 pm notification (opens `/?checkin=1`), or tell HIVEMIND "my day was good, I went to the gym". |
| Watch the crew | Open `/mission`. Drag to look around, tap a robot for details, **Tour** visits each robot. |
| Analyse a job | `/career`: paste the description (at least 80 characters), optionally role and company. Or say "search jobs for React developer" and then "check number 2". |
| Get the resume PDF | On an analysis, **Generate tailored resume**, then view / download PDF or download `.tex` for Overleaf. First paste your LaTeX master resume on `/career`. |
| Find a place | `/map`, or ask "parks near me", "where am I", "directions to AGS Villivakkam". |
| Play music / video | Say "play Vibe Venuma", "play Ilaiyaraaja motivational songs", "play Leo trailer video"; also next, previous, pause, volume. |
| Hear the kural | It appears on the morning card; say "today's kural", "a kural about anger", "kural 391". |
| Get called | Copy your call link from `/calls`; set screening to "missed", "always" or "off". |

## 3. How it works

### 3.1 The scheduler: how push notifications start

HIVEMIND runs on Vercel's free plan, whose own cron can run only once a day. So the real clock is **an outside timer
(cron-job.org)** that calls `GET /api/cron/notify` every few minutes (the app's own text says "every 5 minutes":
`components/notifications.tsx:141`). **This job is not defined anywhere in the repo.** The only thing in `vercel.json` is a
daily `/api/cron/keepalive` at 09:00 UTC.

Who triggers what:

| Trigger | Calls | Does |
|---|---|---|
| cron-job.org (you must set it up) | `GET /api/cron/notify` with `Authorization: Bearer <CRON_SECRET>` or `?key=<CRON_SECRET>` | Everything below |
| Vercel cron, daily 09:00 UTC | `GET /api/cron/keepalive` (Bearer only) | Keeps Supabase awake; sends a "scheduler stale" alert if `notify-state.lastRun` is older than 2 hours (`lib/alerts.ts:45`) |
| An open HIVEMIND tab, every 60 s | `GET /api/reminders/due` | Hands out due reminders as in-app toasts |
| Your phone's service worker | `POST /api/habits/<id>/check` or `/snooze` | The notification buttons |

What `/api/cron/notify` does on each run, in order (`app/api/cron/notify/route.ts`):

1. Returns 401 without the secret, and **503 "VAPID keys missing" if push keys are not set** (before doing anything else).
2. **Reminders:** `dueAlerts()` claims every pending reminder whose alert time has arrived and pushes it.
3. **Morning brief** (once a day, local hour from `BRIEF_HOUR` (default 8) to 11): "Good morning" push with birthdays,
   today's plan, weather, Dream line and the Kural. Today's kural is created at this moment (25 s limit).
4. **Birthdays, habits and pet nudges** (`runBirthdayAlerts`, `runHabitAlerts`, `runPetNudges`).
5. **Wrapped** on the 1st of the month (09:00 to 20:59).
6. **Night check-in nudge** 21:00 to 22:59.
7. Dream mode, Nova's diary, the news brief, Autopilot, re-embedding, a daily RLS check, app-build recovery and web-task
   resume. These belong to other areas and are not described here.
8. Writes `notify-state` (with `lastRun`) and returns JSON counts, for example `{ok, reminders, brief, birthdays, habits, ...}`.

**How often it must run.** The code tolerates a gap only as follows, so "every 5 minutes" is the safe setting and "every
15 minutes" is about the limit:

| Alert | Lateness equals | Hard limit if the cron is slow |
|---|---|---|
| Reminder | up to one cron interval after `due - 15 min` | A reminder is only found if its alert time is within the last 6 hours and the next 24 hours (`lib/reminders.ts:216`). Down for 6+ hours = that reminder never pushes. |
| Habit time (e.g. 07:00) | up to one interval | Must run within **20 minutes after** the time or it is skipped for that time (`lib/habits.ts:188`). |
| Habit snooze end | up to one interval | None (fires on the next run). |
| Habit 8 pm nudge | - | Only 20:00 to 21:59. |
| Birthday week/day alerts | - | Only local 08:00 to 11:59. Evening-before alert only 19:00 to 21:59. |
| Check-in nudge | - | Only 21:00 to 22:59. |
| Morning brief | - | Only `BRIEF_HOUR` to 11:59. |

### 3.2 Notifications sent by this area (exact wording)

All are Web Push to every subscribed device (`notify()` in `lib/push.ts`; devices whose subscription expired are dropped).

| When | Title | Body | Opens | Buttons |
|---|---|---|---|---|
| Reminder due (cron) | `⏰ <title>` | `<when>` plus details, joined with ` · ` | `/` | none |
| Habit time | `<emoji> Time for <name lower-case>` | `Tap ✓ Done when it's done` + ` · 🔥 N-day streak` | `/habits` | `✓ Done`, `Snooze 30 min` |
| Habit snooze over | `<emoji> <name>` | `Snooze's over: time for <name>` + streak | `/habits` | same two |
| Habit still open at 8 pm | `🍚 <pet> is hungry` | one habit: `<emoji> <name> innum pending: finish it to feed <pet>...`; several: `N habits pending: ... Saapadu podu!` | `/habits` | Done/Snooze only when exactly one habit |
| Sunday 19:00 to 21:59 | `📊 Your week in habits` | `<emoji> <name> done/scheduled` for each habit, joined with ` · ` | `/habits` | none |
| Birthday, 7 days before (morning) | `📅 <name>'s birthday is in a week` | `<date>(turning N). Time to plan a gift?` | `/habits` | none |
| Birthday, evening before | `🎁 Tomorrow is <name>'s birthday` | `<date>(turning N). Don't forget!` | `/habits` | none |
| Birthday, on the day (morning) | `🎂 Today is <name>'s birthday (turning N)` | `Tap to send a wish on WhatsApp.` | `/habits?wish=<id>` | none |
| Night check-in | `🌙 How was your day?` | `A 30-second check-in: your mood, a few words, and what moves to tomorrow.` | `/?checkin=1` | none |
| Morning | `Good morning ☀️` | birthdays, plan, weather, Dream line, `📜 Kural N: ...` | `/` | none |
| Missed call screened | `📞 <caller> called` (`⚠️ Urgent · ` first if urgent) | the one-line summary | `/calls` | none |
| Guest rings your call link | `📞 <name> is calling` | `Joined your HIVEMIND call. Tap to answer.` (or `HIVEMIND is answering for you. Tap to pick up yourself.` in "always" mode) | `/call/<room>?host=1...` | `Answer`, `Decline`; stays on screen |

"Anniversary" replaces "birthday" in the birthday texts. The Done and Snooze buttons are handled in `public/sw.js:165`
without opening the app; after Done a second notification shows the streak ("your best!" when it equals the best).

### 3.3 Habits

Stored as one JSON list. A habit has `times` (HH:MM list), `days` (0 = Sunday), `log` (list of done dates, last 800),
and bookkeeping (`alerted`, `nudged`, `snoozeUntil`). `stats()` (`lib/habits.ts:41`) gives:

- **streak**: consecutive *scheduled* days done, counting back from today (today only counts once done; rest days are
  skipped, not breaks);
- **best** streak over all history, **rate** over the last 30 days (today counts only once done, so rate cannot pass 100%),
  and a `last30` strip for the grid.

"Every N hours" (`everyHours`) turns into a list of times between `from` (default 09:00) and `to` (default 21:00), minimum
step 30 minutes, at most 24 times, and may cross midnight. Adding a habit with an existing name (case-insensitive) updates
it instead of making a copy. Weekdays are evaluated in `HOME_TZ`.

Concurrency: the cron writes only the fields it changed into a fresh copy at the end, so a **Done** tapped while the
pushes were going out is not overwritten (`lib/habits.ts:219`).

### 3.4 Birthdays

`daysUntil` finds the next occurrence (29 Feb falls on 28 Feb in non-leap years). Each alert stage (`week`, `eve`, `day`)
records the year it was sent, so it fires once a year, and only counts as sent if at least one device got the push. A wish
(`birthdayWish`) is written by Groq, then Mistral, OpenRouter or Gemini ("2-3 sentences, 1-2 emojis, casual Indian
English"), with a fixed fallback sentence if all fail. The phone number is looked up with `findContacts` (a memory or note
that names the person and contains an Indian number); the WhatsApp link is `wa.me/<number>?text=...`.

### 3.5 Reminders

A reminder is an ordinary **note** with tag `reminder` and `metadata.reminder = {due_at, all_day, remind_before_min, status,
alerted_at}`. So it is searchable and can sit in a project.

- **Create** (`createReminder`): the server turns what the model understood (`date` as today / tomorrow / weekday / `in N
  days` / `YYYY-MM-DD`, `time` like `3 pm`, or `in_minutes`) into an exact instant in `HOME_TZ` (`resolveWhen`).
  No time = all day, due 09:00. A past year is never trusted; a month-day already past means next year. A timed reminder
  more than 10 minutes in the past is refused.
- **Due**: alert time = `due_at - remind_before_min` (default 15, 0 for all-day). `dueAlerts()` claims each one with a
  conditional update (`alerted_at IS NULL`), so the cron and an open tab cannot both get it.
- **Not delivered**: if no device took the push, `releaseAlert` hands it back; after 3 tries it stays claimed.
- **Act** (`actOnReminder`): cancel (deletes the note), complete (status done), reschedule. The reminder is found by words
  from its title and/or "today"/"tomorrow", scored over the next 30 days. **Snooze** as such does not exist for
  reminders: "push it by an hour" is a reschedule (`in_minutes`), which also resets `alerted_at`.

### 3.6 Routines

`lib/routines.ts` holds `{name, triggers, steps}` (max 8 steps of 200 characters, max 6 triggers, max 30 routines). A
starter "Good morning" routine is added once. Matching is by exact trigger phrase, or "run/start/do my X routine". Steps are
plain English commands; **nothing runs on the server**: chat (and live voice) receive the steps and carry them out with
their normal tools. The prompt says steps never delete, send, call or approve. `/routines` "Run" sends
`Run my "<name>" routine` to chat (`armAsk` + `/?ask=`).

### 3.7 Night check-in

`checkinContext` collects: is tonight done, unfinished reminders (due and still pending), open habits, last 14 moods.
"Tonight" before 04:00 still belongs to the previous day (`nightDay`). `saveCheckin`:

1. Asks Gemini (model chain) which open habits you **clearly said you did** (text treated as data) and ticks those for
   the night's date.
2. Moves the unfinished reminders you chose to tomorrow at the same time.
3. Creates a note `Diary · <date> <mood emoji>` tagged `diary`, `check-in` (replaces tonight's earlier one).
4. Appends `{date, mood, noteId, habitsDone, moved}` to `checkins/index` (last 400).

The 9 pm nudge is sent once per night only if tonight's check-in is not done (`nudgeDue`).

### 3.8 Mission Control

`/mission` polls `GET /api/mission` every 6 s. `lib/mission-load.ts` gathers facts (each read is wrapped so a failure shows
as quiet, never breaks the page) and `lib/mission.ts` (`buildCrew`, pure) turns them into seven agents:

| Robot | Is | Shows "Needs you" (alert) when | Links to |
|---|---|---|---|
| Clockwork | the cron-job.org scheduler | never ran, or silent over 2 h | `/settings` |
| Scout | Autopilot | last sweep failed | `/autopilot` |
| Rover | cloud-browser web agent | a task needs approval/you, or failed in last 6 h | `/web` |
| Night Owl | Dream mode | (never alerts; asleep unless enabled and 22:00 to 06:59) | `/dream` |
| Scribe | morning brief | topics set and today's brief not here after `BRIEF_HOUR` | `/brief` |
| Bell | reminders | at least one overdue | `/habits` |
| Maker | app builder | an app failed in the last 24 h | `/apps` |

The summary line counts alerts and workers ("2 need you, 1 working", or "All quiet..."). The scene
(`components/mission/*`, three.js) uses the Mixamo "X Bot" model `public/models/xbot.glb` (1.2 MB) re-skinned per agent, and
falls back to a robot built in code if the model does not load. Phones skip shadows and bloom. If WebGL fails the page
shows a failure state (`failed`).

### 3.9 Career

Flow for one job (`lib/career.ts`, `lib/resume/*`):

1. **Evidence.** The job description is searched against your brain (two searches, 12 + 8 hits, similarity at least 0.2),
   plus your resume document (a `documents` row whose filename contains "resume") and `Skills` memories. Saved job
   analyses and the master resume are excluded from evidence (`NOT_CAREER_FILTER`).
2. **Analysis.** A model (order Gemini, NVIDIA, OpenRouter, Mistral, Groq; JSON; temperature 0.25; 5000 tokens) is told to
   use *only* the evidence, never invent employers, dates or metrics. It returns role, company, fit score, verdict,
   keywords, strengths, gaps, tailored summary, best projects, cover letter (under 170 words), interview questions (max
   8) and a learning plan.
3. **ATS score is computed in code**, not by the AI: the share of the AI's `jd_keywords` that literally appear in your real
   text (`atsMatch`).
4. **Saved** as a `memories` row (category Career, importance 7, tag `job`, `metadata.source = "career"`), under an
   auto-created project "Job Search". The job description (first 20,000 characters) and the whole analysis are in `metadata`.
5. **Master resume.** `PUT /api/career/master` takes your LaTeX source (200 to 100,000 characters). `parseLatex` reads your
   own macros (`\section`, `\datedEntry`, `\resumeItem`, `\skill`, `\columnbreak`, multicols) into a structured `Resume`
   (name, headline, contacts, sections of kind text / entries / list / skills / projects, column 1 or 2). It is refused
   unless a name and at least 2 sections are found. Stored as a `memories` row (`source = "resume-master"`) holding
   both the parsed JSON and the original LaTeX; also embedded so answers can use it.
6. **Tailoring** (`tailorResume`, order Gemini, NVIDIA, OpenRouter, 6000 tokens, 60 s). The model gets the master JSON, the
   analysis, and extra evidence for the *missing* keywords only (similarity at least 0.3). Hard checks in code, not trust:
   - the structure (section titles, kinds, entry titles and dates, project names) must be identical to the master, else the
     draft is rejected with 502;
   - a missing keyword may enter a job's/project's bullets only if the evidence is about that same job/project, else that
     block reverts to your original bullets;
   - a missing keyword with no evidence anywhere is stripped from summary sentences, skills and lists, and the headline falls
     back to yours if it contains one;
   - any number not found in the master or the evidence is flagged as a warning;
   - the "What changed" list is a real diff against the master, and "keywords added / left out" are computed from the final
     text, not from the model's claims.
7. **The PDF** (`lib/resume/pdf.tsx`, `@react-pdf/renderer`): US Letter, 0.55 in margins, Times 9.6 pt, blue name and ruled
   section titles, two columns with a 0.28 in gap, mirroring the LaTeX template. `format=pdf` opens inline, `pdf-download`
   downloads, `tex` regenerates LaTeX in your own preamble (for Overleaf). File name:
   `<Name>_Resume_<Company or Role>.pdf`. Responses are `Cache-Control: no-store`.

Live job search (voice/chat only, no page form): `search_jobs` uses JSearch on RapidAPI (`lib/external/jobs.ts`; the file's
comment says the free plan is 200 requests a month); results show as cards (`components/career/job-cards.tsx`);
`check_listed_job` runs the analysis and the resume in one go.

### 3.10 Map, places, location

- The browser asks for its position (`lib/location.ts`, `getFix`, high accuracy, 12 s timeout), the first time with a
  permission prompt. Nothing runs in the background.
- `GET /api/places` answers three operations using free services: **Nominatim** (address, search, nearby) and **OSRM**
  (car at `router.project-osrm.org`, walking at `routing.openstreetmap.de`). Nominatim calls are queued one per 1.1 s,
  cached 10 minutes (300 entries), with the User-Agent `HIVEMIND-personal-assistant/1.0 (private, single user)`.
  Car time is the free-flow time times 1.8 (city traffic); walk time for "nearby" is distance x 1.25 at 4.8 km/h.
- `/map` draws with Leaflet and OpenStreetMap tiles (`tile.openstreetmap.org`) loaded in your browser.
- **Sharing** is opt-in per device (Settings > Location card, key `hivemind-share-location` in localStorage). With it on, the
  open app sends the device's position at most once a minute and refreshes it every 5 minutes while the tab is visible
  (`LocationReporter`, mounted in `app/layout.tsx`). The server keeps **only the last spot per device**, so "where's my
  phone?" works from another device. Turning sharing off deletes that device's entry.

### 3.11 Music

`lib/music.ts` uses JioSaavn's unofficial JSON API (`jiosaavn.com/api.php`). Search runs on the server; **the audio file is
fetched straight from JioSaavn by your browser**.

1. `GET /api/music/search?q=` runs `smartSongs`: a song/artist/film name plays as found; a mood or theme ("amma
   sentiment", "gana", "90s melody") plays a matching JioSaavn editors' playlist (at most 40 songs, shuffled), else songs
   the AI suggests (Gemini 2.5 Flash first) **each checked to exist on JioSaavn**, else the named artist's hits. Songs
   played in the last 4 days go to the back. Tamil is preferred unless another language is named (`MUSIC_LANGUAGE`).
2. Before playing, `POST /api/music/stream` exchanges the song's encrypted media id for a fresh 320 kbps link (links expire
   after hours). It also logs the play (title, artists, image) to the monthly play list used by Wrapped.
3. The player (`components/music/player.tsx`) shows a bar on every page, a queue, lock-screen controls, beat-reactive "music
   lights", and lowers the volume while HIVEMIND speaks.

### 3.12 Video

`lib/video.ts`: with `YOUTUBE_API_KEY` set the official Data API is tried first; otherwise (or if it returns nothing) the
server reads YouTube's own results page and parses its embedded `ytInitialData`. Up to 25 results. Playback is YouTube's
**official embedded player** in your browser (`youtube-nocookie.com`, iframe API); the player remembers its on-screen
position in localStorage.

### 3.13 Today's Kural

`lib/kural.ts` + `lib/data/kural.json` (the 1,330 couplets, 133 chapters, Pope's English verse; a test checks the count).
`todaysKural(date)` (once a day, cached as `kural/<date>`):

1. Reads what you said last night: the check-in diary note, else your user messages to HIVEMIND from 17:00 yesterday.
2. If there is anything, asks the AI to pick a chapter (from parts 1 and 2, kurals 1 to 1080, not one of the last 10
   chapters). With nothing to go on it takes the next unseen kural in order.
3. Asks the AI to pick one kural from that chapter and write a Tamil meaning, an English meaning and one "for you" line.
   The verse text itself is always copied from the bundled file. If the AI fails, the first unseen kural of the chapter is
   used with empty explanations (the English then falls back to Pope's verse).
4. Remembers the chosen numbers (`kural/seen`) and starts over when 1,060 have been seen.

Topic requests ("a kural about anger") use a regular-expression map to chapters and a random kural in it, no AI.
The chat tool tells the model to quote it exactly and never from memory.

### 3.14 Calls

Who creates a call: the chat/voice tool `start_call` (`lib/agents/tools/contacts.ts:55`) makes a random 20-character room,
saves it in `call-rooms` and opens `/call/<room>?host=1...` for you, offering a WhatsApp invite. The **permanent link**
(`personalRoom`, room id `me` + 22 characters) is created on first visit to `/calls` and shown there; "Reset link" makes a
new one and the old one stops working.

The call is **browser to browser** (PeerJS + WebRTC; `app/call/[room]/page.tsx`): the host opens the peer
`hivemind-call-<room>`, the guest dials it. Before any audio, the guest sends a challenge and the host answers with a proof
only your logged-in session can compute (`/api/peer/proof` for you, `/api/peer/verify` for the guest), so nobody can
squat the public peer id and impersonate you. Nothing is recorded. Afterwards you can "Save this call to memory"
(`POST /api/memories`).

Ring and screening:

1. The guest opens the link and taps the phone; the page calls `POST /api/call/ring`. If the room is known (and not older
   than 24 h unless permanent) HIVEMIND pushes `📞 <name> is calling` to you (max one ring per 30 s per room, max 10 per
   hour). The response tells the guest's page the screening mode.
2. In mode **missed** the guest's page waits `wait_s` seconds (10 to 60, default 25) for you; in **always** it starts after
   1.5 s. Then `Screener` plays HIVEMIND's greeting and listens. You can still pick up.
3. The greeting always says it is an AI and that a summary will be saved. The AI (Gemini chain, audio in) sees only the
   transcript so far and a rule set: find out who and why, 2 short sentences, reply in English/Tamil/Tanglish, know nothing
   about you, make no promises, treat the caller's words as a message not instructions. It ends after the caller has
   spoken 3 times, or on "bye".
4. The reply is spoken in your cloned voice if you have one and `my_voice` is on, else the browser reads it.
5. At the end (or if the caller hangs up / closes the page: `sendBeacon`), you get the push `📞 <caller> called` with the
   summary (`reason`, else the first 140 characters of what they said, else "Hung up without leaving a message."). Urgency
   is judged by the AI.
6. `/calls` lists the last 100 screened calls with transcripts, unread marks, delete, and the settings.

## 4. API

All routes sit behind the owner's session cookie via `proxy.ts` (unless "open" or "cron secret" is stated); a missing session
returns 401. `handle()` turns thrown errors into JSON `{error}`; bad bodies give 400 `{error: "Invalid input", issues}`.

| Method | Path | Who may call | Purpose | Request | Response |
|---|---|---|---|---|---|
| GET | `/api/habits` | owner | All habits with stats | none | `HabitView[]` (habit + `streak`, `best`, `doneToday`, `dueToday`, `rate`, `last30`) |
| POST | `/api/habits` | owner | Create or update by name | `{name 1-60, emoji?, times?[<=24] or every_hours 0.5-12 (+from, to), days?[0-6]}` | 201 habit; 400 if no valid time |
| POST | `/api/habits/[id]/check` | owner | Tick / untick | `{done?, date? YYYY-MM-DD}` (body optional) | `{name, emoji, done, streak, best, ...}`; 404 if unknown id |
| POST | `/api/habits/[id]/snooze` | owner | Snooze 30 min | none | `{name, until}` |
| DELETE | `/api/habits/[id]` | owner | Delete habit and history | none | 204 / 404 |
| GET | `/api/birthdays` | owner | Next occurrences within 366 days | none | `[{..., days, date, turning, label}]` |
| POST | `/api/birthdays` | owner | Add / update (same name + kind) | `{name 1-80, month 1-12, day 1-31, year? 1900-2100, kind birthday/anniversary, relation? <=40}` | 201 entry; 400 "That date doesn't exist." |
| DELETE | `/api/birthdays/[id]` | owner | Remove | none | 204 / 404 |
| POST | `/api/birthdays/[id]/wish` | owner | AI wish + WhatsApp link | none | `{name, text, whatsapp, phone}` |
| GET | `/api/reminders` | owner | Agenda | `?days=` (default 7, max 60) | `{now, timezone, overdue, today, tomorrow, later}` |
| POST | `/api/reminders` | owner | Create | `{title 1-200, date?, time?, in_minutes? <=525600, when?, all_day?, details? <=4000, remind_before_min? 0-1440}` | 201 reminder; 400 if past or unreadable |
| PATCH | `/api/reminders/[id]` | owner | Done/pending, or reschedule | `{status?, date?, time?, in_minutes?, when?, all_day?}` | reminder; 404 |
| DELETE | `/api/reminders/[id]` | owner | Cancel (deletes the note) | none | 204 |
| POST | `/api/reminders/act` | owner | Cancel/complete/reschedule by phrase | `{action, which 1-200, date?, time?, in_minutes?}` | result object or `{error}` |
| GET | `/api/reminders/due` | owner | Claim due alerts (toasts) | none | `Reminder[]`, each returned once |
| GET | `/api/routines` | owner | List (seeds starter) | none | `{routines}` |
| POST | `/api/routines` | owner | Create / update | `{id? uuid, name 1-60, triggers[<=6], steps[1-8 x <=200]}` | `{routine}`; 400 (e.g. over 30 routines) |
| DELETE | `/api/routines` | owner | Delete | `?id=<uuid>` | `{deleted: name|null}` |
| GET | `/api/checkin` | owner | Tonight's context | none | `{date, done, unfinished, habitsOpen, moods}` |
| POST | `/api/checkin` | owner | Save check-in | `{mood 1-5, text <=5000, move[<=30 ids]}` | check-in + `movedTitles` (max 60 s) |
| GET | `/api/mission` | owner | Crew state | none | `{crew[7], summary, at}` |
| GET | `/api/career` | owner | Last 50 analyses | none | `[{id, title, created_at, role, company, fit_score, ats_score}]` |
| POST | `/api/career` | owner | Analyse a job | `{jobDescription 80-20000, role? <=120, company? <=120}` | 201 `{id, created_at, analysis, model}` (max 60 s); 422 no profile data; 502 bad model output |
| GET | `/api/career/[id]` | owner | One analysis | none | `{id, created_at, analysis, jobDescription, model}` |
| DELETE | `/api/career/[id]` | owner | Delete (undoable via activity log) | none | 204 |
| POST | `/api/career/[id]/resume` | owner | Tailor resume | none | 201 `{resume, changes, keywords_added, not_added, warnings, created_at}`; 409 no master; 502 |
| GET | `/api/career/[id]/resume` | owner | Tailored JSON or file | `?format=pdf|pdf-download|tex` | JSON/null, or file; 404 if none yet |
| GET | `/api/career/master` | owner | Status or file | `?format=pdf|pdf-download|tex` | `{exists, name, headline, sections, updated_at}` or file |
| PUT | `/api/career/master` | owner | Save master LaTeX | `{latex 200-100000}` | `{exists, name, headline, sections}`; 422 unreadable |
| GET | `/api/location` | owner | Devices and last spots | none | `{devices}` |
| POST | `/api/location` | owner | Report a position | `{id 8-64, name 1-60, lat, lng, accuracy 0-100000}` | `{ok}` |
| DELETE | `/api/location` | owner | Forget a device | `?id=` | 204 |
| GET | `/api/places` | owner | Map data | `?op=where&at=lat,lng` / `?op=nearby&what=&at=&km=` / `?op=route&from=&to=&mode=walk|car&name=` | address / `{what, places}` / route + `navigate` link; 400, 404 |
| GET | `/api/kural` | owner | Today's kural | none | kural + `speech` (max 60 s) |
| GET | `/api/music/search` | owner | Find songs | `?q= (<=120)`, `&raw=1`, `&n=` | `{songs, how, label?}` |
| POST | `/api/music/stream` | owner | Fresh playable link | `{media 8-400, title?, artists?, image?}` | `{url}` |
| GET | `/api/video/search` | owner | Find videos | `?q= (<=120)`, `&n=` (max 25) | `{videos}` |
| GET | `/api/calls` | owner | Calls page data | none | `{settings, items, link}` |
| PATCH | `/api/calls` | owner | Change settings, mark read, reset link | `{settings?{mode, wait_s 10-60, my_voice}, read?[uuid], read_all?, reset_link?}` | `{ok}` |
| DELETE | `/api/calls` | owner | Delete one or all screened calls | `?id=<uuid>` (none = all) | `{ok}` |
| POST | `/api/call/ring` | **open** (room must exist) | Guest rings your phone | `{room 8-40 alnum, name? <=40}` | `{rang, screen: {mode, wait_s}|null}` |
| POST | `/api/call/screen` | **open** (room must exist) | Screening: `start`, `turn` (audio base64 <=1.2 MB), `end` | discriminated by `op`; `id` is a uuid | start: `{id, text, audio, mime}`; turn: `{text, done, heard, audio, mime}`; 404 / 409 / 429 |
| GET | `/api/cron/notify` | **cron secret** | The scheduler tick (section 3.1) | `Authorization: Bearer` or `?key=` | `{ok, reminders, brief, birthdays, habits, ...}`; 401; 503 |

Pages: `/habits`, `/routines`, `/mission`, `/career`, `/map`, `/calls` (all in `app/(app)/(pages)/`, owner only), and
`/call/<room>` (`app/call/[room]/page.tsx`, **open to anyone**; it only shows the call screen).

Public routes are listed in `proxy.ts:8`: `/api/call/ring`, `/api/call/screen`, `/api/peer/verify` and the `/call/` pages. The
`/api/cron/*` routes are outside the session gate entirely (the matcher excludes them) and rely only on the secret.

## 5. Data

### Private store (Supabase Storage bucket `hivemind-private`, one JSON file per key)

| Key | Holds | Written by |
|---|---|---|
| `habits` | list of habits (times, days, log, alerted, nudged, snoozeUntil) | `lib/habits.ts` |
| `habits-state` | `{weekly: date}` last Sunday summary | `runHabitAlerts` |
| `birthdays` | list (name, month, day, year?, kind, relation?, `sent` per stage) | `lib/birthdays.ts` |
| `routines` | `{items[], seeded}` (max 30) | `lib/routines.ts` |
| `checkins/index` | last 400 check-ins | `lib/checkin.ts` |
| `kural/<date>`, `kural/seen` | the day's kural; numbers already shown | `lib/kural.ts` |
| `device-locations` | map device id to its last `{lat, lng, accuracy, at, name}` | `lib/device-location.ts` |
| `call-rooms` | rooms (24 h, last 50) plus the one permanent room | `lib/call-rooms.ts` |
| `call-screen-settings` | `{mode, wait_s, my_voice}` (defaults missed / 25 / true) | `lib/call-screen.ts` |
| `call-screens` | last 100 screened calls with transcript | `lib/call-screen.ts` |
| `ratelimit/ring-<room>`, `ratelimit/screen-<room>`, `ratelimit/screen-day-<room>` | one empty marker file per request | `addMarker` |
| `plays/<YYYY-MM>` | songs played (last 3000 a month) | `lib/plays.ts` |
| `notify-state` | last cron run and once-a-day marks | `/api/cron/notify` |
| `push-subscriptions` | device push endpoints (last 10) | `lib/push.ts` |

### Database

| Table | Used for |
|---|---|
| `notes` | Reminders (tag `reminder`, `metadata.reminder`); check-in diary notes (tags `diary`, `check-in`) |
| `memories` | Job analyses (`metadata.source = "career"`, includes the job description, analysis and later `tailored_resume`); master resume (`source = "resume-master"` with parsed JSON and LaTeX); saved voice-call notes |
| `projects` | Auto-created "Job Search" |
| `documents`, `document_chunks` | Read: a document named "resume" gives the resume text as evidence |
| `messages` | Read: your messages from last evening for the kural |

No SQL or migration is specific to this area (everything uses existing tables or the private store).

### Browser storage

| Key | Where | Meaning |
|---|---|---|
| `hivemind-share-location` | localStorage | "on" when this device shares its position |
| `hivemind-device-id` | localStorage | random id for this device |
| `hivemind-brief-date` | localStorage | the day the morning card was shown |
| `hivemind-checkin-skip` | localStorage | "skip tonight" for the check-in card |
| `PLACE_KEY` (video player) | localStorage | where the floating video window sits |

## 6. Configuration

| Variable | Required? | Meaning | Default |
|---|---|---|---|
| `CRON_SECRET` | Yes, for any push | Secret for `/api/cron/notify` and `/api/cron/keepalive` | none (401 if unset) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Yes, for any push | Web Push keys. Without them the whole notify cron returns 503 | none |
| `VAPID_SUBJECT` | No | Contact for the push service | `mailto:owner@hivemind.local` |
| `HOME_TZ` | No | Time zone for "today", habit days, reminder times | `Asia/Kolkata` |
| `BRIEF_HOUR` | No | First hour for the morning brief | `8` |
| `HOME_CITY` | No | City for the brief's weather | `Chennai` |
| `APP_URL` | No | Public origin for the call link on `/calls` | the request's origin |
| `MUSIC_LANGUAGE` | No | Preferred song language | `tamil` |
| `YOUTUBE_API_KEY` | No | Official YouTube search first; else the results page is read | none |
| `RAPIDAPI_KEY` (or `RAPIDAPI_SECRET`) | For job search | JSearch live jobs | none |
| `GEMINI_TTS_MODEL`, `GEMINI_TTS_VOICE` | No | Voice for the call screener (when no cloned voice) | `gemini-3.8-flash-tts`, `Charon` |

`.env.example` lists `CRON_SECRET` and `HOME_CITY` but none of the other variables in this table (searched for each name).
AI keys (Gemini, Groq, Mistral, OpenRouter, NVIDIA) are covered by other areas.

Settings in the app: call screening mode / wait / "my voice" (`/calls`), location sharing (Settings > Location card).
The cron-job.org job itself is a setting **outside** the repo: URL `https://<your-app>/api/cron/notify`, header
`Authorization: Bearer <CRON_SECRET>`, every 5 minutes.

## 7. Security and privacy

- Everything except the open routes is behind the owner session (`proxy.ts`). Habits, birthdays, reminders, career data and
  locations are never reachable without it.
- **Open routes** are the call pair and the peer verify. Their guards: the room id must exist in `call-rooms` (24 h, or the
  permanent room); ids are random (20 hex characters, or `me` + 22). Room, id and name inputs are validated by zod;
  the caller's name is stripped to letters, digits, space, `.`, `'`, `-` (40 characters).
- **Rate limits:** ring 1 per 30 s and 10 per hour per room; screening 15 per minute and 150 per day per room (so the public
  permanent link cannot burn the AI/voice quota); at most 3 screened calls a day per ordinary room, 20 for the permanent one.
- **What the screener can see:** nothing of yours. No tools, no profile, no memory; its prompt forbids guessing about you;
  caller speech is wrapped as data. The caller's words reach you only as a stored transcript and a summary. The caller is
  told it is an AI and that a summary is kept.
- **Host check:** only your logged-in browser can prove it hosts a call; a guest refuses to connect otherwise.
- **Cron:** compared with `safeEqual`. `?key=` puts the secret in the URL (it can appear in the scheduler's or server's logs);
  the Bearer header avoids that.
- **Location:** only the last position per device, only after you turn sharing on, deleted when you turn it off. While
  sharing is on and the app is open it is sent every 5 minutes. The server uses it only for map answers. When you ask about
  places, or any chat message within 10 minutes of a fix (`lastFix`), the position is sent with the message to `/api/hivemind`
  (`lib/client-api.ts:236`), so it can reach the AI provider as part of that request. Address lookups go to
  `nominatim.openstreetmap.org` with the coordinates; routes go to the OSRM servers.
- **What leaves the server:** job descriptions, resume text and evidence go to the AI providers during analysis and
  tailoring; birthday names go to the AI for a wish; check-in text goes to Gemini; last evening's words go to the AI for the
  kural; song and video queries go to JioSaavn / YouTube; the caller's audio goes to Gemini and the greeting text to the TTS.
- **Resume honesty is enforced in code** (3.9 step 6), not only by prompt.
- Reminders and diary notes are normal notes, so they are searchable and visible to the brain's other features.

## 8. Limits and edge cases

| Thing | Limit / behaviour |
|---|---|
| Habit name / times / emoji | 60 chars / 24 times / 8 chars; same name updates the existing habit; history kept to 800 days |
| Habit time catch-up | 20 minutes after the time |
| Habit snooze | fixed 30 minutes (voice can pass `minutes`) |
| Streak walk | at most 400 days back |
| Birthday alert windows | 08:00-11:59 (week, day), 19:00-21:59 (eve); once a year each |
| Reminder alert window | alert time between 6 h ago and 24 h ahead; `remind_before_min` max 1440 |
| Reminder 3-try release | after 3 failed deliveries it stays "alerted" |
| Reminder search for "which" | next 30 days, words over 2 letters, any script (Tamil safe) |
| Routines | 30 routines, 8 steps, 200 chars a step, 6 triggers |
| Check-in | text 5000 chars; before 04:00 counts as the previous day; one diary note per night |
| Job analysis | description 80-20,000 chars; model gets 12,000; request 60 s |
| Master resume | 200-100,000 chars of LaTeX |
| Nominatim | 1 request per 1.1 s, 10-minute cache, 12 s timeout; OSRM 15 s timeout |
| `places` radius `km` | read as a number with no upper cap (`app/api/places/route.ts:27`) |
| Music search | query 120 chars, up to 50 results; stream fetch 12 s; redirect probe 2.5 s |
| Video search | up to 25 results, 12 s timeout |
| Screener audio | about 25 s per turn (1.2 MB base64); 3 caller turns per call |
| Call rooms | 24 h life (not permanent), keeps the last 50 |
| Screened-call log | last 100 |

Failure behaviour worth knowing: if the AI cannot write a birthday wish a plain fixed wish is used; if TTS is out of quota
the caller's browser reads the screener's lines; if the screener AI fails the caller hears "Sorry, the line isn't clear. I'll
tell <you> you called." and you still get a push; if the kural AI fails the verse is still shown; a failing mission source
shows as quiet.

## 9. Tests

Unit tests in `tests/` (Vitest):

| File | Covers |
|---|---|
| `reminders.test.ts` | `resolveWhen` (time zone, tomorrow, weekdays, noon, in N days, past years), `addDays` |
| `habit-date.test.ts`, `habit-rate.test.ts`, `habit-streak-oracle.test.ts`, `habit-every-hours.test.ts` | stats for a given day, 30-day rate cap, streak vs a brute-force count, "every N hours" |
| `habit-plants.test.ts` | the garden plants driven by habits (other area) |
| `birthday-input.test.ts`, `birthday-alerts-race.test.ts` | date validation; alert marks not overwriting concurrent edits |
| `checkin.test.ts` | the 9 pm nudge rule |
| `routines.test.ts`, `routine-match.test.ts`, `routine-steps.test.ts` | trigger and name matching, step cleaning |
| `mission.test.ts` | `buildCrew`, `ago` |
| `kural.test.ts` | the 1,330 verses and topic picks |
| `music-retry.test.ts` | music retries, artist spelling, mood-word titles, recent-months window |
| `not-career-filter.test.ts` | memories without a source are not dropped by the career filter |
| `resume-model.test.ts` | LaTeX to model to LaTeX round trip |
| `contacts-find.test.ts` | finding a number in memories |
| `call-screen-race.test.ts` | nothing lost while the screener AI is thinking |
| `push-notify.test.ts` | `notify` delivery and dropping dead subscriptions |

Manual checklist: `docs/manual-test.md` lines 19, 41, 44, 45 (reminder arrives, habit nudge, call, screening).

**Not covered** (no test found): `runHabitAlerts` (alert times, snooze, 8 pm nudge, weekly summary), `/api/cron/notify`
as a whole, `dueAlerts` / `releaseAlert`, `tailorResume` guardrails, `analyzeJob` / ATS matching, `saveCheckin`, the
Kural AI path, the places/Nominatim/OSRM code, `smartSongs` network paths, the video scraper, the ring route and its rate
limits, and all API routes of this area. The only e2e file that mentions this area (`e2e/theatre-safety-voice.spec.ts`)
matched one of my search terms; it is a theatre test and was not read in detail (not verified).

## 10. Checked and notes

Verified by reading (file:line):

- Notification texts, windows and buttons in section 3.2 match `lib/habits.ts:156-245`, `lib/birthdays.ts:114-150`,
  `app/api/cron/notify/route.ts:46-99`, `app/api/call/ring/route.ts:32-42` and `lib/call-screen.ts:195-198`.
- Streaks skip rest days and only count today once done (`lib/habits.ts:41-63`); the rate cannot exceed 100% (`:59-61`).
- Reminders fire once across cron and open tab thanks to the conditional claim (`lib/reminders.ts:221-233`).
- Habit notification buttons work without opening the app (`public/sw.js:165-180`), and the route accepts no body
  (`app/api/habits/[id]/check/route.ts:10`).
- Resume tailoring really rejects restructured drafts and reverts unsupported keywords (`lib/resume/tailor.ts:73-85, 110-175`).
- The kural verse is read from the bundled file, never generated (`lib/kural.ts:34-41, 153-160`).
- The call peer-id squatting defence exists on both sides (`app/call/[room]/page.tsx:127-135, 188-205`, `app/api/peer/verify/route.ts`).

Findings and risks:

1. **The scheduler is not in the repo, and the README does not explain it.** Four in-app messages say "set up the job on
   cron-job.org (see README)" (`lib/health.ts:27`, `app/api/cron/keepalive/route.ts:24`), but the README only mentions
   the daily keepalive (`README.md:70`). Nothing says the URL, header or interval. If the job is missing or stops, **no push of
   any kind** is sent from this area (reminders, habits, birthdays, check-in nudge, brief); the keepalive watchdog only
   notices after 2 hours.
2. **Missing VAPID keys stop the whole cron**, not just pushes: it returns 503 before Dream, diary, Autopilot, web-task
   resume and `lastRun` (`route.ts:42`). Mission Control would then show Clockwork as silent.
3. **An open tab can take a reminder away from your phone.** `/api/reminders/due` and the cron share one claim; whichever
   asks first wins and the loser gets nothing (`lib/reminders.ts:213-235`). With HIVEMIND open on a laptop, the toast
   appears there but the phone may never get the push. The 3-retry release only happens for the cron path.
4. **A reminder is lost if the scheduler is down for more than 6 hours** around its alert time (`lib/reminders.ts:216`); it
   then shows only as overdue (agenda keeps overdue for 7 days).
5. **Possible spurious "Snooze's over" message.** `snoozeUntil` is only cleared by the cron on a day the habit is due and not
   done (`lib/habits.ts:170-181`). A snooze that runs past midnight into a rest day stays set, and on the next scheduled day
   the first cron run sends "Snooze's over" at about 00:00. Rare, not checked against live data.
6. **No way to add a reminder from a page**: only chat/voice and the raw API create one; `/habits` has no reminders despite
   Mission's "Bell" robot linking there (`lib/mission.ts`, `href: "/habits"`). The agenda lives on the home page.
   Also no snooze for reminders (reschedule only) and no in-app snooze button for habits.
7. **`GET /api/places` has no cap on `km`** (`app/api/places/route.ts:27`): a very large radius makes a huge Nominatim search
   box. Owner-only, so low risk. Nominatim's public server also asks for light use; the 1.1 s queue helps.
8. **Whole-day cron work is sequential-risky:** `maxDuration = 60` while the notify run can include the kural (25 s cap),
   weather, pushes with a 10 s timeout each and re-embedding (`route.ts:28, 68, 163`). A slow run can be cut off before
   `notify-state` is written (then marks like `brief` are not saved, so the brief can repeat). Not tested.
9. **Resume PDF is not forced to one page.** The tailoring prompt asks for similar length, but the PDF renderer will simply
   flow onto a second page (`lib/resume/pdf.tsx`, one `<Page>` that wraps). No page-count check exists.
10. **Unofficial services.** Music uses JioSaavn's undocumented API and YouTube search scrapes the results page
    (`lib/music.ts:5`, `lib/video.ts:5`): either can break without notice. The music code needs a `jiosaavn.com`-style
    redirect trick to expose the real file (`lib/music.ts:300-313`).
11. **Public call endpoints cost AI/TTS** for any holder of the permanent link: capped at 150 calls/day and 15/minute, but a
    leaked link can still use that quota every day until you reset it on `/calls`. Each request also reads the room list
    from storage before any limit is applied.
12. **Habit voice tool** `tick_habit` on `/habits` matches by substring of the first habit (`app/(app)/(pages)/habits/page.tsx:57`),
    so "read" can tick "Read 20 min" or any habit whose name contains it; the server-side tools use a better matcher.
13. **Stale comment:** `components/mission/robot.ts` says "no model file", while the scene actually loads
    `public/models/xbot.glb` first and uses the code-built robot only as a fallback (`mission-scene.ts:904`).
14. **Docs vs code:** `lib/mission-load.ts` defaults the Dream hour to 3 when settings cannot be read; the cron uses the saved
    setting. Only affects the fallback text.
15. No dead code was found in the files read.

Things that looked fine: input validation is present on every route (zod, with sensible caps); API routes use exact-id
matching so a URL cannot delete by name; shared state is written with merge-after-send patterns in the cron; the screener is
isolated from your data; check-in habit ticking uses the night's date, not the calendar's.
