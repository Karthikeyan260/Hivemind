# Voice, wake word and the intent agents

This is how you talk to HIVEMIND: a wake word you teach it, a hands-free live conversation with Gemini, spoken replies, an
optional "speak in my voice" clone, a voiceprint that guards risky actions, and the agents and tools that turn a sentence into
an action. It also covers the voice actions that pages register, so "start the chess game" or "zoom into project X" works.

> This document describes the code as it is (read 2026-11-10). Counts (tools, pages) are a snapshot.

Contents: 1 What it does, 2 How to use it, 3 How it works, 4 API, 5 Data, 6 Configuration, 7 Security and privacy,
8 Limits and edge cases, 9 Tests, 10 Checked and notes.

---

## 1. What it does

- **Wake word.** You teach HIVEMIND your own word (any word, any language; the card suggests "Hey Karthik" or "Vanakkam
  Jarvis"). While the app is open and listening is on, saying it starts a live conversation. It is matched on your device; no
  audio leaves it until the conversation starts.
- **Live voice conversation (hands-free).** One Gemini Live session for the whole site. It keeps going while you move between
  pages. You speak, it answers aloud, you can interrupt (barge in) at any time.
- **Voice can run the app.** The live model has 28 voice-only tools plus all 87 chat-agent tools: open any of 45 pages, read the
  screen, click buttons by label, type into fields, play music and video, set reminders, search the brain, call or message
  (hands off to the phone), and more.
- **Page voice actions.** Pages register their own actions (see [section 2](#page-voice-actions-which-page-exposes-what)).
- **Chat replies read aloud.** On the home console a switch "VOICE: ALWAYS / WHEN SPOKEN TO" makes HIVEMIND speak chat replies
  (Gemini TTS, browser voice as fallback).
- **Read-aloud.** "Hear your day", today's kural and the morning brief share one reader.
- **My voice.** Clone your own voice (Google voice replication) so HIVEMIND speaks in it, in chat and in live voice.
- **Voiceprint.** Optional. HIVEMIND learns your voice so that deleting, sending, calling, approving, ending guest mode and
  saving-after-a-guest only go through when it sounds like you. If unsure, it asks on screen ("Was that you?").
- **Guest mode.** You introduce someone ("this is Harini, my friend"); HIVEMIND talks with them, nothing they say is saved, and
  only read-only tools work. "Come back" ends it with a recap.
- **Language rule.** Only English, Tamil (Tamil script) and Tanglish (Tamil in English letters). Setting: Match me / Tamil / English.
- **Spoken-intent safety.** A tool that deletes, sends, calls, approves or changes only runs if the owner's own words this turn
  asked for that kind of action (a prompt-injection guard).
- **Sound effects.** Tiny synthesized UI sounds (`lib/sfx.ts`), no audio files; muted by a `localStorage` flag.

## 2. How to use it

| Want to | Do this |
|---|---|
| Start / end a live conversation | Tap the mic button (bottom right on every page, or the home console), or press **Space** (outside text fields and buttons). **Esc** ends it. |
| Teach a wake word | Settings, **Wake word** card: type the word, tap **Teach it**, say it 8 times (2.2 s each), then read the sample sentence for 7 s. |
| Use the wake word | Tap the **ear** button next to the mic (listens in this tab only), or tick "Start listening as soon as I open HIVEMIND". Then say your word. |
| Test the wake word | Settings, Wake word, **Test**; it shows "heard it xN" and a match percentage. Slider: strict to eager. |
| Set reply language | Settings, **Language** card; or say "reply in Tamil / English / match me". |
| Clone your voice | Settings, **My voice**: record a 10 to 30 s sample and Google's consent sentence word for word, then **Create my voice**. Toggle "Speak in my voice"; **Hear it** plays a test line. |
| Voiceprint | Settings, **Voiceprint**: read 3 lines (5 s each), pick Strictness (relaxed / normal / strict), **Test**, **Forget**. |
| Guest mode | Say "this is Harini, my friend, talk to her". End: "come back", or tap **Back to me** on the banner. |
| Put the mic to sleep | "Go to sleep", "stop listening", "bye". |
| Lock the app | "Lock HIVEMIND". |

Examples: "open career", "summarise this page", "play a Tamil song", "pause", "remind me tomorrow at 3 pm", "show Nova's garden",
"go to 45 minutes" (in the theatre), "speak in my voice", "share my location".

### Page voice actions (which page exposes what)

A page calls `useVoiceActions({...})` (`components/voice/provider.tsx:84`). While it is mounted its actions are listed by the
`page_actions` tool and run by `do_page_action`. Names below are from the code. Pages with no row register nothing but still
work through the generic tools (`click`, `type_text`, `scroll`, `read_screen`, `select_option`).

| Page / component | Spoken actions (names) |
|---|---|
| Home galaxy `app/(bridge)/page.tsx` | `rotate_galaxy`, `zoom_galaxy`, `focus_project`, `reset_galaxy_view`, `galaxy_auto_rotate` |
| `/career` `app/(app)/(pages)/career/page.tsx` | `analyse_job`, `fill_job_description`, `open_analysis` |
| Career resume `components/career/resume.tsx` | `generate_resume`, `download_resume_pdf`, `view_resume_pdf`, `download_resume_tex` |
| `/projects` | `projects_view`, `projects_filter`, `organize_projects`, `open_project_page` |
| Project reel `components/projects/reel.tsx` | `show_project`, `present_project`, `start_project_tour`, `stop_project_tour`, `next_project`, `previous_project`, `close_project`, `open_project_demo`, `open_project_code` |
| `/memories` | `memories_view` |
| Memory palace `components/memories/palace.tsx` | `palace_go`, `palace_walk`, `palace_turn`, `palace_open`, `palace_next`, `palace_previous`, `palace_close`, `palace_find`, `palace_where` |
| `/habits` | `tick_habit` |
| `/journey` | `go_to_milestone`, `next_milestone`, `previous_milestone`, `start_tour`, `stop_tour`, `replay_animation`, `switch_view` |
| `/autopilot` | `autopilot_run`, `insight_do`, `insight_open_link` |
| `/brief` | `brief_make` |
| `/dream` | `dream_now` |
| `/comic` | `comic_make`, `comic_share` |
| `/routines` | `routine_run` |
| `/web` | `web_task_open`, `web_task_live` |
| `/map` | `map_route_mode`, `map_locate`, `map_nearby`, `map_list`, `map_way_to`, `map_start_navigation`, `map_zoom`, `map_devices` |
| `/photos` | `photos_search`, `photos_open`, `photos_browse`, `photos_edit`, `photos_delete` |
| `/wrapped` | `wrapped_month`, `wrapped_card`, `wrapped_read` |
| `/apps/[id]` (a built app) | `app_undo`, a change action, and one `app_<name>` per action the built app declares (built dynamically) |
| `/focus` | `focus_exit` |
| `/games/paattu` | `paattu_start`, `paattu_answer`, `paattu_next` |
| Colour Clash `components/games/cards-game.tsx` | `cards_deal`, `cards_hand`, `cards_play`, `cards_draw`, `cards_keep`, `cards_last` |
| Chess vs bot `components/games/chess/vs-bot.tsx` | `chess_start`, `chess_move`, `chess_status`, `chess_hint`, `chess_undo`, `chess_resign` |
| Chess vs friend `.../chess/vs-friend.tsx` | `chess_friend_start`, `chess_friend_move`, `chess_friend_status`, `chess_friend_draw`, `chess_friend_resign` |
| Ludo | `ludo_start`, `ludo_roll`, `ludo_move` |
| Snakes and Ladders | `snakes_start`, `snakes_roll`, `snakes_status` |
| Bingo | `bingo_start`, `bingo_fill`, `bingo_call`, `bingo_status` |
| Connect Four | `c4_start`, `c4_drop`, `c4_status` |
| Dots and Boxes | `dots_start`, `dots_line`, `dots_suggest`, `dots_status` |
| Business | `business_start`, `business_roll`, `business_buy`, `business_skip`, `business_build`, `business_mortgage`, `business_jail`, `business_end`, `business_status` |
| Draw & Guess (solo `draw-game.tsx` and party `party-draw.tsx`) | `draw_start`, `draw_guess`, `draw_status`, `draw_clear` |
| Game night lobby `components/games/party-table.tsx` | `party_game`, `party_lobby`, `party_players`, `party_mute`, `party_chat`, `party_remove` |
| Garden 3D `components/garden/garden-3d.tsx` | `garden_goodnight`, `garden_festival`, `garden_day`, `garden_nova`, `garden_find`, `garden_close`, `garden_describe` |
| Garden flat `components/garden/flat-garden.tsx` | `garden_describe` |
| Nova pet `components/pet/nova.tsx` (mounted on every page) | `nova_status`, `nova_hide_and_seek`, `nova_guess`, `nova_move`, `nova_rename`, `nova_lantern_walk`, `nova_play`, `nova_wear`, `nova_hide`, `nova_talk` |
| Music lights `components/fx/beat-lights.tsx` | `music_lights` |
| Living sky `components/fx/living-sky.tsx` | `living_weather` |

Pages with no registered actions: notes, documents, sources, search, settings, share, calls, games index, theatre shelf.
The theatre has its own separate voice control (see [section 10](#10-checked-and-notes)).

## 3. How it works

### 3.1 The wake word (on device)

1. **Enrolment** (`components/wake/wake-card.tsx`). 8 takes of the word (up to 14 attempts), 2.2 s each. A take is accepted only
   if `trim()` finds a word in it (peak above 300, at least 4x the quiet floor, no longer than 2 s, i.e. 25 chunks). Then you
   read a 7 s sentence so the app learns what your ordinary speech looks like (the "background").
2. **Features** (`lib/wake/features.ts`). The mic is resampled to 16 kHz in an AudioWorklet (`lib/wake/mic.ts`) and cut into
   80 ms chunks (1280 samples). Two small ONNX models turn each chunk into a 96-number embedding: `melspectrogram.onnx` then
   `embedding_model.onnx`. They are openWakeWord's models, in `public/wake/` (1.09 MB and 1.33 MB), fetched from
   `/wake/<name>.onnx` on the same origin (so only after login) and run with `onnxruntime-web` (WASM, 1 thread).
3. **Matching** (`lib/wake/match.ts`, pure functions). Your 8 recordings are stored as sequences of embeddings (not audio).
   Live audio is compared by dynamic time warping with cosine distance; the score is the mean of the 3 closest recordings.
   `calibrate()` stores `pos` (how far your own takes are from each other) and `neg` (the best match found in your ordinary
   speech). The threshold is `max(pos*(1.1+0.5*s), 0.06+0.03*s)`, capped below `neg`, where `s` is the sensitivity 0 to 1.
4. **Detector** (`lib/wake/detector.ts`). Compares only when something loud was said in the window (loudness above
   `max(300, 3x running noise)`), so silence costs almost nothing. After a hit it ignores the next 2.5 s. It keeps the last
   ~2 s of audio for the voiceprint check. If the device falls more than 6 chunks behind it drops chunks rather than lag.
5. **Listener** (`components/wake/listener.tsx`, mounted in `app/layout.tsx`). Runs only when: a wake model exists and is
   enabled, and either "start listening when I open HIVEMIND" is on or the ear button is on for this tab (`sessionStorage`
   `hm-wake-on`), and the tab is visible, and live voice is off, and the page is not public, and not `/settings` (the
   settings card runs its own test listener). A hit plays a click and calls `voice.start()`.
6. **With a voiceprint on**, the heard audio is first checked against it (threshold minus 0.05, because a wake word is short;
   at least 0.5 s of speech). A miss dispatches `hm:wake-rejected` and the ear button flashes red; voice does not start.

There is no fixed phrase. The phrase is whatever the owner enrols; "Hey Karthik" is only the default text in the box.
Each device learns its own word (stored in that browser's `localStorage`).

### 3.2 The live conversation (Gemini Live)

1. The mic tap (or wake word) calls `LiveVoice.start()` (`lib/live.ts`). The mic permission is requested first (it must come
   from a user gesture). The Gemini SDK and a session token are fetched in parallel.
2. `POST /api/live/token` builds the session on the server (`app/api/live/token/route.ts`): the persona and rules, the
   owner's profile, project names, agenda for 2 days, the pet's name, the language rule, and the tool list for the page the
   owner is on (see 3.4). It mints a one-use ephemeral token with `geminiClient().authTokens.create` (valid 30 min, a new
   session must start within 60 s) and returns `{ token, model, config, myVoice, catalog }`. The real API key never reaches
   the browser.
3. The browser connects **directly to Google** with that token (`apiVersion: "v1alpha"`). Mic audio streams up as 16 kHz PCM
   in about 100 ms batches. The reply streams back as 24 kHz PCM and is scheduled gap-free in an `AudioContext`.
4. Transcripts: `inputAudioTranscription` and `outputAudioTranscription` are on. `stripMarkup()` removes tags the model sometimes
   writes ("<no speech>", "{pause}").
5. **Listening, silence detection, barge-in.** There is no client-side silence detector in the live path. The code sets no
   voice-activity-detection options, so Google's server-side default decides when you have finished. When you start speaking
   while HIVEMIND is speaking, `onMessage` ends the turn as interrupted; when Google sends `interrupted`, playback is stopped
   and the state goes back to "listening". Echo cancellation, noise suppression and auto gain are requested from the browser.
6. **States:** off, connecting, listening, thinking, speaking (`LiveState`). The dock ring pulses with the real loudness.
7. **Tools.** Tool calls arrive from the model; `LiveVoice.tool()` first runs `beforeTool` (guest mode and voiceprint), then a
   page-side tool (`clientTools`), then the built-in brain tools, then `serverTool` (which posts to `/api/agent-tool`).
8. **Ending.** `go_to_sleep`, or spoken sleep words ("go to sleep", "stop listening", "mic off", a bare "bye/goodbye/good
   night", regex in `provider.tsx:176`), stop the session after the goodbye finishes playing. Google's `goAway` shows
   "Live session is about to end (time limit)".
9. **History.** After every finished turn the browser posts both transcripts to `/api/live/log`, which stores them in the chat
   history (messages with `metadata.via = "live"`). A guest's turns are never logged.

### 3.3 Speech-to-text and text-to-speech

| Direction | Engine | Fallback |
|---|---|---|
| Speech to text, live voice | Gemini Live input transcription (server side at Google). | None. If the session fails, an error is shown. |
| Speech to text, other places | Browser `SpeechRecognition`, `en-IN`: Draw & Guess (`components/games/draw-game.tsx`) and the theatre voice control (`lib/theatre/speech.ts`). | n/a |
| Text to speech, live voice | Gemini Live's own audio (voice `Charon`). | n/a |
| Text to speech, chat replies and read-aloud | `POST /api/tts` (Gemini TTS, voice `Charon` by default) per sentence, played with the Web Audio API. | The browser `speechSynthesis`. |
| Speak in my voice | `/api/tts` with the cloned voice id; in live voice the Gemini audio is muted and the transcript is spoken sentence by sentence in the clone (about 1 s slower). | If the clone fails, the usual voice, and the clone is not retried for 1 hour (unless the error was 429). |
| Journey story narration | `Speaker` with `engine: "browser"`: always the device voice, one locked male voice, rate 1.35. | n/a |

`Speaker` (`lib/voice.ts`) details: `SentenceStream` releases the first chunk at the first full sentence so the voice starts
fast, then batches up to about 260 characters to save TTS requests. `speakable()` strips markdown, citation numbers and turns
URLs into "the link". The next sentence's audio is requested while the current one plays. On a TTS failure the browser voice
takes over: 5 minutes after a 429 (free quota out), 30 seconds after other errors. In the browser voice, text containing Tamil
script uses a `ta-IN` voice if the device has one; otherwise it uses the default (it may stay silent). Male English voices are
preferred (Prabhat, Ravi, Rishi, Guy and others); if none exists the pitch is lowered to 0.75.

### 3.4 Which tools a live session loads

Loading all 115 tools made sessions slow, so `lib/voice/plan.ts` groups them. Every session loads the `core` group, plus the
group(s) for the page where it started (matched by path prefix; `/` matches only the home page). The other tools stay
reachable through two meta tools: `use_tool` (run any tool by name) and `tool_help` (arguments and how to use it, answered in
the browser from the `catalog` returned by the token route). Groups: core, home, brief, autopilot, projects, documents, career
(also `/journey`), habits, apps, routines, calls, web, map, dream, comic, garden, focus, games, palace (the memories page).
A test checks every tool is in exactly one group. The page list the model may open is `lib/voice/pages.ts` (`VOICE_PAGES`, 45
entries, including garden festival variants and every game); `navigate` accepts only those, and a test checks the list matches
the real app pages.

### 3.5 From a sentence to an action (the intent router, chat)

Typed chat (home console) goes to `POST /api/hivemind`. In order:

1. **Routine phrase.** If the text matches a routine's trigger ("good morning", "gym mode"), Core runs that routine.
2. **Router** (`lib/agents/router.ts`). `ruleBasedAgent()` is a long list of regex rules (greetings, kural, send-a-message,
   apps, comics, screen effects, pet, brief, dream, kitchen mode, routines, call screening, Autopilot, habits and birthdays,
   reminders, projects, notes, language, remember, delete, calls, maps, video, music, browser tasks, shopping, research, career,
   profile). If no rule matches and `GROQ_API_KEY` is set, a fast Groq model returns `{"agent": "<id>"}` (temperature 0, 30 max
   tokens). If both fail the default is `rag` (knowledge agent). A guess of `research` or `core` loses to a strong match in the
   owner's own notes (the brain-first check).
3. **No-AI shortcuts** (`lib/agents/quick.ts`, `instant.ts`). Short exact commands are answered straight away: screen switches
   ("lights off", "Nova be quiet", "music lights blue"), garden festivals, "Nova good night", opening a page ("open settings",
   "let's play chess"), and instant answers for "where am I", "weather", "my habits", "how is Nova". Instant answers are
   skipped for Tamil.
4. **Agent loop** (`lib/agents/orchestrator.ts`). The chosen agent runs a tool-calling loop (max 6 steps, models from
   `GEMINI_CHAIN`, a stalled model is abandoned after 8 s, a model out of daily quota is skipped for 1 hour). A top-level agent
   can hand a sub-task to a colleague with `ask_agent` (one level deep). A forced `play_music` call happens when the owner
   complains the song is wrong ("MUSIC_RETRY").

The nine agents (`lib/agents/registry.ts`):

| Agent id | Handles | Tools |
|---|---|---|
| `core` | General chat, music, video, brief, check-in, kural, apps, routines, screen effects, pet, Autopilot, wrapped, comics, kitchen mode | the widest set (see `registry.ts`) |
| `rag` | Questions about the owner's own notes and memories | `search_brain`, `open_source` |
| `memory` | Remember, correct, delete, notes, documents, photos | `remember`, `update_memory`, `delete_memory`, `confirm_delete_memory`, `recent_memories`, `search_brain`, `open_source`, `create_note`, `list_notes`, `update_note`, `delete_note`, `list_documents`, `delete_document`, `find_photos` |
| `research` | Web search, news, weather, shopping, browser tasks, places | `web_search`, `find_product`, `open_link`, `get_weather`, `research_and_save`, `web_task`, `web_tasks_status`, `web_task_answer`, `web_task_delete`, `where_am_i`, `places_nearby`, `directions`, `device_locations` |
| `career` | Job search, ATS match, resumes | `search_jobs`, `check_listed_job`, `analyze_job`, `tailor_resume`, `job_analyses`, `delete_job_analysis`, `confirm_delete_memory`, `search_brain`, `open_link` |
| `project` | Projects | `list_projects`, `project_details`, `create_project`, `update_project`, `delete_project`, `search_brain` |
| `scheduler` | Reminders, birthdays, habits | `create_reminder`, `list_reminders`, `cancel_reminder`, `reschedule_reminder`, `complete_reminder`, `add_birthday`, `upcoming_birthdays`, `remove_birthday`, `birthday_wish`, `add_habit`, `log_habit`, `habits_status`, `remove_habit`, `snooze_habit` |
| `comms` | Calls, messages, contacts, call screening | `call_contact`, `message_contact`, `start_call`, `save_contact`, `search_brain`, `screened_calls`, `call_screening` |
| `profile` | Who the owner is; language setting | `get_profile`, `refresh_profile`, `set_language`, `search_brain` |

The 87 tools live in `lib/agents/tools/` by domain: `brain` (19), `schedule` (14), `routines` (15: brief, dream, comic, pet,
wrapped, game record, kural, night check-in, open_page, kitchen mode, routines), `web` (9), `career` (6), `contacts` (6),
`apps` (5), `places` (4), `autopilot` (3), `media` (3: `play_music`, `play_video`, `screen_effects`), `profile` (3).
`lib/agents/tools.ts` merges them; `shared.ts` holds helpers (two-step delete via `askedToDelete`, job picking, contact
resolving).

Live voice has no router: the live model picks tools itself from the loaded list. Server-side tools run through
`POST /api/agent-tool`.

### 3.6 The owner-intent guard, guest mode and voiceprint (voice safety layers)

Three layers apply to live voice, and the first also to chat:

1. **Intent guard** (`lib/agents/intent.ts`). `INTENT` maps about 38 consequential tools (delete_*, message/call/save contact,
   `web_task_answer`, update_*, create_routine, call_screening, change_app, reminder changes, `set_language`,
   `autopilot_update`...) to a regex of words the owner must have said this turn. Tamil-script equivalents exist for delete,
   yes, message, call and change; Tanglish already matches the English words. It runs in the browser (`provider.tsx`
   `serverTool`), on the server (`/api/agent-tool`, using the `said` text) and in chat (`orchestrator.ts`). Text from web pages,
   documents or app updates ("[HIVEMIND app update, not the owner speaking]") never counts as the owner's words. A routine's
   steps can never run guarded tools. Approving a web task also needs an approving word in the owner's own turn.
2. **Guest mode** (`lib/agents/guest.ts`). While a guest talks only `GUEST_TOOLS` run: profile, projects, apps, kural, game
   record, web search (never saved), links, weather, places, music, video, and the screen/voice tools. Everything else is refused
   in the browser and again in `/api/agent-tool`. Notes, diary, memories, reminders and habits stay private. The guest's lines
   are kept in the tab only (last 60) for the recap; they are never logged.
3. **Voiceprint** (`lib/voiceprint/*`, `provider.tsx` `verifyOwner`). See 3.7.

### 3.7 Voiceprint and "My voice" (what is stored where)

**Voiceprint: built and active, not on hold.** The README is silent on it, and an older note says voice ideas are on hold, but the
voiceprint code is wired in: `verifyOwner` in `components/voice/provider.tsx:227`, `components/wake/listener.tsx`, and the
Settings card (`components/voiceprint-card.tsx`, mounted in `app/(app)/(pages)/settings/page.tsx`). It does nothing until the
owner enrols and keeps "Check my voice" ticked.

- **Model.** WeSpeaker CAM++ (VoxCeleb), about 29 MB ONNX, downloaded from Hugging Face
  (`lib/voiceprint/model.ts` `MODEL_URL`, `csukuangfj/speaker-embedding-models`) the first time, then kept in the browser's
  Cache Storage `hm-models` (`lib/ort.ts`). Not served by HIVEMIND. The ONNX runtime WASM (14 MB) comes from
  `cdn.jsdelivr.net/npm/onnxruntime-web@<installed version>/dist/`.
- **Features.** A Kaldi-style 80-bin log-mel filterbank written in TypeScript (`lib/voiceprint/fbank.ts`), only the voiced parts
  (loud 10 ms frames, 1 s minimum, at most the first 12 s).
- **Enrolment.** 3 lines of 5 s (one English, one Tanglish, one about the policy). The three 512-number embeddings are averaged.
  `enrolQuality` rates how well the takes agree: good at 0.8 or more, ok at 0.65 or more, otherwise poor (still saved, with a warning).
- **Stored.** `localStorage` key `hm-voiceprint-v1`: `{ print: 512 numbers, strictness, enabled, at, quality }`. No recording.
  Device-only; each device enrols separately. Never sent to the server.
- **Check.** The last up to 4 s of the owner's speech (the live session keeps up to 15 s in memory, excluding HIVEMIND's own
  voice) is embedded and compared by cosine similarity with the print. Thresholds: relaxed 0.42, normal 0.50, strict 0.60.
  A pass proceeds. A miss (or an error) shows the "Was that you?" card for 20 s; "It's me" lets it through, "No, don't" or
  timeout refuses. Typed text is never checked. The check is needed for: ending guest mode, any guarded tool, and, once a guest
  has talked, any tool that is not in `GUEST_TOOLS` (`lib/voiceprint/policy.ts` `needsOwnerVoice`).
- **Weak spot by design:** the fallback is a tap on screen by whoever holds the device, so the voiceprint is a speed bump, not a
  lock.

**My voice** (`lib/my-voice.ts`, `components/my-voice.tsx`, `app/api/voice/mine/route.ts`):

- The browser records with `MediaRecorder`, converts to 24 kHz mono 16-bit WAV (`lib/wav.ts`), and posts sample + consent
  (base64) to `/api/voice/mine`. The server sends both to Google (`voices.create`, `type: "replicated"`, `store: true`).
  Google returns a voice id.
- **Stored on the server:** private-store key `my-voice` = `{ id, enabled, created_at }` (`lib/private-store.ts`, private
  Supabase Storage bucket `hivemind-private`). The recordings themselves are not kept by HIVEMIND. The id is never returned to
  the browser. It is cached in server memory for 30 s.
- Deleting calls `voices.delete` at Google too. Re-recording deletes the old clone.
- Off by default. Switching on is by the Settings toggle or by saying "speak in my voice" (guarded: the owner's words must
  contain voice/speak/talk/sound).
- Status of the Google feature: `lib/tts.ts` says the clone may need a paid tier; if the clone call fails it falls back to the
  usual voice automatically. A note in the owner's memory says voice cloning is not available on the free key. Whether it works
  on the current key was not verified (needs a live call).

### 3.8 Read-aloud

`lib/read-aloud.ts` is a shared `Speaker` so starting one reading stops the other. It is used by `components/day/your-day.tsx`
("hear your day"), `components/day/kural-card.tsx` (today's kural) and `components/reminders/watcher.tsx` (the daily brief is read
out automatically if the browser already allows sound; otherwise a button does it). Each button shows "Stop" only for the text
that is being read. It uses `/api/tts` first, the browser voice after a failure. There is no separate server route for it.

### 3.9 Files

| File | What it holds |
|---|---|
| `lib/wake/features.ts` | Loads the two wake ONNX models, makes 96-number embeddings per 80 ms |
| `lib/wake/match.ts` | DTW matching, calibration, threshold, trimming (pure) |
| `lib/wake/detector.ts` | Live detector loop, and `recordFeatures` for enrolment |
| `lib/wake/mic.ts` | Microphone + AudioWorklet at 16 kHz, 80 ms chunks |
| `lib/wake/store.ts` | Wake model in `localStorage`, events, per-tab on/off |
| `components/wake/listener.tsx` | Background listener mounted in the layout |
| `components/wake/wake-card.tsx` | Settings card: enrol, test, sensitivity, forget |
| `components/wake/wake-toggle.tsx` | The ear button |
| `public/wake/*.onnx` | The two wake word models |
| `lib/voiceprint/fbank.ts` | Filterbank features, cosine, voiced-part picker |
| `lib/voiceprint/model.ts` | WeSpeaker model loader and embedder |
| `lib/voiceprint/policy.ts` | Which actions need the owner's voice, thresholds, quality rating |
| `lib/voiceprint/record.ts`, `store.ts` | Recording helper; voiceprint in `localStorage` |
| `components/voiceprint-card.tsx` | Settings card for the voiceprint |
| `lib/ort.ts` | Loads `onnxruntime-web` (WASM from jsDelivr), model cache helper |
| `lib/live.ts` | `LiveVoice`: Gemini Live client, mic capture, playback, tool dispatch |
| `components/voice/provider.tsx` | The one live session for the site, tools, guest mode, voiceprint checks, `useVoiceActions` |
| `components/voice/dock.tsx` | Floating mic button, live caption, tap-to-continue card, guest banner, "Was that you?" card |
| `components/voice/dom-tools.ts` | `click`, `scroll`, `type_text`, `select_option`, control listing by visible label |
| `lib/voice/plan.ts`, `lib/voice/pages.ts` | Which tools/instructions load per page; the openable page list |
| `lib/voice.ts` | `Speaker`, `SentenceStream`, `speakable`, `splitSentences` |
| `lib/read-aloud.ts` | Shared reader |
| `lib/tts.ts` | Server TTS call to Gemini, clone fallback |
| `lib/my-voice.ts`, `components/my-voice.tsx`, `lib/wav.ts` | Voice clone: server store and Google calls; Settings card; WAV encoder |
| `lib/sfx.ts` | UI sound effects |
| `components/language.tsx`, `lib/prefs.ts` | Language setting and the language rule text |
| `lib/agents/*.ts` | Router, orchestrator, registry, intent guard, guest mode, quick and instant answers |
| `lib/agents/tools/*.ts` | The 87 tools by domain |

## 4. API

All routes sit behind the owner session: `proxy.ts` returns 401 (API) or redirects to `/unlock` unless the session cookie is
valid. None of these paths is in the open list. `handle()` turns errors into JSON (`HttpError` status; zod errors become 400
"Invalid input"; anything else 500 "Something went wrong").

| Method | Path | Who may call | Purpose | Request | Response |
|---|---|---|---|---|---|
| POST | `/api/live/token` | Owner session | Mint a one-use Gemini Live token and the session config | `{ path?: string (max 200, default "/") }`; a bad or missing body is treated as `/` | `{ token, model, config, myVoice: boolean, catalog }` |
| POST | `/api/live/log` | Owner session | Save one live exchange to chat history | `{ conversation_id?: uuid\|null, user: string (max 8000), assistant: string (max 20000), sources?: up to 20 {n,type,title,href,similarity} }` | `{ conversation_id }`; creates a conversation titled "mic emoji + first 76 chars" when none; skips if both texts are empty |
| POST | `/api/tts` | Owner session | Speech for one sentence | `{ text: string, trimmed, 1 to 1200 }` | audio bytes (Gemini's mime, usually `audio/wav`), `Cache-Control: no-store`; 429 = out of free quota, 502 = no audio or voice unavailable |
| GET | `/api/voice/mine` | Owner session | Does the clone exist / is it on | none | `{ exists, enabled, created_at, consent_text }` (never the voice id) |
| POST | `/api/voice/mine` | Owner session | Clone the owner's voice | `{ sample: base64 WAV, consent: base64 WAV }`, each 1000 to 3,500,000 chars | `{ exists, enabled, created_at }`; 422 with a readable message on Google errors (consent mismatch, quota) |
| PATCH | `/api/voice/mine` | Owner session | Turn "speak in my voice" on or off | `{ enabled: boolean }` | `{ exists, enabled }`; 400 "Record your voice first." when on but no clone |
| DELETE | `/api/voice/mine` | Owner session | Delete the clone (here and at Google) | none | `{ exists: false, enabled: false }` |
| POST | `/api/agent-tool` | Owner session | Run one chat-agent tool for live voice | `{ name (1 to 60), args, said (max 4000), routine, guest, state: { jobs?, pending_delete?, location? } }` | `{ result, sources, actions, changed, jobs, pending_delete }`; refusals come back as `result.error` |
| GET / PUT | `/api/prefs` | Owner session | Read / set the reply language | PUT `{ language: "auto"\|"en"\|"ta" }` | `{ language }` |
| POST | `/api/hivemind` | Owner session | Typed chat (router and agents) | see the chat docs | NDJSON stream |

`/api/agent-tool`, `/api/prefs` and `/api/hivemind` are outside the strict scope but are the server half of voice and the router.
`maxDuration`: tts 30 s, voice/mine 60 s, agent-tool 120 s. The token and log routes set none.

## 5. Data

| Where | Key / table | What | Notes |
|---|---|---|---|
| Browser `localStorage` | `hm-wake-v1` | Wake model: word, the recordings' embeddings (rounded to 4 decimals), `pos`, `neg`, sensitivity, enabled, autoStart | Features, not audio. Per device |
| Browser `localStorage` | `hm-voiceprint-v1` | Voiceprint: 512 numbers, strictness, enabled, date, quality | Per device |
| Browser `sessionStorage` | `hm-wake-on` | Ear button on for this tab | Cleared with the tab |
| Browser `localStorage` | `hivemind-muted` | UI sounds muted | `lib/sfx.ts` |
| Browser `localStorage` | `hivemind-speak-all` | "VOICE: ALWAYS" for chat replies | Home console |
| Browser Cache Storage | `hm-models` | The 29 MB speaker model | Not cleared on lock (`clearOfflineCache` clears other caches) |
| Private store (Supabase Storage `hivemind-private`) | `my-voice` | `{ id, enabled, created_at }` | The Google voice id |
| Private store | `prefs` | `{ language }` | `lib/prefs.ts` |
| Table `conversations`, `messages` | live exchanges | Title `"mic emoji" + text`; messages with `metadata.via = "live"`, assistant rows also `model: "gemini-live"` and sources | Written by `/api/live/log` |
| Google | stored voice | The cloned voice, until deleted | `store: true` |

No SQL migration is specific to this area.

## 6. Configuration

| Name | Required? | Meaning | Default |
|---|---|---|---|
| `GEMINI_API_KEY` (read in `lib/ai/gemini.ts:7`) | Yes, for live voice, TTS, clone and the agents | The Google key; throws "GEMINI_API_KEY is not set" if missing | none |
| `GEMINI_CHAT_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_MODELS` | No | Models the agent loop tries (`GEMINI_CHAIN`) | see `lib/ai/gemini.ts` |
| `GEMINI_LIVE_MODEL` | No | Live model id | `gemini-3.8-live` |
| `GEMINI_TTS_MODEL` | No | TTS model id | `gemini-3.8-flash-tts` |
| `GEMINI_TTS_VOICE` | No | Prebuilt voice for both TTS and live | `Charon` |
| `GROQ_API_KEY` | No | Fast LLM for the router when no regex rule matches (`groqProvider.isConfigured()`) | router falls to `rag` |
| `APP_URL` | No | Public origin used in `/api/agent-tool` context | the request origin |
| Settings: language | n/a | `auto` / `en` / `ta` in private store `prefs` | `auto` |
| Settings: wake word, voiceprint | n/a | Per-device, `localStorage` | off |

Model id defaults are taken from the code as written; whether those ids exist at Google was not verified.

## 7. Security and privacy

**Who can reach it.** Everything here needs the owner session cookie (`proxy.ts`). The two public areas of the app (call pages,
theatre rooms) do not use this voice stack.

**What leaves the device**

| Data | Goes to | When |
|---|---|---|
| Live microphone audio (16 kHz PCM) | Google (Gemini Live), straight from the browser with the ephemeral token | Only while a live session is on |
| Live transcripts | Google (as part of the session), and HIVEMIND's database via `/api/live/log` | Each finished turn (not for a guest) |
| The owner's profile, project names, agenda, pet name | Google, inside the system instruction the token route builds | Each session start |
| Text to speak | HIVEMIND server, then Google TTS | Each spoken sentence of chat replies and read-aloud (not live voice) |
| Clone sample and consent recording | HIVEMIND server (not stored), then Google | Only at "Create my voice" |
| Tool calls, `said` text | HIVEMIND server (`/api/agent-tool`) | Each non-page tool call |
| Wake-word audio | Nowhere. Processed in the browser; only embeddings are kept, locally | Always |
| Voiceprint, voice check audio | Nowhere. Embedded in the browser | Always |
| Speaker model, ONNX WASM runtime | Downloaded from Hugging Face and jsDelivr (those hosts see the request) | First use |
| Browser `SpeechRecognition` (Draw & Guess, theatre) | The browser vendor's speech service (in Chrome, Google) | Only on those pages |

**Controls**

- The Gemini key stays on the server; the browser gets a one-use token that expires after 30 minutes. The token is created without
  `liveConnectConstraints`, so the browser, not the server, supplies the final session config; this is acceptable only because the
  caller is the owner.
- Dangerous tools: the intent guard, guest allowlist, routine lock, and voiceprint (see 3.6). The server re-checks guest and
  intent on `/api/agent-tool`; it does not know about the voiceprint (browser only).
- A tool result or app update cannot approve a web task: `provider.tsx:418` requires an approving word in the owner's own turn.
- The live log route scrubs NULs and broken emoji (`lib/scrub.ts`) before saving; transcripts are bounded (8000 / 20000 chars).
- `/api/tts` text is capped at 1200 chars; clone uploads are capped at about 3.5 MB base64 each.
- The Permissions-Policy header allows the microphone only for the app's own origin (`next.config.ts`).
- Lock ("lock HIVEMIND", or the lock button) deletes the session cookie and clears the offline data cache. It does not clear the
  wake model or voiceprint in `localStorage`, nor the model cache.
- The wake models are served only to logged-in users (the smoke test expects a 307 redirect to `/unlock` without a session).

## 8. Limits and edge cases

| Thing | Value |
|---|---|
| Live token life / new-session window | 30 min / 60 s; one use |
| Live audio | 16 kHz in, 24 kHz out; about 100 ms upload batches |
| Voice-check audio kept | last 15 s in memory (reset when HIVEMIND finishes a reply); the last 4 s is used |
| Owner check wait | 20 s then "No" |
| Wake chunk | 80 ms; cooldown 2.5 s after a hit; window = longest recording x 1.6 + 2 chunks |
| Wake enrolment | 8 takes x 2.2 s, max 14 attempts, then 7 s background |
| Wake word length | recording longer than 2 s is rejected (a sentence, not a word) |
| Wake works | Only with the app open and visible (phones do not let web apps listen in the background); the mic stays on while listening |
| TTS sentence | up to 1200 chars; first chunk at the first full sentence, later chunks up to about 260 |
| TTS fallback | browser voice for 5 min after 429, 30 s after another error; clone retried after 1 h |
| Agent loop | 6 steps; stall 8 s; daily-quota model skipped 1 h; "busy" 503 retried once |
| Guest lines kept | 60 in the tab |
| Tools in a live session | 28 voice tools + the page's group + 2 meta tools; the rest by `use_tool` |
| Mic blocked | Error: "Microphone permission is blocked for this site." |
| Locked app | Token call 401 shows "Locked: unlock HIVEMIND first." |

Failure behaviour: a live start that is stopped halfway, or an old session closing late, does not tear down the new one
(tested). A page that is public (call, play, theatre rooms) shows no dock and no space-bar shortcut (`isPublicPage`).

## 9. Tests

Unit (vitest), in `tests/`:

| File | Covers |
|---|---|
| `wake-match.test.ts` | DTW matching, scoring, trimming, threshold and sensitivity |
| `voiceprint.test.ts` | Which actions need the owner's voice, strictness order, filterbank shape |
| `live-start.test.ts` | Starting/stopping live voice races, the tool guard (built-in tools also checked), not-loaded tools |
| `live-markup.test.ts` | `stripMarkup` |
| `voice-plan.test.ts` | Every tool in exactly one group; core everywhere; page groups; session size |
| `voice-pages.test.ts` | `VOICE_PAGES` matches the real app pages; instructions only point to allowed pages |
| `intent.test.ts` | Intent guard incl. Tamil words |
| `guest.test.ts` | Guest allowlist, rules, recap |
| `router.test.ts` | `ruleBasedAgent` rules |
| `quick.test.ts`, `instant.test.ts` | No-AI shortcuts |
| `chess-voice.test.ts`, `pet-voice.test.ts`, `theatre-voice.test.ts`, `party-rules.test.ts` | Specific voice actions (names suggest; not read in detail) |

End to end: `e2e/smoke.spec.ts` checks that `/wake/melspectrogram.onnx` redirects without a session.

Not covered by any test I found: `lib/voice.ts` (`Speaker`, `SentenceStream`, `speakable`), `lib/tts.ts` and its clone fallback, `lib/my-voice.ts`,
the three routes `/api/tts`, `/api/live/token`, `/api/live/log`, `/api/voice/mine` (no request-level tests), the detector loop
and AudioWorklet, the settings cards, and the `useVoiceActions` registration of individual pages (only `__hmVoiceTest` in dev
for manual checks).

## 10. Checked and notes

**Verified by reading**

- Wake word is user-enrolled, not a fixed phrase; detection is fully in the browser, models are same-origin at `/wake/*.onnx`
  (`lib/wake/features.ts:64`); files exist (`public/wake/embedding_model.onnx`, `melspectrogram.onnx`).
- No audio leaves the device for the wake word or the voiceprint (`lib/wake/store.ts` docs and code; `lib/voiceprint/store.ts`).
- Voiceprint is implemented and enforced in the live path (`components/voice/provider.tsx:227-253`) and on the wake word
  (`components/wake/listener.tsx:24-31`). It is not "on hold" in code.
- The only languages are English, Tamil and Tanglish: `ONLY_THREE` in `lib/prefs.ts:23` is added to chat and live voice
  (`languageRule`), with a rule to treat other scripts as mishearings and to ask again in English instead of guessing an action.
- Live token: the real key never goes to the browser; the token is one use, 30 min (`app/api/live/token/route.ts`).
- Guest and intent guards are enforced both in the browser and in `/api/agent-tool`.
- `VOICE_PAGES` has 45 entries and is checked against the app by `tests/voice-pages.test.ts`.

**Notes, risks and oddities**

1. **Voiceprint check exists only in the browser.** `/api/agent-tool` re-checks the intent and guest rules but cannot know about
   the voiceprint; anyone with the session cookie can call it directly. Fine for a single-owner app, but the voiceprint should
   not be described as a security boundary. Its fallback is a tap by whoever holds the device.
2. **Voiceprint and wake word survive "lock".** Locking clears the offline cache but leaves `hm-voiceprint-v1`, `hm-wake-v1` and the
   `hm-models` cache on the device (`lib/offline.ts:435-449`). These hold no recordings, only numbers, so the risk is low.
3. **No integrity check on downloaded code and model.** The ONNX runtime comes from jsDelivr by version, the speaker model from a
   Hugging Face "resolve/main" URL (a moving branch). A change at either host would change what runs in the owner's browser. The
   page has no CSP `connect-src`/`script-src` that would limit this (`next.config.ts:8` only sets frame/base/form rules).
4. **Console label is misleading.** The home console switch says "VOICE: WHEN SPOKEN TO", but `send()` is never called with
   `spoken: true` anywhere (`app/(bridge)/page.tsx:277-297`; only `speakAll` turns chat speech on). Looks like a leftover from a
   removed browser speech-to-text path. The `spoken` option is dead code.
5. **No client-side silence or end-of-speech logic for live voice.** It relies entirely on Google's default VAD (no
   `realtimeInputConfig` is sent). That cannot be tuned (for example for a noisy kitchen) without a code change.
6. **Ephemeral token has no constraints.** `authTokens.create` is called without `liveConnectConstraints`, so the browser could
   change the model, tools or system prompt. Low risk here (owner only) but worth knowing.
7. **Clone feature may not work on the current key.** `lib/tts.ts:17-19,40-45` already expects Google to reject the clone on a
   free tier and falls back to the usual voice for an hour; the owner's notes say voice cloning is not available on the free
   key. If the Settings card says "ON" but the voice sounds normal, that is why. Not verified live.
8. **Default model ids** (`gemini-3.8-live`, `gemini-3.8-flash-tts`) are set in code; I did not verify they are current names
   at Google. If voice breaks after a model retirement, set `GEMINI_LIVE_MODEL` / `GEMINI_TTS_MODEL`.
9. **Tanglish and Tamil text-to-speech.** Gemini TTS gets the text as is. The browser fallback only switches to a Tamil voice when
   the text has Tamil script; Tanglish (English letters) is read by an English voice, and Tamil on a device with no Tamil voice may
   be silent (`lib/voice.ts` `browserSpeak`).
10. **Space bar toggles voice everywhere** except in fields/buttons/links (`provider.tsx:752-764`); a focused scrolling panel
    that is not a button will start the mic on Space. Intended, but surprising on a long page.
11. **Dev-only hook** `window.__hmVoiceTest` exists only when `NODE_ENV === "development"` (`provider.tsx:270`); not present in production.
12. **Instant answers skip Tamil** (`app/api/hivemind/route.ts:155`), so a Tamil "weather" goes through the slower agent path. By design.
13. **Duplicate action names across pages.** `draw_*` is registered by both the solo and the party Draw & Guess (never mounted at
    the same time, so no clash). `garden_describe` is in both garden views.
14. **Theatre voice is separate.** The theatre uses `lib/theatre/speech.ts` (browser `SpeechRecognition`, English-India and Tamil)
    and a friends' voice channel; it is documented in `docs/friends-theatre.md`, not here.
15. **Read-aloud is small, not the held feature.** The owner's notes list "read-aloud (+ EN to TA)" as on hold. What exists
    (`lib/read-aloud.ts`) only reads the day brief, the kural and the daily brief with the normal voice; there is no translation or
    general read-aloud of pages.
16. **Test gaps** (see section 9): no tests for TTS fallback, `Speaker`/`SentenceStream`, the voice clone, or the voice routes.
