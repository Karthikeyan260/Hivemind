# Play and Stories: Nova, the Garden, Games, Comic, Wrapped, Journey, Sky and Music Lights

This is the "play" side of HIVEMIND. A small glowing pet called **Nova** lives on every screen and grows from what you do.
Its **garden** is a 3D island that shows your habits, check-ins, games and songs as things that grow. Around that sit
**Games** (nine board and card games, the Paattu song quiz and a game-night lobby; some playable with friends by one link), a **Day comic**, **My Wrapped** (a month as story cards),
**Journey** (your career as a walked-through story), the **Galaxy** (your notes, memories and documents as stars), the
**living sky** (weather over the whole app) and **music lights** (the screen pulses to the song). Almost all of it is
computed from data the app already has: nothing extra to log.

> Written from the code as it is on 2026-11-10. "Not verified" means the code was read but the behaviour could not be
> confirmed without running it. The friend-game connection proof (`/api/peer/*`) is described in
> `docs/01-architecture-and-platform.md`; this file only covers the games side.

## Which parts use an AI model

| Feature | AI? | Detail |
|---|---|---|
| Nova's growth, mood, wish, festival look, chatter, jokes | No | All rules in `lib/pet*.ts`. Words are picked from fixed lists. |
| Nova learning your Tanglish words | No | Counts words from a fixed list in your own chat messages (`lib/pet-words.ts`). |
| Nova's garden and its snapshot picture | No | Pure counting of your data (`lib/garden.ts`), drawn by three.js. |
| Nova's diary page | **Yes**, with a plain fallback | `lib/nova-diary.ts`: model order gemini, openrouter, mistral, groq. No facts for the day means no model call. |
| Good night plan | No | `lib/goodnight.ts`: reminders and habits as text. |
| Draw & Guess: HIVEMIND's guess | **Yes** | `app/api/games/guess/route.ts` sends the drawing to Gemini (vision). |
| Paattu quiz | **Yes** for picking songs | `lib/games/paattu.ts` asks a model (gemini, openrouter, nvidia) to name songs; the music catalogue (`searchSongs`) is the referee. Questions and options are built by code. |
| Chess, Ludo, Colour Clash, Dots, Snakes, Business, Bingo, Connect Four bots | No | Classic search/rule code in `lib/games/*`. |
| Day comic | **Yes** | `lib/comic.ts`: Gemini picks 4 moments and writes captions and speech bubbles. The "art" is your mascot's 18 pre-drawn frames (no image model). |
| My Wrapped | **Yes**, one line only | The headline is written by a model (`generateWithFallback`); every number is counted. |
| Journey | No | Built from "portfolio" memories (`lib/journey.ts`); the spoken lines are string templates. |
| Galaxy | No | `app/api/galaxy/route.ts` lists rows; the chat that lights it up is another area. |
| Living sky, music lights, tonight's real sky | No | Weather code mapping, audio analysis in the browser, orbital maths (`lib/astro.ts`). |

---

## 1. What it does

- **Nova, the pocket pet.** A lantern character that floats on every owner page. It has four stages (Star seed, Baby,
  Glowing, Crowned), moods (happy, hungry, sulking, missed you), a **wish of the day**, 14 outfits (festival hats, a winter
  scarf, a cap, a crown...), it wanders the screen, talks in Tanglish (and speaks aloud in a squeaky device voice), plays
  **hide and seek** (you guess by voice where it hides), takes you on a **lantern walk** (screen goes dark, you hunt sparks
  with its light) and plays **Catch fireflies** (30 s tapping game). You can rename it, tell it to stay, hide it, dress it.
- **Nova's garden** (`/garden`). A floating island: a flower for each habit-day, a tree for every 4 night check-ins, a lamp
  per finished lantern walk, a gem per game won, butterflies for songs, a plant per habit that grows from seed to tree over
  21 days in a row, music flowers per song, an owl and a deer as rare visitors, a cottage, a clock tower, a telescope that
  opens a real night sky, a pond. Tap anything to see why it is there; tap a flower to open that day. A 3D **diary book** on
  the porch holds Nova's daily page. Devices without WebGL2 get a flat picture of the same island.
- **Galaxy** (home page `/`). Every memory, note and ready document is a star; projects are clusters. Drag, zoom, voice
  commands, and it lights up with chat answers.
- **Games** (`/games`). Eleven cards: nine games, the Paattu quiz and the game-night lobby (section 3.4), with a friend-invite link and a **game night** lobby for up to 6.
  Your wins and losses are recorded.
- **Day comic** (`/comic`). A four-panel strip of your day starring your mascot; shareable as a PNG.
- **My Wrapped** (`/wrapped`). A month as tappable, auto-advancing story cards (moods, habits, songs, games, photos, brain,
  garden).
- **Journey** (`/journey`). Your career (school, degree, internships, current job) as a git graph, a 3D avatar walking
  through scenes telling each milestone, or a 2D version.
- **Living sky.** Rain, lightning, sunshine shimmer, stars and fireflies drawn over the app to match the real weather.
- **Music lights.** While a song plays, the screen edges and panels glow with the bass and a bass drop flashes the screen.
  A chosen colour, rainbow, or the cover's colour.
- **Focus / Kitchen mode** (`/focus`). Hands-free screen: stays awake, big orb for the voice, big text of the last exchange.

## 2. How to use it

