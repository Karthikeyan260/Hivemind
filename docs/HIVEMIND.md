# HIVEMIND: the complete documentation

HIVEMIND is a **personal AI for one person**: you. It keeps everything you give it (notes, memories, documents, photos), learns
who you are, files your knowledge into projects, answers from your own data, talks to you, reminds you, works in the
background, and also plays with you (a pocket pet, a 3D garden, games, a theatre for watching films with friends). It is
built entirely on free tiers and installs on a phone like an app.

> **How this documentation was made.** Every area was read from the code by an agent, then checked: all 98 API routes and all
> 45 pages are covered, and every file path mentioned in the documents was checked to exist. Statements the reader could not
> confirm are marked "not verified". Things that look wrong, risky or unfinished are collected in
> [known-issues.md](known-issues.md). Last checked **2026-11-11**.

## Start here

| I want to... | Read |
|---|---|
| Understand what HIVEMIND is and what it can do | This page |
| Set it up and deploy it | [README](../README.md) (setup) and [08 Testing and operations](08-testing-and-operations.md) |
| Know how a request travels, how login works, what the database looks like | [01 Architecture and platform](01-architecture-and-platform.md) |
| Know how notes, memories, documents, search and "Ask My Brain" work | [02 Brain and AI](02-brain-and-ai.md) |
| Know how voice, the wake word and spoken actions work | [03 Voice and wake word](03-voice-and-wake-word.md) |
| Know what runs by itself: Autopilot, web tasks, apps, Dream mode, briefs | [04 Autopilot, web tasks, apps](04-autopilot-web-tasks-apps.md) |
| Know how habits, reminders, birthdays, career, map, music, calls work | [05 Daily life](05-daily-life-habits-reminders-career.md) |
| Know about Nova, the garden, games, the comic, Wrapped, Journey | [06 Nova, garden, games and stories](06-nova-garden-games-and-stories.md) |
| Find a page or move around the app | [07 App shell and pages](07-app-shell-pages-and-navigation.md) |
| Look up an API route | [API reference](api-reference.md) |
| Run tests, back up, fix something that broke | [08 Testing and operations](08-testing-and-operations.md) |
| Watch films with friends | [Friends Theatre](friends-theatre.md) |
| See what is broken, risky or missing | [Known issues](known-issues.md) |
| Walk through the app by hand | [Manual test](manual-test.md) |

## What HIVEMIND is made of

```text
Browser (installable PWA: phone or laptop)
   │  password gate (one owner, no accounts)
   ▼
Next.js 16 on Vercel (App Router)            ← pages + 98 API routes + a daily cron (keepalive)
   │                                           an outside scheduler calls /api/cron/notify every ~5 min
   ├─ Supabase (Postgres + pgvector)  your notes, memories, documents, projects, photos, embeddings
   │                                   + a private storage bucket for small JSON state
   ├─ AI providers (first that answers wins):  Gemini → NVIDIA NIM → OpenRouter → Mistral → Groq
   ├─ Gemini Live + TTS                voice conversation and spoken replies
   ├─ Steel (cloud browser)            web tasks
   ├─ Web Push (VAPID)                 notifications when the app is closed
   └─ PeerJS broker + WebRTC           calls, friend games, Friends Theatre (browser to browser)
```

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router, Turbopack), React, TypeScript, Tailwind | One codebase for pages and API; free hosting on Vercel |
| Data | Supabase Postgres with pgvector, server-only secret key, RLS on every table | Free tier; vector search for "ask my brain" |
| Small state | A private Supabase Storage bucket of JSON files | No migration needed for small things (settings, push subscriptions, room codes) |
| AI | A fallback chain of free-tier providers | When one is rate-limited or down, the next answers |
| Voice | Browser wake-word models (ONNX, in the browser), Gemini Live, Gemini TTS | Hands-free without a paid speech service |
| 3D | three.js scenes (garden, journey, galaxy) | The pet's island, your career story, your knowledge as stars |
| Offline | Service worker + IndexedDB queue | Read and add things without a connection |
| Tests | vitest (about 770 tests), Playwright (browser tests), ESLint, tsc | See [08](08-testing-and-operations.md) |

It is **single-owner by design**: there are no accounts or sign-up. Anyone with the URL sees only a lock screen. The owner's
pages and API are behind one password; a few narrow public doors exist for guests (a call link, a game link, a theatre
room link) and each shows only its own room.

## The features

### Your brain
- **Notes**: AI adds a title, summary, category, tags and a search embedding when you save.
- **Memories**: eight types (fact, decision, idea and more), importance, **version history with restore**, re-embedded when edited.
- **Documents**: PDF, TXT, MD, DOCX, CSV are split into chunks (with page numbers) and embedded.
- **Photos**: described and tagged, with where and when they were taken, so you can search "Ooty trip".
- **Projects**: created from your portfolio and from your saves; new items are filed into the right project automatically,
  every automatic action shows in an activity feed with **undo**.
