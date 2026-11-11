# API reference

All 98 API routes of HIVEMIND, one row each. Checked 2026-11-11 against `app/api/**/route.ts`. Back to [HIVEMIND.md](HIVEMIND.md).

**Access types**

- **owner**: behind the password gate (`proxy.ts`). Without a valid session cookie the call is redirected or refused.
- **open (no password)**: reachable by guests, listed in `OPEN_PATHS` of `proxy.ts`. Each one exposes only its own narrow job
  (ring a call, knock on a game, prove the host, hand out relay logins, sign in).
- **cron secret**: called by a scheduler with `Authorization: Bearer <CRON_SECRET>`. See [known-issues.md](known-issues.md) (A1 to A3).

**Conventions**

- Routes use `:id` for a dynamic segment (the folder is `[id]`).
- Most owner routes go through the shared `handle()` wrapper, which validates input with zod and returns JSON errors.
  `/api/unlock` is the exception.
- The last column links to the document that explains the route; the description is the route's own comment, shortened.
- Friends Theatre has no other API than `/api/theatre/room`; rooms run browser to browser. See [friends-theatre.md](friends-theatre.md).

| Methods | Route | Access | What it does | Documented in |
|---|---|---|---|---|
| `POST` | `/api/agent-tool` | owner | What the owner said this turn (voice transcript): guarded tools are checked against it here too. | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET,PUT,POST` | `/api/apps/:id/data` | owner | The app's saved data (whatever it stored with hive.set). | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET,PATCH,DELETE` | `/api/apps/:id` | owner | One app: its code, and its version history (without the old code). | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET,POST` | `/api/apps` | owner | The owner's apps. | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET,POST,PATCH` | `/api/autopilot` | owner | The Autopilot feed, settings and recent runs. | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `DELETE` | `/api/birthdays/:id` | owner |  | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `POST` | `/api/birthdays/:id/wish` | owner | An AI-written wish (editable) and a WhatsApp link when the person's number is saved. | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,POST` | `/api/birthdays` | owner | Everyone's next birthday/anniversary, soonest first. | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,POST` | `/api/brain` | owner | Everything the HUD needs in one call: understanding, projects, activity, counts. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/brief/day` | owner | "Your day": reminders, habits, birthdays and the news headline, with a short script to read aloud. | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET,POST,PATCH` | `/api/brief` | owner | A day's brief (the latest by default), the days that have one, and the topics. | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `POST` | `/api/call/ring` | open (no password) | Open to the invited guest (no password): rings the owner's devices when the guest joins a call link. Only rooms the owner created in the last 24 h (or their permanent lin | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `POST` | `/api/call/screen` | open (no password) | Open to the caller (no password), like the ring: HIVEMIND answering a call the owner didn't pick up. Only for real call rooms; the screener sees nothing of the owner's da | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,PATCH,DELETE` | `/api/calls` | owner | Calls page: screening settings, the permanent "call me" link, and the calls HIVEMIND answered. | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `POST,GET` | `/api/career/:id/resume` | owner | Create (or re-create) the resume tailored to this job analysis. | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,DELETE` | `/api/career/:id` | owner | Same as memories: kept in the activity log so it can be undone. | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,PUT` | `/api/career/master` | owner | ?format=pdf \| pdf-download \| tex → file; otherwise JSON status. | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,POST` | `/api/career` | owner | Past job analyses (newest first). | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,POST` | `/api/checkin` | owner | Tonight's check-in: done yet?, unfinished reminders, open habits, recent moods. | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,POST` | `/api/comic` | owner | A day's comic (today by default) and the days that have one. | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `GET,DELETE` | `/api/conversations/:id` | owner |  | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/conversations` | owner |  | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/cron/app-build` | cron secret | Builds (or changes) an app in the background, for requests made by voice or chat, whose own call can't wait ~30 s. Auth: "Authorization: Bearer <CRON_SECRET>" (this path  | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET` | `/api/cron/keepalive` | cron secret | Supabase pauses free projects after ~7 days idle. Vercel Cron hits this once a day. Watchdog: the every-few-minutes scheduler (cron-job.org) stopped calling in, so remind | [01-architecture-and-platform](01-architecture-and-platform.md) |
| `GET` | `/api/cron/notify` | cron secret | Called every few minutes by an external scheduler (cron-job.org: Vercel's free plan only runs its own cron once a day). Pushes reminders that just came due, and the morni | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET` | `/api/cron/web-task` | cron secret | Next leg of a web task. Called by the task itself when its 60-second call runs out, and by the scheduler for stalled tasks. Answers at once and drives after the response. | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET,POST` | `/api/diary` | owner | Nova's diary: the newest pages (with their text) and every date that has one. ?before=2026-10-01 pages further back. | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `GET,DELETE` | `/api/documents/:id` | owner |  | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,POST` | `/api/documents` | owner | PDF parsing + embedding can take a while; 60s is the Vercel Hobby ceiling. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,POST,PATCH` | `/api/dream` | owner | A night's dream report (the latest by default), the nights that have one, and the settings. | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET,POST` | `/api/embeddings` | owner | Settings → Embeddings: which model made the vectors, and re-embedding everything. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/export` | owner | "Export Brain": everything except embeddings (those can be regenerated). | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/galaxy` | owner | Everything in the brain as lightweight nodes for the 3D galaxy. | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `POST` | `/api/games/guess` | owner | Draw & Guess: HIVEMIND's guess for a drawing in progress (it plays as the third player). Only the owner's browser calls this; the word is never sent, so it guesses honest | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `POST` | `/api/games/knock` | open (no password) | Open to a friend with the game link (no password), like a call ring: tells the owner someone is waiting to play. Only the owner's real game room can knock, at most every  | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `GET,POST` | `/api/games/paattu` | owner | A new round: ten songs from the theme, with answer options. Also the themes and best scores. | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `GET,PATCH` | `/api/games/room` | owner | The owner's permanent game link. | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `GET,POST` | `/api/games/stats` | owner | The owner's finished games, newest first. | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `POST` | `/api/habits/:id/check` | owner | Tick a habit for today (also used by the notification's "✓ Done" button, which sends no body). | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `DELETE` | `/api/habits/:id` | owner |  | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `POST` | `/api/habits/:id/snooze` | owner |  | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,POST` | `/api/habits` | owner |  | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET` | `/api/health` | owner | Settings → System check (owner only, like every API route). | [01-architecture-and-platform](01-architecture-and-platform.md) |
| `POST` | `/api/hivemind` | owner | How close a saved note or memory must be for a question to go to the Knowledge agent over the web. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/ice` | open (no password) | Relay logins for game night, friend games and calls (see lib/ice.ts). Friends are not signed in, so this path is open. It only hands out short-lived logins for a TURN rel | [01-architecture-and-platform](01-architecture-and-platform.md) |
| `GET,POST` | `/api/import` | owner | Status of imported sources for the Sources page. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/journey` | owner | The owner's career as git-graph commits, built from their portfolio memories. | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `GET` | `/api/kural` | owner | Today's kural (chosen from last night's check-in or chats the first time it's asked for each day). | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `POST` | `/api/live/log` | owner | Saves one live voice exchange (both transcripts) to the chat history. | [03-voice-and-wake-word](03-voice-and-wake-word.md) |
| `POST` | `/api/live/token` | owner | The two doors to everything not loaded this session (see lib/voice/plan.ts). | [03-voice-and-wake-word](03-voice-and-wake-word.md) |
| `GET,POST,DELETE` | `/api/location` | owner | The owner's devices and where each one last was. | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET` | `/api/memories/:id/detail` | owner | One memory with its source, full history timeline, and related memories/notes/projects/skills. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,PUT,DELETE` | `/api/memories/:id` | owner |  | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,POST` | `/api/memories/:id/versions` | owner | Restore: the current content becomes a new version, then the old version is applied. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/memories/explore` | owner | Memory Explorer list: ?q= (meaning + words) &type= &category= &project= &source= &sort= &system=1 | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,POST` | `/api/memories` | owner | A create sent from the offline outbox carries an id of its own: if the first try did reach us and only the reply was lost, the retry gets the same memory back instead of  | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/mission` | owner | What every background agent is doing right now, for Mission Control. | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET` | `/api/music/search` | owner | Songs for the music player: ?q=what to play. A song or artist name is searched as is; a mood or theme ("amma sentiment", "gana") is understood first. &raw=1 skips that (p | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `POST` | `/api/music/stream` | owner | A fresh, playable link for one song (links expire, so the player asks right before playing). | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,PUT,DELETE` | `/api/notes/:id` | owner |  | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,POST` | `/api/notes` | owner | A project is an id: anything else is a mistake in the request, not a database problem. A create sent from the offline outbox carries an id of its own: if the first try di | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,PUT` | `/api/panels` | owner | The home panels: what's pinned, plus the data each pinned card shows. | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `POST` | `/api/peer/proof` | owner | Owner only (behind the password): signs a guest's challenge so the guest knows this is really the owner. | [01-architecture-and-platform](01-architecture-and-platform.md) |
| `POST` | `/api/peer/verify` | open (no password) | Open to guests: checks the host's answer to their challenge. Says only yes or no. | [01-architecture-and-platform](01-architecture-and-platform.md) |
| `GET` | `/api/pet/garden/day` | owner | One day in the garden: what happened on the date a flower was planted (?date=2026-10-15). | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `GET` | `/api/pet/garden` | owner | Nova's garden: everything grown on its island from habits, check-ins, walks, wins and songs. | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `GET` | `/api/pet/goodnight` | owner | "Nova, good night": tomorrow in two lines and a calm song (read-only). | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `GET,PATCH,POST` | `/api/pet` | owner | The pet's state: name, stage, growth, mood and what fed it today. | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
| `GET` | `/api/photos/:id` | owner | A photo (?t=1 for its thumbnail). A photo never changes, so the browser keeps it. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,POST,PATCH,DELETE` | `/api/photos` | owner | Photos, newest first, or the ones matching ?q= ("Ooty trip", "birthday cake", "beach last December"). | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/places` | owner | Map data for the Map page: ?op=where&at=lat,lng · ?op=nearby&what=park&at=… · ?op=route&from=…&to=AGS%20Villivakkam&mode=walk | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,PUT` | `/api/prefs` | owner |  | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,PUT,DELETE` | `/api/projects/:id` | owner | Project with everything filed under it. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/projects/evolution` | owner | Projects in real build order (GitHub), with what each learned and reused, for the Evolution view. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,POST` | `/api/projects` | owner |  | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,POST,DELETE` | `/api/push` | owner | Notification setup: the public key the browser needs, and how many devices are subscribed. | [01-architecture-and-platform](01-architecture-and-platform.md) |
| `POST` | `/api/push/test` | owner |  | [01-architecture-and-platform](01-architecture-and-platform.md) |
| `PATCH,DELETE` | `/api/reminders/:id` | owner | Mark done / pending, or move to a new time ({ when, all_day }). | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `POST` | `/api/reminders/act` | owner | Cancel / complete / reschedule a reminder identified by a phrase (used by voice). | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET` | `/api/reminders/due` | owner | Polled by open HIVEMIND tabs: reminders whose alert time has come (each is returned once). | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,POST` | `/api/reminders` | owner | Agenda: overdue, today, tomorrow and later (?days=7). | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,POST,DELETE` | `/api/routines` | owner |  | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `POST` | `/api/search` | owner |  | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET` | `/api/sessions` | owner | Browsers currently signed in (Settings → Signed-in devices). | [02-brain-and-ai](02-brain-and-ai.md) |
| `POST` | `/api/share` | owner | What was shared to HIVEMIND (Android Share menu, or pasted on the Share page): summarised and filed. | [02-brain-and-ai](02-brain-and-ai.md) |
| `GET,POST` | `/api/theatre/room` | owner | The owner's permanent theatre room code (private: the password gate covers /api/theatre). | [friends-theatre](friends-theatre.md) |
| `GET` | `/api/tools/origin` | owner | The outside origin (URL) of a memory/note/document, for voice "where did that come from". | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET` | `/api/tools/weather` | owner | Live weather + 4-day forecast (Open-Meteo). ?place=Chennai, or ?lat=13.08&lng=80.27 (where the device is). | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `POST` | `/api/tools/web` | owner | Web search with Google grounding. save=true researches in depth and files it as a note. | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `POST` | `/api/tts` | owner | Natural speech for one sentence. A 429 tells the client to fall back to the browser's voice. | [03-voice-and-wake-word](03-voice-and-wake-word.md) |
| `POST,DELETE` | `/api/unlock` | open (no password) | Across all addresses: stops guessing from many rotating IPs. A browser that has unlocked before (trusted-device cookie) isn't held by this one, so strangers can't lock th | [01-architecture-and-platform](01-architecture-and-platform.md) |
| `GET` | `/api/version` | owner | The build the server is running (the app reloads itself when it's newer than its own). | [01-architecture-and-platform](01-architecture-and-platform.md) |
| `GET` | `/api/video/search` | owner | Videos for the video player: ?q=what to watch&n=how many. | [05-daily-life-habits-reminders-career](05-daily-life-habits-reminders-career.md) |
| `GET,POST,PATCH,DELETE` | `/api/voice/mine` | owner | Whether the owner's voice exists and is switched on (never the voice id itself). | [03-voice-and-wake-word](03-voice-and-wake-word.md) |
| `GET,POST,DELETE` | `/api/web-tasks/:id` | owner | The owner's answer: approve / reject a risky step, continue after taking over, cancel, retry. | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET` | `/api/web-tasks/:id/shot` | owner | The task's latest screenshot, or ?step=N for the page after step N (the replay). | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET,POST,DELETE` | `/api/web-tasks` | owner | Web tasks, newest first (the session's live-view link only goes to the owner's own app). | [04-autopilot-web-tasks-apps](04-autopilot-web-tasks-apps.md) |
| `GET` | `/api/wrapped` | owner | A month's Wrapped (?m=2026-10; default: this month so far) and the months to pick from. | [06-nova-garden-games-and-stories](06-nova-garden-games-and-stories.md) |