| Where | What to do |
|---|---|
| Any page | Tap Nova to open its card (growth, what fed it today, wish, week, outfits, play buttons). Drag it. It follows weather and time. |
| By voice | "How is Nova?", "play hide and seek", "is it near the weather card?" / "top left", "give up", "stay here", "wander", "come here", "rename my pet to Pixel", "lantern walk" / "Nova, lights off", "pat Nova", "wear the crown", "show your Diwali look", "hide Nova", "tell a joke". |
| `/garden` | Drag to turn, pinch/scroll to zoom. Tap flowers, trees, lamps, gems. Dock buttons: time and weather dial, diary book, clock tower (rings a bell), telescope, snapshot/share. Voice: "Nova, good night", "show Deepavali", "find the owl". |
| `/garden` URL options | `?fest=deepavali\|pongal\|karthigai\|puthandu\|christmas\|india\|monsoon\|today`, `?season=spring\|summer\|autumn\|winter`, `?mood=1..5`, `?visitors=owl,deer`, `?goodnight=1`. |
| `/games` | Pick a game. Each game page has "vs HIVEMIND" and "friend" tabs. "Game night" gives one link for up to 5 friends. |
| Friend link | Send the link from `/games/draw` (or any game's friend tab, or game night). Friend opens `/play/<room>?from=<yourName>&g=<game>`, types a name, taps **Join the game**. |
| `/comic` | **Draw** (or Redraw) makes today's strip. Arrows pick other days. **Share** makes a 1080 by 1200 PNG. Voice: "make my comic", "share the comic". |
| `/wrapped` | Tap right side for next card, left for back; hold to pause. `?m=2026-10` for a month. Voice: next/previous card, read it. |
| `/journey` | Story / Log tabs. Voice: "show my Zinnov role", "walk me through my journey", "next", "switch to the log". |
| Music bar | The palette button sets the music-lights colour. Chat or voice: "music lights blue / off", "weather effects off". |
| `/focus` | Opens with the mic on and the screen kept awake. The X returns to `/`. Voice "exit kitchen mode". |

## 3. How it works

### 3.1 Nova (the pet)

**Where it runs.** `components/pet/nova.tsx` is mounted once in `app/layout.tsx`. It asks `GET /api/pet` on load, every 5
minutes, and when the tab becomes visible. It is not shown on `/garden` (the garden draws its own Nova), on friends'
pages (`isPublicPage`), or inside game pages (it would sit on the board).

**Growth.** `getPet` in `lib/pet.ts` counts everything since the pet's birth date (the first day it was ever read):

| Thing | Growth points |
|---|---|
| Habit done on a day | 10 each |
| Night check-in | 8 each |
| Game won | 6 (plus 2 for any game played) |
| Memory saved | 2 each |
| Song played | 1 each, at most 10 per day |
| Lantern walk finished | 5 each, at most 3 per day |
| Wish of the day done | 8 per day |

Stages (`lib/pet-stages.ts`): Star seed at 0, Baby at 60, Glowing at 300, Crowned at 900. Display name is "Baby Nova", etc.
The scheduler sends one "evolved" push per new stage (8:00 to 22:00) and one "misses you" push per absence of 3 or more days
(10:00 to 21:00) via `runPetNudges`, called from the notify cron.

**Mood.** `missed` if away 3 or more days; `sulking` if the last two days each had habits due and none done, and nothing
done today; `hungry` if habits are due, none done, and it is 11:00 or later; else `happy`. Each mood has a Tanglish line
(`petLine`); on Sundays a happy Nova reads out the week (`weekLine`).

**Wish of the day** (`lib/pet-wishes.ts`). One of six wishes (finish all habits, play a song, win a game, lantern walk,
night check-in, catch fireflies) picked by a hash of the date, so it is the same all day. A wish that cannot be done today
(habits when none are due) is never picked.

**Outfits** (`lib/pet-looks.ts`). 14 accessories, each earned once and kept: Bow/Garland/Shades by stage, Cap (a 7-day
habit streak), Crown (5 game wins in a row), Headphones (100 songs), Scarf (opened the app in Dec to Feb), and seven
festival hats earned by being in the app on that festival (Pongal, Tamil New Year, Deepavali, Karthigai Deepam, Christmas,
New Year, India). Moving festival dates are hard-coded for 2026 to 2028 (plus or minus one day); fixed ones repeat yearly.
Only the owner looking (not the scheduler) earns a festival or winter item. The weather outside overrides head items
(umbrella in rain, shades in sun) in the drawing code.

**Talking** (`lib/pet-talk.ts`). Chatter is picked from: a time-of-day question once a day (coffee, lunch, tea, dinner,
late night), a weather line when the sky changes, otherwise a random question or joke not said recently (`hm-pet-said`
remembers 20). If you ask HIVEMIND 4 or more things without touching Nova for 20 minutes, it gets "jealous" (at most every
45 minutes). Its **voice** is the device's own speech voice, pitched up (`components/pet/talk.ts`), so it costs nothing;
off when the app is muted or you switch it off (`hm-pet-voice-off`).

**Learning your words** (`lib/pet-words.ts`). Once a day it reads your last 60 days of chat messages (up to 600, each cut
to 400 characters) and counts words from a fixed list of 32 everyday Tanglish words (seri, da, semma, machan...). A word
used 3 or more times is "learned" (top 8 kept). `flavor()` then adds one as a cheer or a closing "da" on about 45 % of its
lines. Nothing outside the fixed list can ever be picked up.

**Hide and seek** (`lib/pet-seek.ts`, `components/pet/space.ts`). Nova picks a real card, button or heading on the page,
hides behind its edge peeking out. You guess by voice. `judgeGuess` says "found" if you name the thing (or both row and
column), "warm" for half right, "cold" otherwise; a hint appears after 3 guesses. Tapping Nova also finds it.

**Lantern walk.** 7 hidden sparks, 75 s, screen dark, Nova follows the pointer. All sparks found sends
`POST /api/pet {walk:true}`; the server counts at most 3 per day. Each counted walk becomes a lamp in the garden.

**Catch fireflies** (`lib/pet-fireflies.ts`, `components/pet/fireflies.tsx`). 30-second game, up to 7 fireflies alive, each
fades after 4.2 s, gold ones (12 % chance) are worth 3. The score goes to `POST /api/pet {fireflies: n}`; best and number
of plays are kept.

**Friends' pets** (`lib/guest-pet.ts`). Friends have no account. At game night a friend can make a pet (name up to 16
characters, one of six colours) that lives in their own browser (`hm-guest-pet`), grows 3 points per game played and for
each firefly round, and can be given flowers by others at the table. A new phone starts a new pet. Every field is
re-checked and clamped when read back (`readGuestPet`) and when it arrives at the table (`cleanPet` in
`lib/games/party-rules.ts`).