- **Ask My Brain**: chat that answers from your own data with numbered sources and a project filter; "remember that ..."
  saves a memory; "update my memory about ..." finds candidates and never changes one without you.
- **Semantic search** across everything; **Memory explorer / palace**; **Export brain** (JSON); **Sources** (portfolio MCP sync,
  page import such as Linktree; LinkedIn blocks readers, so upload your profile as a PDF).
→ [02 Brain and AI](02-brain-and-ai.md)

### Talking to it
- **Wake word** you teach it (matching runs in the browser; only speech features are stored, not audio) and **hands-free
  conversation** with Gemini Live in English, Tamil or Tanglish.
- **Spoken replies**, an optional **"speak in my voice"** clone, **voiceprint** (a speed bump for risky spoken actions).
- Most pages register **voice actions**, so you can run them by speaking.
→ [03 Voice and wake word](03-voice-and-wake-word.md)

### Working for you
- **Autopilot**: a few times a day it reads your whole brain and tells you what needs you. It only reads; it never changes or
  deletes anything on its own.
- **Web tasks**: drives a real cloud browser; stops for your approval before anything it cannot undo.
- **Apps**: describe a tool and HIVEMIND writes it as a sandboxed mini-app you can pin and use by voice.
- **Dream mode**: overnight it merges duplicate memories and updates out-of-date facts, logging everything it does.
- **Morning brief** (with news on up to four topics), **day brief**, **weekly view**, **Goodnight**, **panels** on the home screen.
→ [04 Autopilot, web tasks, apps](04-autopilot-web-tasks-apps.md)

### Your day
- **Habits** (tick off in the app, by voice, or from the notification; snooze), **birthdays** (with a wish ready to send),
  **reminders**, **routines**, **night check-ins**, **Mission control** (its background workers shown as robots).
- **Career**: paste a job description and get a tailored resume PDF, cover letter and interview prep from your real experience.
- **Map and places**, **music** and **video** search, a daily **Thirukkural**, and **calls**: it answers when you cannot pick up,
  asks who is calling and why, and sends you a one-line summary.
- **Share**: on Android, Share to HIVEMIND reads links, describes photos and files PDFs and Word documents.
→ [05 Daily life](05-daily-life-habits-reminders-career.md)

### Play
- **Nova**, a glowing lantern pet that wanders the screen, plays hide and seek (found by voice), sulks when ignored, dresses
  for festivals and answers to its name.
- **Nova's garden**: a 3D floating island where a flower grows for each day a habit was done, a tree for each four night
  check-ins, a lamp for each lantern walk, a gem for each game won, butterflies for songs played; the sky follows your real
  weather and time of day.
- **Games** (nine board and card games, the Paattu song quiz, a game-night lobby, some playable with friends by one link),
  **Day comic**, **My Wrapped** (your month as story cards), **Journey** (your career walked through in 3D), **Galaxy**.
→ [06 Nova, garden, games and stories](06-nova-garden-games-and-stories.md)

### Friends Theatre
Watch Tamil films, Tamil-dubbed films, anime and cartoons together from one permanent room link: in step, with chat, reactions
and voice, browser to browser, with the films staying on YouTube. About 10,000 videos with genres.
→ [Friends Theatre](friends-theatre.md)

## The app at a glance

- **45 pages** and **98 API routes** (every one listed in the [API reference](api-reference.md) and the page index in
  [07](07-app-shell-pages-and-navigation.md)).
- **Who can reach what**: everything is behind the owner password except sign-in, a few guest doors (call ring and screen, game
  knock, peer proof, relay logins, theatre rooms) and the cron routes, which need a secret.
- **Where your data is**: Supabase (rows and a private bucket), plus a little on your own device (offline cache, the wake word
  and voiceprint, saved preferences). See the "Data" section of each document.
- **What leaves the server**: text sent to the AI providers to answer you (free-tier Gemini may use prompts to improve Google
  products, so do not store passwords or secrets), requests to weather, news, music and video sources, and push messages.

## Reading the documents

Each area document has the same ten sections: what it does, how to use it, how it works (with a file table), API, data,
configuration, security and privacy, limits and edge cases, tests, and **Checked and notes**. The last one is where an area's
open problems are listed; [known-issues.md](known-issues.md) gathers them all in one place.

## Glossary

| Word | Meaning |
|---|---|
| Brain | Your saved notes, memories, documents, photos and projects |
| Memory | A short saved fact, decision, idea and so on, with importance and history |
| Embedding | A list of numbers that stands for the meaning of a text, used for search |
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
| Opener / room code | In Friends Theatre: the browser holding the room, and the permanent link's random code |
