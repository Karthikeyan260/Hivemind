# Friends Theatre

Friends Theatre is the part of HIVEMIND where you pick a film (a Tamil movie, a Tamil-dubbed film, an anime episode, a kids'
cartoon), open a room, send one link, and everyone who opens it watches **in step**, with chat, emoji reactions and voice. It
is built to cost nothing to run: the films stay on YouTube (or Wikimedia Commons), the room is **browser to browser**, and the
server only serves the pages and keeps your one permanent room code.

> This document describes the code as it is (last updated 2026-11-10). Numbers such as film counts are a snapshot; the
> commands in [Keeping the catalogue healthy](#10-keeping-the-catalogue-healthy) recompute them.

Contents:

1. [What it does](#1-what-it-does)
2. [Using it](#2-using-it)
3. [How it fits together](#3-how-it-fits-together)
4. [The film catalogue](#4-the-film-catalogue)
5. [Rooms and the permanent link](#5-rooms-and-the-permanent-link)
6. [Keeping everyone in step](#6-keeping-everyone-in-step)
7. [Voice: talking to friends, and controlling by voice](#7-voice-talking-to-friends-and-controlling-by-voice)
8. [Security](#8-security)
9. [Performance](#9-performance)
10. [Keeping the catalogue healthy](#10-keeping-the-catalogue-healthy)
11. [Testing](#11-testing)
12. [Troubleshooting](#12-troubleshooting)
13. [Limits, known weaknesses, ideas](#13-limits-known-weaknesses-ideas)
14. [Reference: constants and messages](#14-reference-constants-and-messages)

---

## 1. What it does

- **A shelf** (`/theatre`, owner only): a streaming-site style page with a featured film, rows by decade and by category,
  a **Genre** filter, search by title, and a **My room** button. About 10,000 videos.
- **Rooms** (`/theatre/<code>`, open to anyone with the link): one film played in step for everyone, play / pause / seek shared,
  chat, six emoji reactions, a "catch up" button, and a voice channel to talk to each other.
- **One permanent room link.** You get one room code that never changes (until you ask for a new one). Send the link once;
  anyone with it can come and go. Whoever opens it first holds the room; if they leave, a friend takes it over, so the link
  keeps working.
- **Hands-free control** in English and Tamil: "play", "pause", "go to 45 minutes", "next episode", "play Mayabazar"...
- **Free to run.** Nothing is re-hosted or stored: YouTube plays the film, the friends' browsers talk to each other.

What it is **not**: a video host (it never copies a film), a chat service with history (messages live only in the open
browsers), or a way to watch films that YouTube won't embed (those open on YouTube with a "start together" countdown).

## 2. Using it

### The owner

1. Open `/theatre` (you are signed in with the HIVEMIND password).
2. Pick a film. Use the category chips (Tamil films, Hollywood in Tamil, Korean, Other Indian languages, World cinema, Anime,
   Kids) and the **Genre** chips (Love & romance, Comedy, Action, Drama, Family, Thriller & crime, Horror, Devotional,
   Fantasy & adventure, Historical). Search finds any title or episode.
3. **Start a screening** (or **Watch together** on the featured film). You land in your **permanent room**.
4. **My room** (top right) shows your permanent link: **Copy link**, **Open my room**, **New link**.
   Send the link to friends once. They can use it every time.

**New link** makes a new code and the old link stops being your room. Use it if the link ever reaches someone it shouldn't.

### A friend

1. Open the link. No password, no account. The join page shows the film.
2. Type a name, press **Join the screening**. Allow the microphone only if you want to talk.
3. Everyone plays the film in step. Use **Change film** to choose another, **Catch up** to jump to where the others are,
   **Voice** to talk, the emoji buttons to react, **Invite** to copy the link.

### Leaving and coming back

Close the tab or press back whenever you like and open the same link again: you are back in. If the person who had opened the
room leaves, one of the friends still there takes the room over within a few seconds and everyone reconnects. If everyone
leaves, the next person to open the link opens the room afresh.

## 3. How it fits together

```text
                      owner (password)                          anyone with the link
                            │                                           │
                   /theatre  (shelf)                          /theatre/<code>  (room)
                            │                                           │
   GET/POST /api/theatre/room                          page.tsx (server) → room.tsx (browser)
      │ the one permanent code                                │       │
      ▼                                                       │       │ loads in the background
 private store (Supabase Storage)                             │       ▼
                                                              │   catalog.ts  ← 5 data files + genres.ts
                                        ┌─────────────────────┴───────────────┐
                                        ▼                                     ▼
                              YouTube / Commons                       net.ts  (PeerJS, WebRTC)
                              plays the film in each                  browser ↔ browser mesh
                              browser's own player                    ▲
                                                                      │ introductions only
                                                          PeerJS broker (0.peerjs.com) + STUN/TURN
```

- **The server is small.** It serves the pages, checks the password for the shelf, and stores one string (the room code). It
  never sees chat, voice, or which film you are on.
- **The browsers do the rest.** Each person's browser connects directly to everyone else's (a "mesh", fine for the handful of
  people a room has). PeerJS's free public broker introduces them; after that the broker is not in the path.
- **The film plays locally** in each browser (YouTube's IFrame player, or a `<video>` for public-domain files). Only tiny
  control messages travel between friends: play, pause, seek, heartbeat, chat, reactions.
- **Voice** is a WebRTC audio call from each talking friend to each other friend.

### Where the code is

| Area | File | What it holds |
|---|---|---|
| Shelf page | `app/(app)/(pages)/theatre/page.tsx` | Hero, rows, category + genre chips, search, voice control of the shelf, **My room** panel, "show N more" rows |
| Room link page (server) | `app/theatre/[room]/page.tsx` | Looks up the film named in the link (`?m=`) and passes just that film to the browser |
| Room page (browser) | `app/theatre/[room]/room.tsx` | Join screen, the room itself: player, chat, reactions, voice, film picker, voice commands, lazy film list |
| Network | `lib/theatre/net.ts` | `TheatreNet`: the whole peer-to-peer layer (roles, takeover, sync, limits) |
| Protocol | `lib/theatre/protocol.ts` | Message types, validation (`parseMsg`), rate limits, size limits, room-code check and generator |
| Room code (server) | `lib/theatre/room.ts` + `app/api/theatre/room/route.ts` | Create, read and rotate the permanent code |
| Catalogue | `lib/theatre/catalog.ts` | `MOVIES`, `GROUPS`, `Movie` type, `movieById` |
| Catalogue data | `lib/theatre/youtube-films.ts`, `dubbed-films.ts`, `anime-films.ts`, `kids-films.ts`, `commons-films.ts` | The films (generated data, one JSON array each) |
| Genres | `lib/theatre/genres.ts` | `GENRE_LIST` and `GENRE_OF` (film id → genres) |
| Players | `lib/theatre/player.ts` | One `Player` interface over `<video>` and YouTube's IFrame API |
| Speech | `lib/theatre/speech.ts`, `lib/theatre/voice-commands.ts` | Browser speech recognition → commands (English, Tamil) |
| Helpers | `lib/theatre/format.ts` | `runtime()` (kept apart so the room page need not load the catalogue) |
| Relays | `lib/ice.ts`, `app/api/ice` | STUN/TURN servers WebRTC uses to get through routers |
| Gate | `proxy.ts` | Which paths need the password (the shelf, the room-code API) and which are open (room pages) |
| Link checker | `scripts/check-theatre-links.mjs` | `npm run theatre:links`: is every film still there? |

## 4. The film catalogue

### Shape

Each film is a `Movie` (`lib/theatre/catalog.ts`):

| Field | Meaning |
|---|---|
| `id` | `yt-<YouTube id>` for YouTube films; a short slug for public-domain films |
| `title`, `year` | Display title; release year or `null` (most films have none: see below) |
| `minutes`, `mb`, `qualities` | Length; for Commons files the file size and the quality list; `0` / `[]` for YouTube |
| `poster` | `https://i.ytimg.com/vi/<id>/hqdefault.jpg`, or a local `/theatre/posters/…` image |
| `page` | The video's own page (YouTube watch URL or Commons page) |
| `yt` | YouTube id, or `null` for a Commons file |
| `channel` | Which channel it comes from (shown as "Plays from the … YouTube channel") |
| `group` | `tamil`, `hollywood`, `korean`, `indian`, `world`, `anime`, `kids` |
| `series`, `ep` | For episodes: the series name and episode number; otherwise `null` |
| `embed` | `true` if YouTube allows it inside the room; `false` for films that only open on YouTube (see "start together") |
| `genres` | Added at load from `genres.ts`; films only (no anime episodes or cartoons) |

`MOVIES` is the five data files joined, sorted newest first (by year, then length). The `Group` type decides the category chips.
The groups mean: **tamil** = Tamil originals; **hollywood / korean / indian / world** = dubbed *into Tamil* (indian = other
Indian languages, mostly Telugu and Malayalam; world = Chinese, Russian, Turkish and so on); **anime** and **kids** are series.

### What is in it (snapshot, 2026-11-10)

About **10,290 entries**, of which about 10,080 play inside a room and about 208 only open on YouTube.

| File | Entries | Group(s) |
|---|---|---|
| `youtube-films.ts` | ~5,720 | tamil |
| `dubbed-films.ts` | ~2,600 | hollywood, korean, indian, world |
| `anime-films.ts` | ~670 | anime (Pokémon, One-Punch Man, Attack on Titan, Mob Psycho 100, Spy×Family, Classroom of the Elite…) |
| `kids-films.ts` | ~1,260 | kids (Bluey, Chhota Bheem, Motu Patlu, Little Singham, Mickey Mouse Clubhouse…) |
| `commons-films.ts` | 34 | tamil (public-domain classics streamed from Wikimedia Commons) |

### Where the films come from, and the licensing caveat

Films come from YouTube channels, found by reading each channel's complete upload list and keeping only full-length videos
whose title says Tamil, that YouTube lets an outside page embed (oEmbed answers 200), and that are not already in the catalogue.
The page tells users that a channel may remove a film or restrict it by country at any time.

The channels fall into three kinds, and the difference matters:

1. **Studio, label and broadcaster channels**: Ayngaran, Rajshri Tamil, Raj Television, Pyramid Talkies, J Movie Official /
   Jaya TV, Bayshore Records, Divo Movies, Super Good Films, Eros Universe, KalaignarTV, Zee Movies Tamil, Polimer TV,
   Sun NXT Free Movies, Winner Audios, Sony Pictures Entertainment - Tamil, Thanthi One, Muse India, Pokémon Asia Official
   (Tamil), Crunchyroll India, Disney India Tamil, Pogo, Cartoon Network India, Sony YAY! Tamil, Bluey Tamil and similar.
   These are the rights holders or their official Tamil channels.
2. **Studio-like channels** (names that read like a producer or distributor, usually verified): RJS Movies, RJS Cinemas,
   NH Studioz Tamil, Realcinemas, Kyra Talkies, Tick Movies - Tamil, Tamil Movieplex, Thamizh Padam, DD Movies, Comedy One,
   Pyramid Comedy Clips, VR Films and Studios Tamil, Super Good Studios, Dimension Pictures Tamil, Supercluster Productions,
   Haris Films Tamil.
3. **Aggregators, licences unverified**: Bicstol, Classic Movies, SpeedTamil Online Movies, IOF - Tamil, NTM Cinemas,
   Tvnxt Tamil, Tamil cinema, WAM Tamil Movies, World Cinema Tamil, Chauhan Films, TRP Entertainments, Hit Movies,
   Classic Cinema, Cinema Classicss, 4K Cinemas, Mass Scene Central, 7th Channel Movies, Dream Cinemas, VS Tamil Cinemas,
   Tamil Talkies, Tamil Comedy Full Movies, Fun Movies, Ultra Cinema, Vicky Cinemas HD, Video Park Tamil, NH Tamil Movies,
   Haris Cinemas / Movies.

**Nothing in the code can verify that a channel is licensed to upload what it uploads.** A verified badge or a studio-sounding
name proves nothing. The third group was added at the owner's request with that risk understood; its films can disappear or be
blocked without notice. To drop a channel, see [Removing a channel](#removing-a-channel).

The 34 public-domain films are different: they stream straight from Wikimedia Commons (classics listed as public domain),
with local poster images under `public/theatre/posters/`.

### Titles, years and genres (how good the data is)

- **Titles** were cleaned automatically from long YouTube titles (cast names, "Full Movie", "HD" removed). Some are off.
- **Years**: only films whose YouTube title had a year in brackets, or an exact Wikipedia match, have one (about 20%). The
  shelf's year rows therefore hold few films; the rest sit in "More from the studio channels". Years from Wikipedia matched by
  title can be wrong when several films share a name (two were corrected by hand).
- **Genres** (`genres.ts`) were assigned by AI agents from the title, year, cast and any genre words in the original YouTube
  title, **not** from a database. Each film has 1 to 3, primary first. Expect mistakes, especially for obscure films.
- **Embedding**: `embed: false` films (Sony Pictures' own Tamil channel) cannot play inside a room; the room opens them on
  YouTube with a countdown so everyone presses play together.

### Data hygiene

`tests/theatre-security.test.ts` enforces on every film: ids are plain; every URL is `https` on an expected host
(`i.ytimg.com`, `www.youtube.com`, Wikimedia) or a local poster; titles and channel names contain no control, zero-width or
direction-flipping characters and no `<` `>`. Zero-width joiners are allowed (Tamil script and emoji sequences need them).

## 5. Rooms and the permanent link

### The room code

- A code is **16 random letters and digits** (about 95 bits), made by `newRoomCode()` from the platform's secure random source
  with rejection sampling, so every character is equally likely.
- A code is valid if it is 8 to 40 letters or digits (`ROOM_CODE`), nothing else. The room page refuses anything else with
  "This link doesn't look right", because the code becomes part of a public broker id.
- The owner's code lives in the private store (Supabase Storage bucket `hivemind-private`, file `theatre-room.json`, key
  `theatre-room`) through `lib/theatre/room.ts`. `getRoomCode` returns it (making one on first use and replacing any stored
  value that is not a valid code); `rotateRoomCode` makes a new one.
- `GET /api/theatre/room` → `{ "code": "..." }`; `POST /api/theatre/room` rotates and returns the new code. Both reply with
  `Cache-Control: no-store`. The path is **not** in the proxy's open list, so the password gate covers it (401 without a session).
- The shelf's **Start a screening** and **Open my room** always use this code (a random one only while it is still loading).
  The link is `https://<your site>/theatre/<code>`; an optional `?m=<film id>` is the film the page shows first (on the join
  screen and as the starting film; once connected, everyone follows the film the room is on), and `&host=1` just tells the page
  the owner is the one visiting (it changes the Leave button and the join page wording; it has no effect on the network).

### Who holds the room

There is no host by birth. Every browser that enters the room first tries to claim the PeerJS id `hm-theatre-<code>`:

- **Got it → you are the opener.** You introduce newcomers to each other, tell them where the film is, and send a heartbeat.
- **Taken → you are a friend.** You get a random id of your own and connect ("knock") to the opener, and again every few seconds
  while you are not connected to one.

Friends are all connected to each other, not just to the opener, so a room survives the opener leaving.

### Leaving, rejoining, takeover

| Situation | What happens |
|---|---|
| A friend closes the tab | The tab announces it (`pagehide` → `destroy()`), so the others see "X left" at once. |
| A friend's network dies (closed laptop, killed app) | The WebRTC connection is watched; once it has been down for 6 s it is dropped (about 10 s in all). |
| The opener leaves | Each friend sees the connection to the opener close, waits a short random time (under 1.5 s), and tries to claim the room id with a second peer. One wins and becomes the opener; its old connections close and everyone re-knocks on the room id. The others keep their place in the film. |
| A takeover attempt gets no answer from the broker | It is abandoned after 12 s and tried again on the next knock, so one stuck attempt can't block the room. |
| The broker drops us (sleep, a network blip) | `peer.reconnect()` asks for our id back so newcomers can still find us. |
| Everyone leaves | The room id is freed; the next person to open the link becomes the opener and the room starts afresh. |
| The returning opener | Joins the new opener as a friend (the id is taken) and is brought to where the film is. |
| The broker still holds a dead opener's id for a while | Friends keep knocking; after two missed knocks they try to claim, and succeed once the id is free. |

When you take a room over, the film keeps its place because you already knew where it was. When you open a brand-new room you
may not (see "A new opener decides what to believe" below).

### Joining

1. The server page (`page.tsx`) finds the film named in `?m=` and passes **only that film** to the browser, so the join page
   needs none of the 10,000-film catalogue.
2. `room.tsx` shows the join screen with a name field. Meanwhile it loads the full catalogue in the background
   (`import("@/lib/theatre/catalog")`).
3. Pressing **Join** does not wait for the catalogue. Until it arrives the room knows only the film in the link; a message
   about another film is ignored, and the opener repeats where the film is every 4 seconds, so the room catches up by itself.
4. Pressing Join is also the user gesture the browser needs to allow sound.

## 6. Keeping everyone in step

### Messages

All traffic between friends is these small JSON messages (`lib/theatre/protocol.ts`):

| `t` | Fields | Meaning | Who may send it |
|---|---|---|---|
| `hello` | `name` | "I am X" (sent on connecting, and answered once) | anyone |
| `peers` | `list` of ids | The opener introduces everyone to a newcomer | **opener only** |
| `hb` | `movie`, `time`, `playing` | Heartbeat: where the film is, every 4 s | **opener only** |
| `state` | `movie`, `time`, `playing` | The answer to "where is the film?" | the opener, or a friend that was just asked |
| `ask` | | "Where is the film?" (Catch up) | anyone |
| `play` / `pause` / `seek` | `time` | Someone pressed the player's button | anyone (by design) |
| `movie` | `id` | Someone picked another film | anyone (by design) |
| `chat` | `text` | A chat line | anyone |
| `react` | `e` | One of six emoji | anyone |
| `count` | | "Start together" countdown (films YouTube won't embed) | anyone |

Play, pause, seek and film choice are open to every member on purpose: it is a room of friends. The security section covers
what that means.

### Staying in step

- A person pressing the player's own controls sends `play` / `pause` / `seek` with the time; everyone else applies it.
- The page ignores the player's own events for about 0.9 s after it changed the player for a friend, so a remote change is
  never echoed back as a new one.
- The opener's **heartbeat** (every 4 s) lets drifting players catch up: a difference over 1.2 s seeks, and playing/paused is
  matched.
- **Catch up** sends `ask`; friends answer with `state`.
- **Newcomers**: the opener sends `peers` (so the newcomer connects to everyone) and `state` (so they land on the right
  film and second).

### A new opener decides what to believe

A browser that has just opened an empty room does not know where "the film" is, and friends already watching (for example
after the opener refreshed the page) may be about to knock. It therefore does not speak for the film at first:

1. For each newcomer it sends `ask` and waits 2.5 s for answers, keeping every answer (including "I'm at 0:00").
2. If **nobody has anywhere real to be** (everyone is at the start, paused), it is a new room: the opener speaks for the
   film and sends its own state.
3. Otherwise it believes the place that **most answerers agree on** (same film, within 15 s of each other), but **only if that
   is more than half of all answerers**. A friend at 0:00 counts as a vote against a forged place.
4. If the answers split evenly it **believes nobody and says nothing about the film** until a later newcomer settles it.
5. It begins sending heartbeats once it has decided, or after 6 s at the latest, unless step 4 happened.

A **lone** answerer is believed (there is no one to compare with). Taking a room over after the opener leaves skips all of this:
the new opener was a friend and already knows where the film is.

### Films that can't be embedded

For `embed: false` films the room can't control the player. It shows a **Start together** button: pressing it sends `count`,
everyone sees a 5-4-3-2-1 countdown, and everyone presses play on YouTube at the same moment. Chat and voice work as usual.

## 7. Voice: talking to friends, and controlling by voice

### Talking (WebRTC audio)

**Voice** turns the microphone on and calls each other friend over the same peer connections (`peer.call`). Anyone who joins
while you are talking is called automatically. The microphone is only opened when you press the button, with echo cancellation,
noise suppression and automatic gain. Turning it off stops the tracks and closes the calls.

### Relays

WebRTC sometimes cannot connect directly (two devices on one network, a phone on mobile data, a strict router). `lib/ice.ts`
lists STUN servers (Google, Cloudflare) and free TURN relays (PeerJS's own and a public relay that also works over TCP/443).
A relay carries encrypted media/data and cannot read it. To use your own relay set `NEXT_PUBLIC_TURN_URL`,
`NEXT_PUBLIC_TURN_USER`, `NEXT_PUBLIC_TURN_PASS`, or have `/api/ice` return Cloudflare / Metered logins (the page asks for them
when it opens).

### Controlling by voice (English and Tamil)

`lib/theatre/speech.ts` uses the browser's own speech recogniser (Chrome, Edge, Safari; Firefox has none) in English (India)
or Tamil, only while the mic button is on. Nothing is recorded or sent by HIVEMIND. `lib/theatre/voice-commands.ts` turns the
recognised text into a command; text that is not a command does nothing, so the film never jumps because someone coughed or
the film's own dialogue was picked up.

Inside a room: "play", "pause", "forward", "back 30 seconds", "go to 45 minutes", "restart", "volume up / down / 40", "mute",
"unmute", "full screen", "next episode", "previous", "play Mayabazar" (picks that film), "catch up", "invite", "say that was
great" (sends it to chat), "laugh / clap / heart / wow" (reactions), "mic on / off", "quality 480p", "leave". Tamil equivalents
work too ("நிறுத்து" for pause, "தேடு" for search on the shelf).

On the shelf: "search Mayabazar", "show kids cartoons / anime / Hollywood / Korean / all", "play Ben 10" (opens it), "start"
(starts the screening), "close", "clear", "back".

Tests can speak without a microphone: a `hm-theatre-voice` page event carrying the text is handled like a recognised phrase.
(That is also a hook for a switch or keyboard shortcut.)

## 8. Security

### The model

- A **room link is a secret that is public to everyone who holds it**. Whoever has it can join, chat, talk and control
  playback. The room is open on purpose: no password, no account. It shows only the room, never any of your data.
- The **owner's pages and APIs stay behind the HIVEMIND password** (`proxy.ts`). Only room pages (`/theatre/…`), `/api/ice`,
  `/unlock` and a few others are open. `/api/theatre/room` and the shelf are not.
- Everything that arrives from another browser is **hostile until checked**: the link can be shared, and anyone with it can
  open a connection and send whatever they like.

### Controls

| Risk | Control |
|---|---|
| Guessing a room | 95-bit random code; only plain 8–40 character codes accepted |
| Reading or changing the owner's code | Password gate (401 otherwise, any method, forged cookie, wrong origin); `no-store`; session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production |
| A leaked link | **New link** rotates the code; the old one is just an empty room |
| Hostile messages | `parseMsg` copies only known fields, checks types, finite numbers within 0–24 h, film ids against the catalogue, emoji against the six offered, and drops everything else; a throwing or circular object is dropped, `__proto__` never reaches the app |
| Text tricks | Names (24 chars) and chat (400) are cleaned of control, zero-width and direction-flipping characters and capped; the page shows them as text, never HTML |
| Huge inputs | Text is cut to 8× its limit before cleaning; only the first 32 entries of a list of friends are looked at |
| Floods | Per sender and per message kind (table in [section 14](#14-reference-constants-and-messages)); plus a **raw guard** per connection: over 1,500 messages or 4 MB in 10 s drops the connection (this also covers junk PeerJS itself chokes on, such as a literal `null`) |
| Filling the room | At most 12 connections; newcomers beyond that are turned away; a new one is accepted again when someone leaves |
| Steering who we connect to | `peers` is accepted only from the opener, and an opener ignores it; at most 8 valid ids per message |
| Faking the film's place | `hb` only from the opener; `state` only as the answer to a question we put to that very friend, once, within 10 s; a new opener *votes* on answers (section 6); late answers after the decision are ignored |
| Dead connections | WebRTC state watched: failed/closed drops at once, disconnected after 6 s |
| Clickjacking, sniffing, indexing | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `noindex`, HSTS, `Referrer-Policy: strict-origin-when-cross-origin` (the room code never leaves in a Referer to another site), `Permissions-Policy` limiting microphone and location to this site |
| Third parties | A room page calls no other site until someone presses Join (only the invite's poster image loads); no cookie is set for a room visitor |
| Path tricks | `/theatre/..%2F..%2Fetc%2Fpasswd`-style URLs reach nothing (the live host refuses them with 400) |
| Catalogue | Data-hygiene test above; every URL `https` on an expected host |

### Residual risks (known, accepted)

- **Link holders control playback.** Play, pause, seek and film choice are open to everyone in the room. That is the point of
  the feature; the link is the only gate. Rotate it if it leaks.
- **A lone answer is believed by a brand-new opener**, so someone who is the only other person in a freshly opened room can set
  where the film starts.
- **The broker is a dependency.** PeerJS's free broker (`0.peerjs.com`) introduces everyone. If it is down, new people cannot
  join (people already connected carry on). The broker sees ids and connection setup, not messages, chat or voice.
- **The public TURN relays** carry encrypted traffic and use shared, public credentials.
- **Films come from third-party channels** whose licences cannot be verified (section 4).
- **`/api/ice` is open** (a friend needs relay logins); if you configure a paid relay there, anyone can fetch short-lived logins.
- The password gate itself is not exercised with a real login by the automated tests (see Testing).

## 9. Performance

- **Catalogue size.** About 10,000 films ship as one script, roughly 470 KB compressed (3.3 MB unpacked). It is loaded by the
  shelf, and by the room page **in the background** (never in its first scripts). Further growth will make this heavier; the
  next step would be serving the catalogue from the server in pages.
- **Rows.** The shelf shows 30 films per row with a **Show N more** button; search shows the first 150 matches; the room's film
  picker shows the first 200 films and searches the rest.
- **Joining.** A friend gets into a room without waiting for the catalogue. Measured on the live site from a fresh browser:
  about 0.7–1 s on a normal connection, about 2–3 s on a 4G phone with a slow CPU, about 5 s on slow 3G. The remainder is the
  page's own script loading; the first tap can be lost until it has loaded.
- **Network.** A room of N people has N·(N−1)/2 connections; the cap is 12 connections per browser, and rooms are meant to
  be small.

## 10. Keeping the catalogue healthy

### Is every film still there?

```bash
npm run theatre:links            # asks YouTube's oEmbed about every embeddable film, and Wikimedia Commons about the public-domain files
node scripts/check-theatre-links.mjs --youtube    # only the YouTube films
```

It prints each film that has gone (or can no longer be embedded) and exits non-zero if any did. Run it now and then (about
10,000 requests; it takes some minutes). Fix a broken film by deleting its entry from the data file.

### Counting and inspecting

```bash
# films per channel
node -e 'const fs=require("fs");const by={};for(const f of ["youtube","dubbed","anime","kids","commons"]){const s=fs.readFileSync("lib/theatre/"+f+"-films.ts","utf8").replace(/\r\n/g,"\n");for(const m of JSON.parse(s.slice(s.indexOf("= [")+2,s.lastIndexOf("];")+1)))by[m.channel||"Commons"]=(by[m.channel||"Commons"]||0)+1}console.log(Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([c,n])=>n+"  "+c).join("\n"))'
```

### Removing a channel

Every data file is `export const NAME: Movie[] = [ …JSON… ];`. To remove everything from one channel, load the array, filter
it on `channel`, and write it back with the same layout (`JSON.stringify(list, null, 1)` between the brackets, keeping the
file's line endings). Also remove the ids from `lib/theatre/genres.ts` (an id without a film is harmless but untidy).
Run `npm test` afterwards (the catalogue tests check ids, links and counts).

### Adding films (how the catalogue was built)

The scripts used were one-off and are not kept in the repo; the method is:

1. **Find channels.** Search YouTube for Tamil full-movie and dubbed-movie queries (genres, actors, decades, studios, Tamil
   script) and group the long videos (over about 70 minutes) by channel; judge each channel's identity (section 4).
2. **Read a channel's complete upload list.** Use the channel's *Videos* tab through YouTube's internal `browse` call with
   continuation tokens (the first token in each response is the next page); the search page alone stops after ~30 results.
3. **Filter.** Keep videos of at least 70 minutes (episodes: 8 minutes) whose title says Tamil or is in Tamil script and says
   "movie/film"; drop songs, scenes, trailers, interviews, episodes, shorts, reviews, other-language dubs.
4. **Clean titles.** Take the first fragment (split on `|` and ` - `) that is not a cast list, with cast names and tags such as
   "Full Movie", "HD", "4K" removed; Tamil-only fragments are skipped; ALL-CAPS titles are title-cased.
5. **De-duplicate** by normalised title against the catalogue and across channels (preferring studio-like channels).
6. **Check embedding** with `https://www.youtube.com/oembed?url=…`: 200 = embeddable (401 = Sony-style "open on YouTube").
7. **Choose a group** (tamil, or for dubs hollywood / korean / indian / world from the title and channel).
8. **Write the entries** into the right data file in the existing layout, then give each film genres, run `npm test`, build
   and run the browser tests, and run `npm run theatre:links` occasionally.

Series entries (anime, kids) set `series` and `ep`, and are titled `Series · Episode N`.

### Genres for new films

`genres.ts` maps film id → genre ids. For a batch of new films, the genres were produced from each film's title, year, cast and
original YouTube title. The allowed ids are `romance`, `comedy`, `action`, `drama`, `family`, `thriller`, `horror`,
`devotional`, `fantasy`, `historical`. A test requires every non-anime, non-kids film to have a valid genre.

## 11. Testing

### Unit tests (`npm test`, vitest)

| File | What it checks |
|---|---|
| `tests/theatre-catalog.test.ts` | Counts per group, unique well-formed ids, required fields, Commons films, every film has a valid genre |
| `tests/theatre-protocol.test.ts` | Message validation, text cleaning, room codes, rate limiter, new-code randomness |
| `tests/theatre-room.test.ts` | The permanent code: stable, rotates, refuses a corrupted stored value |
| `tests/theatre-voice.test.ts` | Every voice phrase (English and Tamil) and the shelf commands |
| `tests/theatre-net-security.test.ts` | `TheatreNet` against a fake PeerJS and a hostile peer: hostile messages, floods, the connection cap, opener-only messages, answer rules, voting, takeover and retry, dead-connection watchdog, raw-traffic guard |
| `tests/theatre-security.test.ts` | Room-code strictness, input-size bounds, the catalogue data rules, the proxy gate, the room-code API |

Each protection in `net.ts` and `protocol.ts` was proven by undoing it and seeing a test fail.

### Browser tests (Playwright)

| File | What it checks |
|---|---|
| `e2e/theatre-rejoin.spec.ts` | Six leave/rejoin scenarios: a friend leaves and returns; the opener leaves and a friend takes over; a newcomer after the opener left; three people when the opener leaves; everyone leaves and the link reopens the room; the film keeps its place |
| `e2e/theatre-security.spec.ts` | Headers, URL tricks, no third-party calls before joining, the locked room-code API, and a real hostile peer inside a live room |
| `e2e/theatre-safety-voice.spec.ts` | What a friend's page asks the server, locked owner data, markup shown as text, a second tab can't take the room, and voice control |
| `e2e/theatre-lazy.spec.ts` | A friend gets in before a slow film list arrives, then follows the opener's film |
| `e2e/theatre.spec.ts` | Shelf locked, two browsers stay in step, YouTube player, "start together" countdown |

### How to run them

Run browser tests against a **production build on port 3100**, not a dev server you are using:

```bash
npm run build
E2E_PORT=3100 npx playwright test e2e/theatre-*.spec.ts --project=desktop \
  --grep-invert "shelf is run by voice|shelf shows the sections"
```

Playwright starts `next start -p 3100` itself (with a test password). The two excluded tests sign in with the password; avoid
them if tests that log in have caused trouble for the owner's own session. The two-browser tests need PeerJS's free broker and
skip without it. To run against the live site, use a throwaway Playwright config with `baseURL` set to the site and no
`webServer`.

### Debugging

- Set `window.__theatreDebug = true` in the page (the tests do when `E2E_DEBUG=1`) to log every connection, message and
  decision to the console as `[theatre]`.
- `E2E_DEBUG=1` also prints each test browser's console and when its tab closes.
- A one-off failure of a two-browser test was usually the network or the broker; re-run it with `--repeat-each` before
  changing code.

## 12. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| "This film won't play here" / blank player | The channel removed it, blocked embedding or restricted it by country | `npm run theatre:links`; delete the entry |
| Friends can't join, "Couldn't open the theatre" | PeerJS's free broker is down or blocked | Try again later; check `https://0.peerjs.com/` |
| Joining works but no voice | Microphone blocked, or a strict network and the relays are down | Allow the mic; add your own relay (section 7) |
| Opener left and the room seems dead | Friends take over within about 10–15 s; if the broker still holds the old id it can take longer | Wait; everyone re-knocks automatically |
| "This link doesn't look right" | The code isn't 8–40 plain letters/digits | Copy the link again from **My room** |
| Link leaked | — | **My room → New link**, then send the new link |
| Shelf slow on a phone | Large catalogue script | Section 9 |
| Voice control does nothing | Firefox has no speech recognition; or the mic is blocked | Use Chrome, Edge or Safari |

## 13. Limits, known weaknesses, ideas

- **Rights.** The catalogue's licence status cannot be verified for many channels (section 4).
- **Years and genres are approximate**; most films have no year.
- **Rooms are small.** A full mesh is fine for a handful of people; the cap is 12 connections per browser.
- **No history.** Chat is not stored; a friend who joins late sees only new lines.
- **The first-seconds rule** (a lone answer is believed) and **members controlling playback** are design trade-offs (section 8).
- **The catalogue ships as data in the app.** At this size the next step is to serve it from the server in pages, with
  server-side search and genre filtering.
- Ideas: fill in release years from a film database, a "who is in the room" list with kick/lock for the owner, room
  passwords as an optional second factor, per-channel switches in the shelf, and a proper import script kept in `scripts/`.

## 14. Reference: constants and messages

### Limits (`lib/theatre/protocol.ts`, `lib/theatre/net.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `MAX_NAME` / `MAX_CHAT` | 24 / 400 characters | Name and chat length |
| `MAX_PEERS` | 8 | Ids accepted per `peers` message |
| `MAX_CONNS` | 12 | Connections one browser will hold |
| `MAX_TIME` | 86,400 s | A time past a day is garbage |
| `ROOM_CODE` | 8–40 letters/digits | Valid room code |
| Beat | 4 s | Heartbeat, and how often a friend knocks again |
| Grace | 6 s | A new opener's wait before it may send heartbeats |
| Ask window | 2.5 s | How long a new opener collects answers |
| Answer lifetime | 10 s | An answer counts only this soon after the question |
| Knocks before claim | 2 | Missed knocks before a friend tries to take the room |
| Down grace | 6 s | A "disconnected" connection is dropped after this |
| Claim timeout | 12 s | A stuck takeover attempt is abandoned |
| Raw guard | 1,500 messages or 4 MB per 10 s | A connection beyond this is dropped |

### Rate limits per sender (messages allowed per 10 s)

`hello` 3 · `peers` 3 · `state` 10 · `hb` 10 · `ask` 6 · `count` 4 · `play` 20 · `pause` 20 · `seek` 20 · `movie` 6 ·
`chat` 10 · `react` 20.

### Reactions

😂 👏 ❤️ 😮 😢 🔥 (`REACTIONS`; anything else is dropped).

### Environment

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | The password gate (required in production; the shelf and room-code API are behind it) |
| `NEXT_PUBLIC_TURN_URL`, `_USER`, `_PASS` | Your own TURN relay for voice and hard networks (optional) |
| Supabase variables | Used by the private store that keeps the room code |

### Routes

| Route | Access | Purpose |
|---|---|---|
| `/theatre` | password | The shelf |
| `/theatre/<code>` | open | A room |
| `/api/theatre/room` | password | `GET` the permanent code, `POST` for a new one |
| `/api/ice` | open | Relay logins for WebRTC |