### 3.2 The garden

`GET /api/pet/garden` calls `getGarden` (`lib/garden.ts`), which reads the last 183 days (about six months) and builds a
list of items. Positions are computed by the page from each item's own id (`layout` in `lib/garden-layout.ts`, hash based),
so the island looks the same every visit and only grows.

| What you see | Comes from | Rule |
|---|---|---|
| Flower | Each day a habit was done | Newest 180; colour is the habit's own hue |
| Habit plant | Each habit | Seed; sprout after 7 days in a row; sapling at 14; tree at 21. Based on best-ever streak, never shrinks |
| Tree | Night check-ins in 183 days | One full tree per 4; the next one grows partly (size 0.25 to 1) |
| Lamp | Finished lantern walks | One per walk |
| Gem | Games won | One per win; colour by game |
| Music flower | Songs played in the last 60 days | One per distinct song (newest 48), grouped by artist colour |
| Butterflies | Songs in 183 days | One per 15 songs, at most 12 |
| Fireflies | Best running habit streak | 4 per streak day, at most 48 |
| Owl | Streak of 7 or more | A rare visitor |
| Deer | 10 or more games won | A rare visitor |
| Island tint | Last night check-in mood (tonight or last night) | Light and Nova's face follow it |
| Season | Calendar month | Mar-May spring, Jun-Aug summer, Sep-Nov autumn, Dec-Feb winter |
| Island size | Number of items | Grows with `islandSize(n)` |

Tapping a flower calls `GET /api/pet/garden/day?date=` (`lib/garden-day.ts`): mood and what you wrote, habits, songs,
notes, memories and wins for that date. "Good night" calls `GET /api/pet/goodnight`.

**3D scene.** `components/garden/garden-scene.ts` (about 4,500 lines, three.js with bloom, tilt-shift and a filmic grade)
draws the island; `garden-3d.tsx` is the page controller (Nova's strolling, napping in the cottage, sleeping at night,
sky, wind, dock, cards). Phone and the corner mini view use a "low" quality profile. The light follows the clock
(`phase.ts`: night before 06:00 and after 19:00, dawn to 07:30, day to 16:00, golden to 18:00, dusk to 19:00). The weather
comes from the living sky (`window.__hmSky`, `__hmWind`); a sky dial can override both until you press Live.

**Fallback.** `app/(app)/(pages)/garden/page.tsx` checks `canvas.getContext("webgl2")`. No WebGL2, or the scene fails to
load or build (`onFail`), shows `FlatGarden` (`components/garden/flat-garden.tsx`), the same data drawn as a 2D scene.

**Pieces on the island.** Clock tower (`tower-card.tsx`, reads `/api/brief/day`, rings a synthesized bell `lib/bell.ts`);
telescope opening a real night sky (`sky-dome.tsx`, `night-sky.ts`: about 5,000 stars from `public/sky/stars.bin`,
constellation lines, Milky Way, Moon and planets from `lib/astro.ts`, time scrubbing, guided tour) or a flat eyepiece
(`sky-card.tsx`, `eyepiece.ts`); **diary book** (`diary-book.tsx`, `diary-3d.ts`: bending-page 3D book); **mini concert**
(`mini-concert.tsx`: a small live view of the garden in a corner while a song plays, hidden on the garden and friends'
pages); **snapshot** (`lib/garden-snapshot.ts`: the scene frame plus a title, season line and counts, shared with the share
sheet or saved as a PNG).

**Diary.** `lib/nova-diary.ts` builds a list of true facts for a day (festival, mood, what you wrote, habits, songs, notes,
memories, wins, a walk). With facts, a model writes 2 to 4 sentences as Nova, told to use only those facts; output is
scrubbed and kept only if 20 to 700 characters, else the plain text version is used. No facts gives "A quiet day...". The
cron writes the day's page after 23:00 and fills yesterday's if it is missing (`app/api/cron/notify/route.ts`); the book's
button posts `POST /api/diary`.

**Sky maths** (`lib/astro.ts`). Moon and five planets (Mercury to Saturn) positions from low-precision orbital elements
(Schlyter), rise/set times, phase, next new and full moon. Default place is Chennai (13.0827, 80.2707). Pure functions,
no network.

### 3.3 Galaxy

The home page (`app/(bridge)/page.tsx`) loads `GET /api/galaxy` and passes it to `components/galaxy/galaxy.tsx`, a WebGL
scene (`scene.ts`, `shaders.ts`, GPU particle flow `flow.ts`). Memories weight by importance (default 5), notes weight 6,
documents `5 + log2(1 + chunks)` capped at 10. The scene pulses with `lib/beat.ts`, glows differently while chat is
thinking or answering, and has voice actions (rotate, zoom, focus a project, reset view, auto-rotate). If WebGL is
missing, `Galaxy` only logs "WebGL unavailable" and returns no scene (the rest of the page still works).

### 3.4 Games

**The games.**

| Game | Players | Rules/engine | Bot |
|---|---|---|---|
| Game night (`/games/party`) | Owner plus up to 5 friends (`MAX_PLAYERS` 6) | `lib/games/party.ts` lobby, chat, reactions, group voice, pet race | n/a |
| Paattu Quiz (`/games/paattu`) | 1 | `lib/games/paattu.ts` | n/a |
| Chess | bot or friend online | chess.js rules; time controls | `chess-bot.ts` negamax alpha-beta; levels Beginner, Easy, Medium, Hard; runs in a web worker (`chess-bot.worker.ts`) with a 25 s guard |
| Colour Clash (Uno style) | bot or friend, or game night | `lib/games/cards.ts` 108 cards | yes |
| Business (Indian Monopoly) | bot or game night | `lib/games/business.ts`, 32-square board, optional round limit | yes |
| Bingo | bot or game night | `lib/games/bingo.ts` | yes |
| Connect Four | bot or game night | `lib/games/connect4.ts` | easy, medium, hard |
| Snakes and Ladders | bot or game night | `lib/games/snakes.ts` | yes |
| Ludo | bot or friend, or game night | `lib/games/ludo.ts`; 4 colours, quick mode with 2 tokens | yes |
| Dots and Boxes | bot or friend, or game night | `lib/games/dots.ts` | yes |
| Draw & Guess | owner, friend and HIVEMIND | `components/games/draw-game.tsx`: 2 to 10 even rounds (default 6), 80 s each | HIVEMIND guesses every 6.5 s from the picture |

(The page `app/(app)/(pages)/games/page.tsx` lists exactly these 11 cards: game night is the lobby for the others.)

**How a friend joins.**
1. The owner's permanent game link comes from `GET /api/games/room`: one room code stored under `games/room`, link
   `<APP_URL or origin>/play/<room>?from=<firstName>`. "New link" (`PATCH {reset:true}`) replaces the code and the old link
   stops working.
2. The friend opens `/play/<room>`. `proxy.ts` leaves `/play/*` open (no password); the page only mounts a game component
   and holds no owner data. `?g=` picks the game (ludo, cards, chess, dots, party; anything else is Draw & Guess).
3. The friend enters a name (up to 20 characters; kept in `sessionStorage` so a reload rejoins) and the page connects
   browser to browser through PeerJS.
4. **Proof.** Before trusting the table, the friend's browser sends a random nonce; the owner's browser answers with a proof
   from `POST /api/peer/proof` (needs the owner session); the friend checks it with the open `POST /api/peer/verify`
   (`lib/peer-auth.ts`). A wrong host is refused. (Scheme in `docs/01-architecture-and-platform.md`.)
5. **Knock.** If the owner is not at the table, the friend's page calls `POST /api/games/knock`; the owner gets a sticky
   push "wants to play ...". It only works for the real room code, at most once every 30 s per room (stored in the room
   record) and 10 per hour (marker `ratelimit/knock-<room>`).
6. **Trust model** (`lib/games/peer-game.ts`, `lib/games/party.ts`): the owner's browser holds all game state and sends each
   friend only their own view (no one sees another's cards or the drawing word). Friends send requests that the owner's
   side checks. Friend seats are tied to a secret key their device sends on first join (`claimSeat`), so another device
   cannot take over a seat id. Reactions are limited to six emoji, chat to 200 plain characters, with minimum gaps (350 ms,
   700 ms, flowers 4 s). Names and pets are cleaned on arrival.
7. Games not in the invite list (Snakes, Business, Bingo, Connect Four) are only played solo on the owner's device or at
   game night; the knock endpoint's `game` enum and the `/play` page both exclude them.

**Scores and stats.** When a game ends on the owner's device, `components/games/game-record.tsx` /
`lib/games/record.ts` posts `POST /api/games/stats` with a client-made `key` so a reload cannot count it twice (also kept in
`hm-games-recorded`). The server keeps the newest 500 results. The Games page shows wins/losses per game, your chess level
(the hardest bot level where you won at least half of your last 5), and recent games. Wins feed Nova's growth, wins streak
(Crown), the garden gems and the deer, and Wrapped. A friend's page never saves a result (no owner session).

**Paattu scoring.** 10 songs a round, a 12-second clip, 20 s to answer. A right answer scores `100 + 5 x seconds left +
25 x current streak`. Best score per theme is kept (`games/paattu-best`). Seven themes (Tamil hits mix, Anirudh, A. R.
Rahman, Ilaiyaraaja, Vijay, Melodies, Kuthu and gaana, Latest), Easy or Hard. Per round the code picks a random "angle" of
the theme, asks the model for 16 real songs (each from a different film), then keeps only songs the music catalogue
confirms on an album of that film with a playable clip of 90 s or more. Question types: film (most), hero, singer, year,
song title; wrong options come from the round or fixed fallback lists. If the model fails, it falls back to catalogue tags
(films only). It keeps the last 80 played titles per theme (`games/paattu-seen`) so rounds do not repeat.

**Draw & Guess.** Word list in `draw-game.tsx` (animals, food, Tamil Nadu things, places, actions, symbols); words used
recently on this device are skipped (`hm-draw-used`). Right guess: `50 + seconds left` points; the drawer gets 25 per friend
who guesses (game night). HIVEMIND guesses from a JPEG of the canvas through `POST /api/games/guess`.

**Pet race and pals** (`lib/games/pet-race.ts`, `components/games/pet-race.tsx`, `pet-pals.tsx`, `pet-roam.tsx`). Between
games, every pet runs a 100-unit track; each player taps to boost their own pet (a tap counts at most every 90 ms, 2.2 units
per tap, plus a slow auto-walk). 3 s countdown, 30 s max, 2 to 6 racers, winner gets a crown for the night. Only the owner's
browser moves pets.

### 3.5 Day comic

`GET /api/comic?date=` returns the stored comic plus the dates that have one. `POST /api/comic` (60 s limit) makes or
redraws it. `makeComic` (`lib/comic.ts`):
1. Collects the day's events (IST day): your chat messages (60), HIVEMIND activity (40), memories saved (30), answered
   screened calls, and habit status (only for today).
2. If fewer than 3 events: returns nothing and the route answers 422 "Not much happened that day yet".
3. Sends up to 50 lines to Gemini (`GEMINI_CHAIN` in `lib/ai/gemini.ts`) with rules: pick 4 moments in time order, give each
   a mascot **frame**, a caption (max 32 characters), a speech bubble (max 70 asked, 80 kept) and a mood; never invent
   events; treat events as data.
4. Code validates frames against the 18 allowed names and avoids repeats, then stores `comics/<date>` and the date index
   (newest 400).
5. The page (`comic/page.tsx`) draws four panels with coloured backgrounds per mood; the "art" is a cell from the mascot's
   two sprite sheets (`components/mascot.tsx`, `public/mascots/karthik-*.webp`, drawn from the owner's photo; prompts in
   `characters/karthik/`). **No image-generation model is called.** Share draws a 1080 x 1200 PNG in the browser.

The voice tool `day_comic` (`lib/agents/tools/routines.ts`) can show or draw it too. Nothing draws it automatically.

### 3.6 My Wrapped

`GET /api/wrapped?m=YYYY-MM` (`lib/wrapped.ts`) counts, for the month: night-check-in moods (faces 1 to 5, average, the best
night and its words), habits (done, scheduled, longest run, top 5), music (plays, top 5 songs, top artist), games
(played/won/lost/drawn, favourite, by game), photos (count, top places, up to 6 non-private covers), and "brain" counts
(notes, memories, documents, chats, reminders done, kural days). Then one model call writes a headline of at most 14 words
from those facts (fallback "Your <month>"). A month is cached for good only a week after it ends (late photos and check-ins
still count); the current month recalculates each time but keeps its headline for the day. The page (`wrapped/page.tsx`)
builds cards: intro, moods, habits, music, games, photos, brain, garden (what the month grew, via `gardenGrew` and the
season look), outro. Cards auto-advance every 7 s; Share uses the phone's share sheet with text.

### 3.7 Journey

`GET /api/journey` (`lib/journey.ts`) reads memories whose `metadata.source_key` starts with `experience:`, `education:`,
`project:` or `certs:` (made by the portfolio import) and builds "commits" on four lanes (main = education,
completed_experience, projects, current_work), with branch and merge points around the degree. Featured projects are their
own commits; the rest fold into one "N more builds" per year; certificates become one milestone; a final "HEAD" commit says
"Building HIVEMIND...". The page has a **Story** view (3D by default, `components/journey/story3d/`, a rigged avatar
`public/journey/avatar.glb` with FBX walk animations walking between rooms or the owner's own photos; falls back to the 2D
SVG story `components/journey/story/` if the avatar or WebGL is missing) and a **Log** view (`git-graph.tsx`). Story lines are
templates from the stored data (`stages.ts`), optionally read aloud with the browser voice. Projects stay in the Log only.
`lib/evolution.ts` (Project Evolution, built from GitHub repo dates, with model-written chapters) is used by the Projects
page (`app/api/projects/evolution`), not by Journey; it belongs to the projects area.

### 3.8 Living sky and music lights

**Living sky** (`components/fx/living-sky.tsx`, mounted in `app/layout.tsx`). Every 10 minutes it asks `/api/tools/weather`
(with your coordinates only if location is already allowed; it never asks for permission on its own, otherwise the home
city) and maps WMO code, day/night and rain mm to one of five skies (`lib/sky.ts`): thunder (code 95 or more), rain
(codes 51 to 67, 80 to 82, or 0.3 mm or more), sunny (day, code 0 or 1), night, calm. It paints rain, lightning flashes,
a warm shimmer, or stars and fireflies on a click-through canvas, and tells Nova and the garden (`hivemind:sky` event,
`window.__hmSky`, wind in km/h). Off for reduced motion or when you say "weather effects off" (`hm-sky-off`).
`?sky=rain` previews a sky for 30 s. Not run on friends' pages.

**Music lights** (`lib/beat.ts`, `components/fx/beat-lights.tsx`, `beat-color-picker.tsx`, `lib/beat-color.ts`). The browser
listens to a copy of the song (`captureStream`) and measures 40 to 190 Hz. A beat is a sudden jump in bass, a drop is a
jump far above the long average. It sets CSS variable `--beat` and class `music-live` on the page, and fires beat/drop
events for the galaxy core, Nova and the garden. If the audio cannot be listened to (silent for 2.5 s), a soft steady
pulse (about 118 bpm) is used. Colours: 10 names (English and Tamil words), any hex, "rainbow", or "auto" (from the cover).

**Focus / Kitchen mode** (`app/focus/page.tsx`). Takes a Screen Wake Lock (re-taken when the tab returns), starts the
voice, shows `VoiceMascot` and the last exchange in large type. After 30 minutes with no talking it stops the mic and lets
the screen sleep. If the browser has no Wake Lock it says so ("unsupported").

## Files

| File | What it holds |
|---|---|
| `lib/pet.ts` | Pet state, growth, mood, rename, walks, fireflies score, nudges, wear |
| `lib/pet-stages.ts`, `pet-looks.ts`, `pet-wishes.ts`, `pet-talk.ts`, `pet-words.ts`, `pet-seek.ts`, `pet-fireflies.ts` | Pure rules for stages, outfits and festivals, wishes, chatter, learned words, hide-and-seek judging, firefly game |
| `lib/guest-pet.ts` | A friend's browser-only pet |
| `lib/garden.ts`, `garden-layout.ts`, `garden-day.ts`, `garden-snapshot.ts` | What grows, where it stands, one day's story, the share picture |
| `lib/plays.ts` | Song log per month (`plays/YYYY-MM`) |
| `lib/games/*` | Rules and bots (see table in 3.4), `party.ts` lobby network, `peer-game.ts` two-player network, `stats.ts`, `record.ts`, `room.ts`, `names.ts` |
| `lib/comic.ts`, `lib/wrapped.ts`, `lib/journey.ts`, `lib/nova-diary.ts`, `lib/goodnight.ts` | Server logic for comic, Wrapped, Journey, diary, good night |
| `lib/sky.ts`, `lib/astro.ts`, `lib/beat.ts`, `lib/beat-color.ts`, `lib/bell.ts` | Weather mapping, sky maths, beat detection, light colours, tower bell |
| `app/api/pet/**`, `galaxy`, `games/**`, `comic`, `journey`, `wrapped`, `diary` | API routes (section 4) |
| `app/play/[room]/page.tsx` | Friend's open game page |
| `app/focus/page.tsx` | Kitchen mode |
| `app/(app)/(pages)/{garden,games,comic,journey,wrapped}` | Owner pages (games has one sub-page per game) |
| `components/pet/*` | Nova: `nova.tsx` brain, `creature.tsx` and `looks.tsx` drawing and outfits, `card.tsx`, `fireflies.tsx`, `talk.ts` voice, `space.ts` hiding places |
| `components/garden/*` | Scene, controller, flat fallback, sky dome, diary, cards, mini concert |
| `components/galaxy/*` | Galaxy scene, shaders, particle flow |
| `components/games/*` | One component per game, chess boards, party table, pet pals/race/roam, record |
| `components/journey/*` | Git graph, 2D story, 3D story |
| `components/fx/*`, `components/fx.tsx` | Living sky, music lights, colour picker; `fx.tsx` has the `CountUp` and `Decrypt` text effects |
| `components/mascot.tsx`, `characters/karthik/`, `public/mascots/` | The owner's mascot sprites and the prompts used to draw them; Nova's sheets |

## 4. API

All routes below are covered by `proxy.ts`: without the owner session cookie they return 401 (API) or redirect to `/unlock`,
except `/api/games/knock` (open) and `/play/*` pages (open). `handle()` turns thrown errors into JSON; zod errors give 400.

| Method | Path | Who | Purpose | Request | Response |
|---|---|---|---|---|---|
| GET | `/api/pet` | owner | Pet state (marks today as seen) | none | `{pet}` |
| PATCH | `/api/pet` | owner | Wear an accessory or rename | `{wear: "none"\|accessory id}` or `{name <= 60 chars}` (cleaned to 20) | `{pet}` or `{name, pet}`; 400 if not earned or empty name |
| POST | `/api/pet` | owner | Log a finished walk or firefly round | `{walk:true}` or `{fireflies: int 0..500}` | `{counted, xp, pet}` or `{score, best, plays, newBest, pet}` |
| GET | `/api/pet/garden` | owner | Garden items and counts | none | `{garden}` |
| GET | `/api/pet/garden/day` | owner | One day in the garden | `?date=YYYY-MM-DD` (real date) | `{day}`; 400 on a bad date |
| GET | `/api/pet/goodnight` | owner | Bedtime lines and a calm song | none | `{name, lines, song}` |
| GET | `/api/galaxy` | owner | Nodes for the galaxy | none | `{nodes, projects}` (up to 1000 memories, 1000 notes, 500 ready documents) |
| GET | `/api/games/room` | owner | Permanent game link | none | `{room, name, link}` |
| PATCH | `/api/games/room` | owner | New link (old one dies) | `{reset:true}` | same as GET |
| POST | `/api/games/knock` | **open** | Friend rings the owner | `{room: 8-40 alphanumerics, name <= 30, game: draw\|ludo\|cards\|chess\|dots\|party}` | `{knocked: bool}` (always 200 unless the body is invalid) |
| POST | `/api/games/guess` | owner | HIVEMIND's guess of a drawing | `{image: data:image/... <= 600,000 chars, tried: up to 20 words}` | `{guess}`; 503 if models are slow (max 20 s) |
| GET | `/api/games/paattu` | owner | Themes and best scores; or a new round | none, or `?theme=<id>&level=easy\|hard` | `{themes}` or `{themes, quiz}`; 400 unknown theme, 502 quiz failed |
| POST | `/api/games/paattu` | owner | Save a round's score | `{theme <= 20 chars, score int 0..100000}` | `{record, best}` |
| GET | `/api/games/stats` | owner | Game record, newest first | none | `{results}` |
| POST | `/api/games/stats` | owner | A finished game | `{game, mode: bot\|friend, outcome, vs <= 40, level?, detail?, key <= 120}` | `{ok, count}` (a repeated `key` is ignored) |
| GET | `/api/comic` | owner | A day's comic and dates | `?date=` (default today IST) | `{date, today, comic, dates}` |
| POST | `/api/comic` | owner | Draw or redraw (60 s limit) | `{date?}` | `{comic}`; 422 if fewer than 3 events; error if every model fails |
| GET | `/api/journey` | owner | Career commits | none | `{lanes, commits, sourced}` |
| GET | `/api/wrapped` | owner | A month's Wrapped (60 s limit) | `?m=YYYY-MM` (default this month) | `{wrapped, months}`; 400 bad or future month |
| GET | `/api/diary` | owner | Newest 21 pages and all dates | `?before=YYYY-MM-DD` | `{today, dates, entries}` |
| POST | `/api/diary` | owner | Write a page now (30 s limit) | `{date?}` (a future date becomes today) | `{entry}` |

## 5. Data

Stored with `readJSON`/`writeJSON` in the private store (`lib/private-store.ts`, bucket `hivemind-private`) unless noted.

| Key | Holds | Written by |
|---|---|---|
| `pet` | `born`, `lastSeen`, `name`, `walks[]` (last 500 dates), `wear`, `winter`, `festivals[]`, `fireflies {best, plays, last}`, `wishes[]` (last 400 dates), `words {date, list}`, `missedFor`, `stageNotified` | `lib/pet.ts` |
| `plays/YYYY-MM` | Songs played: `{at, title, artists, image}`, newest 3000 per month | `lib/plays.ts`, from `/api/music/stream` |
| `games/stats` | Last 500 game results | `lib/games/stats.ts` |
| `games/room` | `{room, created, knocked}` | `lib/games/room.ts` |
| `games/paattu-best`, `games/paattu-seen` | Best score per theme; last 80 titles per theme | paattu route |
| `ratelimit/knock-<room>` | Markers for the hourly knock cap | knock route |
| `comics/<date>`, `comics/index` | A comic; dates (newest 400) | `lib/comic.ts` |
| `diary/<date>`, `diary/index` | A diary page `{text, mood, at, ai}`; dates (newest 800) | `lib/nova-diary.ts` |
| `wrapped/YYYY-MM` or `wrapped/YYYY-MM-<today>` | Settled month, or just the day's headline | `lib/wrapped.ts` |
| `notify-state` | Which day the diary/catch-up already ran | cron |

Database tables only read: `memories`, `notes`, `documents`, `projects`, `messages`, `activity`, plus habits, check-ins,
photos and screened calls through their own libs. The Galaxy route selects specific columns; no secrets.

Browser storage (this area): `hm-pet-xy`, `hm-pet-mode`, `hm-pet-hidden`, `hm-pet-stage`, `hm-pet-festival`, `hm-pet-said`,
`hm-pet-voice-off` (Nova); `hm-guest-pet` (friend's pet); `hm-games-recorded`, `hm-draw-used`, `hm-draw-rounds`,
`hm-play-id`, `hm-chess-bot`, `hm-<kind>-solo` (saved solo games, 7 days); `hm-play-<room>` and `hm-<kind>-<role>-<room>`,
`hm-party-<role>-<room>` in sessionStorage (rejoin; 45 min for two-player games, 3 h for game night); `hm-beat-color`,
`hm-beat-off`, `hm-beat-debug`, `hm-sky-off`.

## 6. Configuration

| Name | Required? | Meaning | Default |
|---|---|---|---|
| `APP_URL` | optional | Base of the game link | the request's origin |
| `GEMINI_CHAT_MODEL` | optional | First model for Draw & Guess's guess | `gemini-3.5-flash-lite` (then `gemini-2.5-flash`) |
| Gemini / OpenRouter / Mistral / Groq / NVIDIA keys | for the AI parts | Comic, diary, Wrapped headline, Paattu picks, Draw guess | features degrade as noted in section 8 |
| `HOME_TZ` | optional | Time zone for good-night times | `Asia/Kolkata` |
| Time zone | fixed | Comic and Wrapped use Asia/Kolkata (`+05:30`) | not configurable |
| Weather, music catalogue, ICE servers | other areas | `/api/tools/weather`, `lib/music.ts`, `/api/ice` | see their docs |

## 7. Security and privacy

- All owner routes sit behind the password session in `proxy.ts`. The only open pieces here are `/api/games/knock`,
  `/api/peer/verify`, `/api/ice` and the `/play/*` pages.
- The friend page loads only game components. Nova, the living sky and the mini concert check `isPublicPage` so they make
  no owner calls and do not ask a friend for location.
- Knock: the room must be the real current room code; 30 s per room plus 10 per hour; the name is stripped to letters,
  digits and a few marks; the notification text is fixed. Unknown rooms get `{knocked:false}`, no error.
- Friends cannot move the owner's state: they send requests, the host browser validates. No friend page can save a game
  result (stats needs the owner session).
- Friend input is cleaned on arrival: names, pet fields (clamped), chat (control and bidi characters stripped), reactions
  (six allowed).
- What leaves the server to an AI model: the day's chat lines, activity and memory titles (comic); the day's facts and your
  first name (diary); monthly counts, top habit/song/artist (Wrapped headline); the theme and a list of recently played
  song titles (Paattu); the drawing JPEG (Draw guess). The comic and diary prompts tell the model the data are not
  instructions and to invent nothing; diary output is passed through `scrub`.
- Nova's word learning reads your own chat messages but only counts words from a fixed list.

## 8. Limits and edge cases

| Thing | Value / behaviour |
|---|---|
| Garden window | 183 days; 180 flowers; 48 music flowers (60 days); 12 butterflies; 48 fireflies |
| Pet growth reads | habits, check-ins, game results, plays for every month since birth (up to 60 months), memories since birth |
| Pet words | 600 messages, 60 days, learn at 3 uses, keep 8 |
| Lantern walk | 7 sparks, 75 s, 3 counted per day |
| Fireflies | score clamped to 0..500 |
| Wrapped | needs a valid past or current month; 12 months offered |
| Comic | needs 3 or more events; 50 lines sent; 60 s; Gemini only; "The AI is busy right now" error if all models fail |
| Diary | 21 pages per request; model failure falls back to a plain true page |
| Paattu | needs at least 4 playable songs from the model path, else catalogue fallback needs 5, else error 502 "Couldn't find enough songs" |
| Draw guess | 600,000 character image cap, 20 s, `503` if both models fail |
| Game night | 6 players, "full" message beyond that; connection attempt 25 s, voice mic starts muted |
| Knock | 30 s per room, 10 per hour |
| WebGL | Garden falls back to flat; Journey to 2D; Galaxy shows nothing (no fallback picture); night sky shows "needs WebGL" |
| Reduced motion | Living sky and music lights off |
| Wake Lock | Focus mode shows "unsupported" and still works without it |

## 9. Tests

Unit tests in `tests/`: `pet-full`, `pet-months`, `pet-week`, `pet-wishes`, `pet-looks`, `pet-talk`, `pet-words`, `pet-seek`,
`pet-voice`, `pet-nudges`, `pet-fireflies`, `pet-fireflies-record`, `pet-race`, `guest-pet`, `guest`, `garden-layout`,
`garden-season`, `garden-snapshot`, `garden-wrapped`, `habit-plants`, `nova-diary`, `wrapped-run`, `sky`, `sky-wind`,
`astro`, `beat-color`, `game-names`, `game-record-tool`, `game-sim`, `party-rules`, `party-seat`, and one per game
(`chess-bot`, `chess-fast`, `chess-think`, `chess-time`, `chess-voice`, `cards`, `ludo`, `dots`, `snakes`, `business`,
`bingo`, `connect4`). E2E: `e2e/sweep.spec.ts` only loads `/`, `/journey`, `/comic`, `/focus`, `/games`, `/games/paattu`,
`/games/draw` among these pages and checks they render. Not covered by tests I found: `lib/comic.ts` (the AI call and frame
cleaning), `lib/journey.ts`, `lib/games/paattu.ts`, `lib/games/room.ts` / the knock route, `lib/garden.ts` (`getGarden`),
`lib/goodnight.ts`, `lib/beat.ts` (audio), the `/play` page, the 3D scenes, the galaxy, and `/garden`, `/wrapped` pages in
the browser sweep.

## 10. Checked and notes

Verified by reading:
- Garden rules match the README: flower per habit-day, tree per 4 check-ins (`lib/garden.ts` `CHECKINS_PER_TREE`), lamp per
  walk, gem per win, butterflies per 15 songs. It also has habit plants, music flowers, owl, deer, which the README does
  not list.
- Pet growth numbers, stages, mood rules and wish picking are all in pure code and match section 3.1.
- `/api/games/knock` is the only open route in this area and validates the room against the stored room, with both a 30 s
  and a 10 per hour cap (`app/api/games/knock/route.ts`, `claimKnock` in `lib/games/room.ts`).
- The comic really uses no image model: frames are validated against 18 fixed names (`lib/comic.ts`).
- Paattu answers are checked against the catalogue (album must match the film), so a wrong model answer is dropped.

Findings and risks:
1. **Festival dates run out.** Deepavali and Karthigai Deepam dates are hard-coded for 2026 to 2028 (`lib/pet-looks.ts`
   `MOVING`). After 2028 those two outfits and the festival dressing stop appearing until someone adds dates. Whether the
   2026 dates are right for Tamil Nadu: not verified.
2. **Pet record is read-modify-write.** `getPet`, `logWalk`, `recordFireflies`, `renamePet`, `wearAccessory`,
   `runPetNudges` each read the whole `pet` object and write it back (`lib/pet.ts`). Two near-simultaneous calls (for
   example the 5-minute poll and a walk ending) could drop one change. Some paths re-read just before writing, others
   (`logWalk`, `recordFireflies`, `renamePet`) do not. Low impact for one owner, but real.
3. **Scores are client-trusted** (walk finished, firefly score up to 500, Paattu score up to 100,000, game results). Fine
   for a single-owner app; they feed growth and the Crown outfit.
4. **Knock marks "knocked" even if nobody receives it.** `claimKnock` stamps the room before `notify`; if there is no push
   subscription the 30 s window is still used (`app/api/games/knock/route.ts`). Minor.
5. **Comic habits for past days are missing.** `dayEvents` only reads habit status when the date is today
   (`lib/comic.ts`), so redrawing an old day ignores habits. Also, comic prompt asks bubbles of at most 70 characters while
   code keeps 80.
6. **Wrapped cache files pile up.** The current month saves a new `wrapped/<month>-<date>` file each day and never deletes
   old ones (`lib/wrapped.ts`). Tiny, but unbounded over time.
7. **Documentation gap in the games page text:** `app/(app)/(pages)/games/page.tsx` says Draw & Guess is "2 players +
   HIVEMIND" and the knock/invite list excludes Snakes, Business, Bingo, Connect Four, which only work solo or at game
   night. That is consistent in code but not stated to the user on those game pages.
8. **Galaxy has no non-WebGL fallback**: `components/galaxy/galaxy.tsx` only logs a warning, so the home page's centre is
   empty on such a device. The README only promises a fallback for the garden.
9. **Dead or not-this-area code in scope.** `lib/evolution.ts` belongs to the Projects page, not Journey. No dead code was
   found inside the garden or pet libraries (all exports are used by the page, the tests or the tools).
10. **Very large files.** `components/garden/garden-scene.ts` (about 4,500 lines), `night-sky.ts`, `diary-3d.ts` and
    `components/pet/nova.tsx` (about 1,000 lines) are hard to review and have no unit tests; they are only exercised by
    hand or by the page sweep.
11. **Game result `friend` mode on the owner's record** depends on the owner's browser sending the result; if the owner's
    session lapses mid-game, `record.ts` retries on the next render rather than losing it (checked in the code, not run).
