# The Brain and the AI Layer

The "brain" is everything HIVEMIND remembers for you: **notes**, **memories**, **documents**, **photos** and the **projects** they are filed in. The "AI layer" is the code that reads, labels, searches and answers from that material, using Gemini first and NVIDIA, OpenRouter, Mistral and Groq as back-ups. This file covers saving, searching, filing, answering ("Ask My Brain"), importing, sharing, exporting, the chat history store, the language rule, and how the AI providers fall back when one is down.

> This describes the code as it is (read 2026-11-10). Nothing was run: every statement comes from reading the files listed in section 3.

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
10. [Checked and notes](#10-checked-and-notes)

---

## 1. What it does

- **Notes.** Longer text you write or dictate. On save the AI adds a title (if you left it empty), a one or two sentence summary, a category and tags, and a search vector. Notes can be edited and deleted. A note is one vector, not chunks.
- **Memories.** Short facts, ideas, decisions. Each has one of **8 types** (`fact`, `knowledge`, `experience`, `decision`, `idea`, `preference`, `project_context`, `learning`), an **importance** 1-10, a **confidence** 0-1, a category, tags and an optional project. Editing the words saves the old words as a **version**; any version can be **restored**. A memory has a **history timeline**, a **source label** ("Saved in HIVEMIND", "Portfolio MCP import", ...) and a **Connections** panel (nearest notes, memories, documents, projects and skills).
- **Documents.** PDF, TXT, Markdown, DOCX, CSV up to 4 MB. The text is cut into chunks of about 1200 characters (PDF chunks keep their **page number**), each chunk is embedded, and the file gets an AI summary.
- **Photos.** Phone photos described by the AI (title, 2-3 sentences, 8-15 tags, readable text), with the **date taken** and **place** read from the photo's own GPS. Found later by words ("Ooty trip", "birthday cake", "beach last December"). A **private** switch keeps a photo away from the AI.
- **Projects.** Named piece of work. Notes, memories and documents are filed into them, by you or automatically. Project page lists what is filed; the Projects page has a 3D "showcase" (reel) and a list.
- **Search.** `/search`: search by meaning across notes, memories and documents, optionally inside one project. Falls back to plain word matching when the embedding model is down.
- **Ask My Brain.** The console on the home page (`/`). You type or speak; a router picks a specialist agent; the Knowledge agent searches the brain and answers with numbered citations `[1] [2]` that link to the source. A project can be "focused" to restrict answers to it.
- **Chat intents.** "remember that ...", "update my memory about ...", "forget ...", "add milk to my shopping note", "show me the Ooty photos" are routed to the Memory agent, which uses real tools. Deletes need two steps (ask, then your "yes").
- **Auto-filing (the organizer).** After a note, memory or document is saved with no project, an AI call may file it into an existing project or create a new one. Everything it does is in the **activity log** with **Undo**.
- **Profile.** HIVEMIND keeps a short "what I understand about you" summary (skills, focus areas, goals), rebuilt from your top memories, projects and notes.
- **From your brain (resurface).** The morning card shows one old memory per day.
- **Sources.** Sync your portfolio (MCP server or GitHub data) into memories, projects and a resume document; import public web pages. LinkedIn cannot be read; the page says how to upload a PDF instead.
- **Share to HIVEMIND.** Android Share menu or the `/share` page: a link, text, photo or file is summarised and saved. A date seen in a shared photo can be offered as a reminder.
- **Export.** One JSON file of everything (no vectors, no secrets).
- **Language.** Settings choice: Match me / Tamil / English; shapes every chat and voice reply.
- **Embedding model switch.** Settings (System check) can re-embed the whole brain with another embedding model.
- **Activity feed and undo** on the home page; **signed-in devices** list in Settings.

## 2. How to use it

| I want to... | Where | What to do |
|---|---|---|
| Ask my brain | `/` (home console) | Type a question, press Enter. Click a citation or "Open memory" button. Pick a project in the galaxy to scope answers to it. "New session" clears the chat. |
| Save a memory by chat | `/` | "remember that my passport expires in March" |
| Correct a memory by chat | `/` | "update my memory about the passport: it expires in April" |
| Delete by chat | `/` | "forget the passport memory", then answer "yes" to the confirmation |
| Save a note | `/notes` | **New note**, write, **Save** (title optional). |
| Add a memory by hand | `/memories?new=1` or **New** in the Memory Explorer | Choose type, importance, project. Leave type empty to let the AI decide. |
| See history / restore | `/memories`, open a memory | **History** list shows each edit with a word diff; **Restore** a version. |
| Search | `/search` | Type words or a sentence; pick a project. |
| Upload a document | `/documents` | **Upload a document**; optional project. Open a document to read its chunks with page numbers. |
| Add photos | `/photos` | Pick photos (up to 30 at a time); tick private to skip the AI. Search box finds them. |
| Sync portfolio / import a page | `/sources` | **Sync now**; **Import** next to a page; or paste any public URL. |
| Share from the phone | Android Share menu, or `/share` | Pick HIVEMIND; review; tap **Save** (or **Add to Photos** for gallery photos). |
| File everything automatically | `/projects` | The "organize" button (POST `/api/brain` action `organize`). |
| Undo an automatic action | `/` activity panel | **Undo** next to the entry. |
| Change answer language | `/settings` | Language card. |
| Export | `/settings` | **Download export**. |
| Re-embed with another model | `/settings` (System check card) | Start / cancel; progress shown. |

## 3. How it works

### 3.1 Saving a note or memory (the full pipeline)

`lib/knowledge.ts` is the single place that creates and changes notes and memories. Steps for `createNote` / `createMemory`:

1. **Clean the text** with `scrub()` (`lib/scrub.ts`): removes NUL characters and broken emoji halves that the database refuses.
2. **Extract metadata** (`extractMetadata`, `lib/ai/metadata.ts`): one JSON call that returns title, summary, category, tags (max 10), importance, memory type and entities. Order tried: Groq, Mistral, OpenRouter, Gemini, NVIDIA (Gemini is deliberately last: its free quota is kept for the agents). It **never throws**: on any failure it returns a blank default (category "General", importance 5, type "knowledge").
3. **Title**: your title, else the AI's, else the first 60 characters.
4. **Embed** (`tryEmbed`): title + blank line + content, sent to the embedding model (768 numbers). If the embedding model is unavailable the item is **still saved with no vector** and `reembedMissing` adds it later.
5. **Insert** the row. Your tags, type, category, importance win over the AI's. Notes store `metadata.{entities, importance}`; memories store `metadata.{summary, entities}`.
6. **Auto-file** (`autoFile`): if no project was chosen, `organizeItem` asks an AI to file it (see 3.6). The row is re-read so the response shows the project.

Offline: a create made offline carries `client_id` (`local-<uuid>`); the server returns the existing row if it already saw that id, so a retry never duplicates (`app/api/notes/route.ts`, `app/api/memories/route.ts`; the outbox itself is `lib/offline.ts`).

**Editing a memory** (`updateMemory`): if the title or content changed, the **old** title and content are written to `memory_versions` as the next version number, with your reason (or "edited"), and the row gets a new vector (or `null` until the scheduler fills it; search never uses a stale vector). Changing only type, importance, project or tags makes **no version and no re-embed**. **Restore** (`POST /api/memories/:id/versions`) simply calls `updateMemory` with the old text and reason `restored version N`, so the current text is kept in history too.

**Editing a note** is different: `PUT /api/notes/:id` re-runs `extractMetadata` and re-embeds directly (no `tryEmbed`), and keeps **no version history**.

**Deleting a memory** (`deleteMemory`): the whole row (including its vector) is copied into the activity log first, so Undo can put it back. Deleting a note, document or project has no undo.

### 3.2 Documents

`POST /api/documents` -> `detectType` (extension only) -> `parseToChunks` (`lib/documents/parse.ts`) -> `storeDocument` (`lib/documents/store.ts`):

- PDF: `unpdf` extracts text per page; each page is chunked separately and each chunk carries `metadata.page`. Scanned PDFs have no text and are refused ("No readable text found").
- DOCX: `mammoth` raw text. TXT/MD/CSV: UTF-8 text.
- `chunkText` (`lib/rag/chunker.ts`): paragraph-aware, target 1200 characters, 200 characters of overlap, long paragraphs split at sentence ends, very long sentences cut by length. Every chunk passes `scrub`.
- A `documents` row is inserted first (status `processing`). Then metadata (from the first 8 chunks) and the embeddings of all chunks (`<filename>\n\n<chunk>`) are made in parallel, chunks are inserted 100 at a time, and the row becomes `ready` with the summary and chunk count. On any error the chunks are deleted and the row is marked `failed` with a message, and the request returns an error.
- More than **400 chunks** is refused (HTTP 413).
- With a `source_url` (web import, portfolio resume) any earlier document with the same source URL is deleted after the new one is ready, so re-syncing never duplicates.
- If no project was chosen, the organizer files the document using its summary.

### 3.3 Searching and answering (RAG)

`lib/rag/retrieval.ts` has one function, `searchKnowledge(supabase, query, {limit, projectId, minSimilarity})`:

1. Embed the query (`embedQuery`, task type `RETRIEVAL_QUERY`, with the model that made the stored vectors; see 3.5).
2. Call the SQL function `match_knowledge` (`supabase/schema.sql`): top N notes, top N memories, top N document chunks by cosine similarity, optionally restricted to one project, filtered by `min_similarity`, merged and cut to N. Document hits are titled `filename (p. 3)` when the chunk has a page.
3. **If embedding fails**: `wordSearch`: notes and memories (not documents) whose title or text contains any of up to 5 query words (3+ letters, any script), ranked by how many words matched. This is why Ask My Brain still answers when the embedding quota is used up.

Defaults: limit 8; threshold 0.35; `/api/search` uses 0.3 and limit 12; the Memory Explorer search uses 0.45 and keeps only memories with an exact-word match or similarity of 0.62 or more.

**Ask My Brain** (`app/api/hivemind/route.ts`), in order:

1. Validate the message (1-4000 chars), optional `conversation_id`, `project_id`, `location`.
2. Load the last 8 messages of the conversation (or create a conversation titled with the first 80 characters).
3. In parallel: check if the brain already holds a close match (similarity 0.66+, `BRAIN_FIRST`), pick the agent, load profile, project names, schedule (today and tomorrow) and the language preference.
4. **Routing** (`lib/agents/router.ts`): a routine phrase goes to Core. Otherwise `ruleBasedAgent` (a long list of regular expressions) decides at once; if no rule fits, the Groq model is asked for `{"agent": "..."}`; if Groq is missing or fails the default is the `rag` (Knowledge) agent. If the choice came from Groq or the default (not from a rule) and was "research" or "core" but the brain has a strong match, the message goes to `rag` instead ("when is the kiwi festival?" is about your note, not the web).
5. Some messages are answered **without AI**: screen effects, garden, bedtime, "open page X", and instant data answers (where am I, weather, habits).
6. Otherwise `runAgent` (`lib/agents/orchestrator.ts`): a tool-calling loop (max 6 steps) on Gemini. The Knowledge agent's rules: call `search_brain` first (twice with a rephrase if needed), ground every claim in results, cite `[n]`, say plainly when the brain has nothing. `search_brain` returns each hit's first 1500 characters and registers the sources in a numbered list; sources are sent to the browser as `meta` events with a link (`/notes?open=...`, `/memories?open=...`, `/documents?open=...`).
7. The reply streams to the browser as newline-delimited JSON events: `meta`, `agent`, `tool`, `delta`, `action`, `jobs`, `done`, `error`. The console shows the agent steps, the text, the citation chips and action buttons; the galaxy highlights the cited nodes.
8. The turn (your message and the answer with its trace, sources, actions, provider, model, latency) is saved to `messages`. If the browser disconnects, the turn still finishes and is saved.

**Project scoping:** the console sends `project_id` (the project chosen in the galaxy); `search_brain`, `remember` and `create_note` use it. A memory saved by chat while a project is focused goes straight into that project.

**When Gemini cannot start an answer** (all models busy, quota out, timeouts) the route falls back, in this order:

1. A shopping request: real store search links, no AI.
2. A request to *do* something (`asksForAction`, `lib/ai/no-tools.ts`): a fixed honest reply, "I couldn't do that just now ... Nothing was changed". Free models would otherwise say "Done!" without doing anything.
3. A question: search the brain (limit 8) and ask NVIDIA, then OpenRouter, Mistral, Groq (`generateWithFallback`, order `nvidia, openrouter, mistral, groq`) with the brain results inlined, plus the rule "you have NO tools".
4. If that also fails, the stream sends an `error` event ("I hit a problem answering that. Try again in a moment.") and the turn is **not** saved.

If Gemini already streamed some text and then fails, the error is raised (no switch of model mid-answer).

### 3.4 The AI providers and fallbacks

| Provider | File | Default model (env override) | Timeout | Notes |
|---|---|---|---|---|
| Gemini | `lib/ai/gemini.ts` | chain: `gemini-3.5-flash-lite`, `gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemma-4-26b-a4b-it` (`GEMINI_CHAT_MODEL`, `GEMINI_FALLBACK_MODEL`, or the whole list in `GEMINI_MODELS`) | 20 s per request | The only provider with tools. Tries each model in turn on busy (503), rate limit (429), timeout or unknown error; stops on a clear client error (400/403). |
| NVIDIA | `lib/ai/openai-compatible.ts` | `nvidia/nemotron-3-super-120b-a12b` (`NVIDIA_MODEL`) | 25 s | No JSON mode. |
| Groq | same | `qwen/qwen3.8-27b` (`GROQ_MODEL`) | 8 s | Fast. Also the intent router and metadata/organizer first choice. |
| OpenRouter | same | `nvidia/nemotron-3.5-lightning:free` (`OPENROUTER_MODEL`), with backup models `google/gemma-4-31b-it:free`, `qwen/qwen3.8-27b:free`; "thinking" switched off | 25 s | Free tier. |
| Mistral | same | `ministral-14b-latest` (`MISTRAL_MODEL`) | 20 s | Only small models are free. |

`generateWithFallback` (`lib/ai/providers.ts`): builds a chain from the optional `prefer` provider plus the given `order` (default `gemini, nvidia, openrouter, mistral, groq`), keeps only providers whose key is set, and tries each once. A provider fails if it throws or returns empty text. If none has a key it throws "No AI provider keys configured"; if all fail it re-throws the last error. The OpenAI-compatible clients use `maxRetries: 0` so the chain fits in a Vercel function's time. `<think>...</think>` blocks are stripped from replies.

Who uses which order:

| Job | Order | File |
|---|---|---|
| Metadata on every save | Groq, Mistral, OpenRouter, Gemini, NVIDIA | `lib/ai/metadata.ts` |
| Organizer (filing) | Groq, Mistral, OpenRouter, Gemini, NVIDIA | `lib/organizer.ts` |
| Profile rebuild | Gemini, NVIDIA, OpenRouter, Mistral, Groq | `lib/profile.ts` |
| Chat agents | Gemini only (model chain below) | `lib/agents/orchestrator.ts` |
| Chat fallback (no tools) | NVIDIA, OpenRouter, Mistral, Groq | `app/api/hivemind/route.ts` |
| Agent router | Groq only, rules first | `lib/agents/router.ts` |
| Photo description, share summaries | Gemini chain only | `lib/photos.ts`, `lib/share.ts` |
| Web search | Gemini 2.5 models with Google Search | `lib/external/web.ts` |

Agent step details (`orchestrator.ts`): each Gemini model is tried twice (a "high demand" error gets one retry after 1.5 s, other errors move on at once); a model that gives nothing for 8 s is abandoned; a model with a "per day" quota error is skipped for 1 hour; max 6 steps; a delegated colleague agent runs one level deep and cannot call delete/send tools.

### 3.5 Embedding model recording and migration

The database vectors are fixed at **768 numbers** (`vector(768)` columns, `EMBED_DIM` in `lib/ai/embeddings.ts`). The model is not fixed:

- The private-store key `embedding-model` holds a marker `{model, dim, target?, since?}`. `getMarker()` caches it for 60 s. On first use it records the configured model (`GEMINI_EMBED_MODEL`, default `gemini-embedding-001`).
- Queries always use `marker.model` (the model that made the stored vectors). New documents use `marker.target ?? marker.model`. If the env var differs from the marker and no move is running, a warning is logged and the old model stays in use until you re-embed.
- **Start** (`startMigration`, `lib/embedding-migration.ts`): validates the model name, test-embeds "test" with it (fails now, not halfway), stores a job `{target, table, after, done, total}` under key `embedding-migration`, and sets `marker.target`. From then on new rows use the new model.
- **Step** (`migrationStep`): works through `notes`, `memories`, `document_chunks` in id order, 50 rows per page, 10 updates at a time, saving progress after every page, for a time budget (35-45 s from the API, 40 s from the cron). Quota errors only set a `note`; the next step carries on. After 3 days it records an error and stops. When every table is done the marker becomes `{model: target}` and searches switch.
- **Cancel** resets the marker to the old model. Rows already moved stay in the new model's space (a re-run finishes them).
- The scheduler (`app/api/cron/notify/route.ts`) also calls `reembedMissing` (up to 10 notes and 10 memories without a vector per run) and continues an unfinished migration.

### 3.6 The organizer (auto-filing) and undo

`lib/organizer.ts`. One AI call can file a batch (up to 25 items). The rules given to the AI:

- Use an **existing** project name (exact spelling) when the item is clearly about it.
- Use a **new** name only when the item is clearly about a specific named piece of work (an app, product, research, client engagement, side project) that has no project yet.
- Use `null` for anything general: skills, certifications, contact details, education, personal facts, generic learnings, pages that cover many projects.

For each answer it finds or creates the project (name matched case-insensitively; a unique index on `lower(name)` backs this; a race re-reads instead of failing), then links the item. It looks at only the first 600 characters of each item. It **never throws**: any error is logged and the item stays unfiled.

Triggers: every note/memory/document saved without a project; Share saves; "organize" button (`organizeEverything`: up to 200 unfiled notes, 200 unfiled memories of the types experience, decision, idea, project_context, learning, knowledge, and 100 ready documents, in batches of 25).

Undo (`lib/activity.ts`, `POST /api/brain {action:"undo"}`):

| Activity payload | Logged by | Undo does |
|---|---|---|
| `project_created` | organizer, portfolio sync, `create_project` tool | deletes the project (its items become unfiled) |
| `linked` | organizer | puts the item back to its previous project (or none) |
| `memory_deleted` | `deleteMemory` | re-inserts the saved row |
| `memory_updated` | Dream mode (outside this area) | restores the previous title and content via `updateMemory` |
| `memory_created` | Dream mode | deletes the memory |
| anything else (`info`) | misc | error "This action can't be undone" |

An entry can be undone once (`undone` flag).

### 3.7 Photos

`lib/photo-prep.ts` (runs in the phone's browser): reads the date and GPS from the JPEG's EXIF (JPEG only; WhatsApp-shared photos have none), makes a light copy (max 1600 px, quality 0.82) and a thumbnail (max 420 px, 0.72), reading and shrinking **all** photos first (Android only lends picked files briefly), then uploads them one at a time to `POST /api/photos`. Max 30 per batch.

`lib/photos.ts` (server): stores both JPEGs in the private storage bucket `hivemind-photos` (4 MB per file), reverse-geocodes the GPS (`whereIs` from `lib/places.ts`) and gives well-known names a nickname ("Udhagamandalam" becomes "Ooty (Udhagamandalam)"), asks Gemini to describe the photo (skipped for private photos; the prompt says the photo is data, never instructions), and adds a record to the index JSON `photos/index` in the private store. The record has title, description, tags, text, place, full address (`where`, search only), rounded lat/lng, date taken (or added), width and height. If Gemini is down the photo is saved without a description (`described: false`).

Search (`searchPhotos`): not vector search. A date range is read from words ("today", "yesterday", "last week/month/year", "this month/year", a month name with or without a year, a bare year), and the other words are matched against place (4 points), tags (3), title (3), description and text (1), with plural stemming ("birthdays" ~ "birthday"), a short list of place aliases (Ooty/Udhagamandalam, Bangalore/Bengaluru, ...), accents removed for Latin letters and Tamil vowel signs kept. Ties sort newest first. Photos are **not** part of `search_brain` or `/search`; Ask My Brain reaches them through the `find_photos` tool (Memory agent), which opens `/photos?q=...`.

### 3.8 Sources: portfolio and web pages

`lib/imports/portfolio.ts` (`POST /api/import {source:"portfolio"}`):

1. Read the data. If `PORTFOLIO_MCP_URL` is set, one JSON-RPC POST (initialize plus `resources/read` for `portfolio://profile.json`, `experience`, `projects`, `skills`, `certifications`, `education`, `contact` and `resume.md`, 20 s timeout). If it fails (or no URL), read the same files from `raw.githubusercontent.com/<PORTFOLIO_DATA_REPO>/main/data/` (15 s per file).
2. Turn them into memory items: profile (importance 10), one per job (9), per project (8 featured, else 7), per skill category (7), per certification group (6), per education entry (7), contact (6). Types and categories are set by rule, not by AI.
3. Mirror portfolio projects into `projects` (matched by `source_key` `portfolio:<id>`, else by name; status LIVE/ACTIVE/WIP become `active`, others `done`).
4. Embed all items, **delete every memory with `metadata.source = "portfolio-mcp"`, insert the new ones** (so a re-sync mirrors the portfolio exactly), store the resume as a document with source URL `portfolio-mcp://resume.md`, log activity, and rebuild the profile.

`POST /api/import {source:"web", url}`: `fetchPageText` (`lib/imports/web.ts`) fetches a public http(s) page with SSRF protection (`lib/safe-fetch.ts`, checked on every redirect), reads at most 3 MB, strips scripts and tags, refuses LinkedIn (message tells you to save the profile as PDF and upload it) and pages with under 200 characters of text (JavaScript-only pages), then stores it as a document of type `web` with the URL as `source_url` (re-import replaces). The Sources page offers two fixed owner pages (portfolio site, Linktree) and a free URL box, and a LinkedIn note explaining the two free routes (Save to PDF, or LinkedIn's data export).

### 3.9 Share to HIVEMIND

Android Share sends a POST to `/share-in`. `public/sw.js` (`takeShare`) catches it, keeps the title, text, URL and up to 5 files in the browser cache `hivemind-share`, and redirects to `/share`. The page shows what arrived and **saves only when you tap Save** (so a website cannot plant things by posting a fake share). Without the service worker, `app/share-in/route.ts` redirects to `/share?error=1`.

`POST /api/share` -> `saveShared` (`lib/share.ts`):

- **Image**: Gemini describes it (and finds a future date, offered as a reminder, never added by itself) -> saved as a memory tagged `shared`, `image`.
- **File** (PDF, DOCX, TXT, MD, CSV, max 4 MB): stored as a document and organized.
- **Link**: YouTube links use YouTube's oEmbed for title and channel; other pages are read with `fetchPageText` and summarised by Gemini (first 24,000 characters); pages that cannot be read keep the link and caption. Saved as a memory tagged `shared`, `link`.
- **Plain text**: saved as a memory.
- Everything shared is treated as data to summarise, never as instructions. Max 5 files per share. One result or error per item; one activity line is logged.
- Gallery photos can instead go to Photos (`uploadPhotos`), with date and place.

### 3.10 Other helpers

- **Profile** (`lib/profile.ts`): `rebuildProfile` reads the top 40 memories (by importance), 40 projects and 15 latest notes, asks the AI for JSON facts, upserts the single row in `brain_profile`. Used in every chat prompt (`profileForPrompt`). Runs after a portfolio sync, from `POST /api/brain {action:"rebuild-profile"}` and the `refresh_profile` tool.
- **Resurface** (`lib/resurface.ts`): at most one memory per day, at least 21 days old, at least 20 characters, not shown in the last 90 days, only memories you saved yourself (source empty, not career analysis, master resume or portfolio import); same one all day (hash of date and id); state in private-store key `resurface/state`. Used by `lib/day-brief.ts`.
- **Language** (`lib/prefs.ts`): preference `auto | en | ta` in private-store key `prefs`. `languageRule()` builds the instruction added last to chat and voice prompts. All three modes forbid any language except English, Tamil and Tanglish (speech recognition sometimes mishears Tamil as Malayalam, Telugu, Kannada or Hindi). In `auto`, the reply follows what you wrote; the chat route additionally forces Tamil script when your message contains Tamil script (unless you chose English). With language `ta`, or Tamil input, the no-AI "instant answers" are skipped.
- **Fuzzy score** (`lib/fuzzy.ts`): 100 exact, 80 prefix, 60 word-start, 40 substring, 10 letters in order; used only by the command palette (`components/command-palette.tsx`).
- **Memory Explorer** (`lib/memory-explorer.ts`): list with filters (type, category, project, source, sort), facet counts, search, and the detail view (versions, timeline, nearest neighbours via `match_knowledge` at 0.55, projects, and "skills" found by matching terms from your own Skills memories). Records from career analysis and the master resume are hidden unless `system=1`.
- **Chat history store**: tables `conversations` and `messages`. A conversation is created on the first message. `/api/conversations*` can list, read and delete them (see 10 for a gap).
- **Brain data** (`/api/brain`): everything the home page needs in one call.
- **Outside lookups** (`lib/external/*`, used by agents, not by the brain pages): `web.ts` (Google Search through Gemini, can save findings as a note via `researchAndSave`), `weather.ts` (Open-Meteo, no key, stale reading up to 3 h old when the service is down), `jobs.ts` (JSearch on RapidAPI, 25 s timeout), `products.ts` (store links for Indian shops).
- **`lib/data/kural.json`**: the Thirukkural text (about 386 KB, one long line, public domain), read only by `lib/kural.ts`. It is not brain data.

### 3.11 Files

| File | What it holds |
|---|---|
| `lib/ai/types.ts`, `providers.ts` | Provider interface, `generateWithFallback`, JSON parser |
| `lib/ai/gemini.ts`, `openai-compatible.ts` | Gemini chain; NVIDIA, Groq, OpenRouter, Mistral clients |
| `lib/ai/embeddings.ts` | Embedding calls, model marker |
| `lib/ai/metadata.ts` | Title/summary/tags/type extraction, the 8 memory types |
| `lib/ai/no-tools.ts` | Honest reply when only tool-less models are available |
| `lib/rag/chunker.ts`, `retrieval.ts` | Chunking; vector search, word-search fallback, source links |
| `lib/knowledge.ts` | Create/update/delete notes and memories, versions, re-embed missing |
| `lib/embedding-migration.ts` | Re-embedding job |
| `lib/organizer.ts`, `lib/activity.ts` | Auto-filing; activity log and undo |
| `lib/profile.ts`, `lib/resurface.ts`, `lib/prefs.ts`, `lib/fuzzy.ts` | Profile, daily memory, language rule, fuzzy score |
| `lib/memory-explorer.ts` | Memory list, facets, detail, timeline |
| `lib/photos.ts`, `lib/photo-prep.ts` | Photo storage, description, search; phone-side prep |
| `lib/documents/parse.ts`, `store.ts` | File parsing; document store with embedding |
| `lib/imports/portfolio.ts`, `web.ts` | Portfolio sync; web page reader |
| `lib/share.ts` | Share menu saving |
| `lib/external/*.ts` | Web search, weather, jobs, products |
| `lib/data/kural.json` | Thirukkural data (not brain data) |
| `lib/agents/router.ts`, `registry.ts`, `intent.ts`, `orchestrator.ts`, `tools/brain.ts` | Agent routing, per-agent tools, intent guard, Gemini tool loop, memory/note/project/search tools |
| `app/(bridge)/page.tsx`, `components/core.tsx` | The home page console and dashboard; the animated core (SVG only) |
| `app/(app)/(pages)/{notes,memories,documents,photos,projects,search,sources,settings,share}/page.tsx` | The pages |
| `components/memories/palace*.ts(x)`, `components/projects/reel*.ts(x)` | 3D Memory Palace; 3D project showcase (three.js, loaded only when opened) |
| `components/sessions-card.tsx`, `components/language.tsx` | Signed-in devices card; language card |
| `supabase/schema.sql`, `supabase/migrations/002_single_user.sql`, `003_jarvis.sql` | Tables and `match_knowledge` |

## 4. API

All routes sit behind the owner session: `proxy.ts` returns `401 {"error":"Locked"}` for any `/api/*` call without a valid session cookie (only `/api/unlock`, call/peer/ice helpers and `/api/cron/*` are outside it). Errors are JSON `{error}`: zod problems give 400 `{error:"Invalid input", issues}`, `HttpError` its own status, anything else 500 "Something went wrong". "Owner" below means that session.

| Method | Path | Who | Purpose | Request | Response |
|---|---|---|---|---|---|
| POST | `/api/hivemind` | owner | Ask My Brain / all chat | JSON `{message 1-4000, conversation_id?: uuid, project_id?: uuid, location?: {lat,lng,accuracy?,device?}}` | NDJSON stream of events (see 3.3); `maxDuration` 120 |
| GET | `/api/brain` | owner | Home page data | none | `{profile, projects[+items], activity[25, undoable flag, no payload], counts}` |
| POST | `/api/brain` | owner | Organize / rebuild profile / undo | `{action:"organize"}` or `{action:"rebuild-profile"}` or `{action:"undo", id: uuid}` | `{filed, created, scanned}` / `{profile}` / `{ok:true}`; 60 s |
| GET | `/api/notes` | owner | List notes (newest 200) | `?project=<uuid>` | note rows |
| POST | `/api/notes` | owner | Create note | `{title?, content 1-50000, project_id?, tags?, client_id?}` | note, 201 (200 if `client_id` seen) |
| GET/PUT/DELETE | `/api/notes/:id` | owner | Read / change / delete | PUT: partial note fields | note / note / 204; 404 if missing (GET, PUT) |
| GET | `/api/memories` | owner | List memories (newest 200) | `?type=&project=` | memory rows |
| POST | `/api/memories` | owner | Create memory | `{title?, content 1-20000, memory_type?, category?, importance 1-10?, confidence 0-1?, project_id?, tags?, client_id?}` | memory, 201 |
| GET | `/api/memories/explore` | owner | Memory Explorer list | `?q=&type=&category=&project=&source=&sort=&system=1` (`sort`: relevance, updated, created, importance, confidence; `project=none` = unfiled) | `{facets, items}` |
| GET/PUT/DELETE | `/api/memories/:id` | owner | Read / edit (with version) / delete (undoable) | PUT: partial memory + `change_reason?` | memory / memory / 204 |
| GET | `/api/memories/:id/detail` | owner | One memory with history, connections | none | `{memory, project, versions, current_version, timeline, related}` |
| GET | `/api/memories/:id/versions` | owner | Version list (newest first) | none | version rows |
| POST | `/api/memories/:id/versions` | owner | Restore a version | `{version_id: uuid}` | restored memory; 404 if not that memory's version |
| GET | `/api/documents` | owner | List documents | none | document rows |
| POST | `/api/documents` | owner | Upload and index | multipart `file` (max 4 MB, pdf/txt/md/markdown/docx/csv), `project_id?` | document, 201; 60 s |
| GET/DELETE | `/api/documents/:id` | owner | Document with its chunks / delete | none | `{...doc, chunks[{chunk_index, content, metadata}]}` / 204 |
| GET | `/api/photos` | owner | List or search photos | `?q=` (120 chars) | `{photos[+thumb signed link, 1 h], total}` (max 300) |
| POST | `/api/photos` | owner | Add one photo | multipart `full` (JPEG, max 3 MB), `thumb` (JPEG, max 512 KB), `w`, `h`, `taken?`, `lat?`, `lng?`, `private=1?` | `{photo, described}`, 201; 60 s |
| PATCH | `/api/photos` | owner | Fix title/date/place | `{id, title?<=80, taken? YYYY-MM-DD, place?<=80}` | `{photo}`; 404 |
| DELETE | `/api/photos` | owner | Delete a photo and its files | `?id=<uuid>` | `{ok:true}` |
| GET | `/api/photos/:id` | owner | The JPEG (`?t=1` thumbnail), cached 7 days (private) | none | image/jpeg or 404 |
| GET | `/api/projects` | owner | List projects | none | project rows |
| POST | `/api/projects` | owner | Create | `{name 1-120, description?<=2000}` | project, 201 (duplicate name: database error) |
| GET/PUT/DELETE | `/api/projects/:id` | owner | Project with its memories, notes, documents / edit / delete | PUT: `{name?, description?, status? active\|paused\|done}` | project / project / 204 |
| GET | `/api/projects/evolution` | owner | Showcase data (GitHub repos in build order) | none | evolution object; 30 s |
| POST | `/api/search` | owner | Semantic search | `{query 1-1000, project_id?, limit? 1-30}` | array of `{source_type, source_id, parent_id, title, content, similarity, created_at}` |
| GET | `/api/sessions` | owner | Signed-in browsers | none | `{sessions:[{created, expires, device}]}` |
| GET | `/api/conversations` | owner | Latest 50 conversations | none | `[{id, title, created_at}]` |
| GET/DELETE | `/api/conversations/:id` | owner | Messages of a conversation / delete it (messages cascade) | none | `[{id, role, content, metadata, created_at}]` / 204 |
| GET | `/api/embeddings` | owner | Embedding model status | none | `{model, configured, dim, running, job, tables:{rows, missing}}` |
| POST | `/api/embeddings` | owner | Start / step / cancel re-embed | `{action: start\|step\|cancel, model?<=80}` | status; 60 s |
| GET | `/api/export` | owner | Download everything | none | JSON file `second-brain-<date>.json`; 60 s |
| GET | `/api/import` | owner | Sources status | none | `{portfolio:{memories, syncedAt, via, mcpConfigured}, pages[]}` |
| POST | `/api/import` | owner | Sync portfolio / import a page | `{source:"portfolio"}` or `{source:"web", url, project_id?}` | sync summary / document 201; 60 s |
| GET | `/api/prefs` | owner | Read preferences | none | `{language}` |
| PUT | `/api/prefs` | owner | Set language | `{language?: auto\|en\|ta}` | `{language}` |
| POST | `/api/share` | owner | Save shared items | multipart `title`, `text`, `url`, up to 5 `files` | `{results:[Saved \| {error}]}`; 60 s |
| POST | `/share-in` (page route) | behind the same session gate (no exception in `proxy.ts`) | Fallback when the service worker is not running | multipart | redirect 303 to `/share?error=1` |

Note on `/share-in`: `proxy.ts` has no exception for it, so a share arriving without a signed-in session is redirected to `/unlock`; with the service worker running the POST never reaches the server.

## 5. Data

### 5.1 Database tables (Supabase Postgres, owner-only; RLS on with no policies, server key only)

| Table | Key columns | Notes |
|---|---|---|
| `notes` | id, project_id, title, content, summary, category, tags (json), metadata (json: `entities`, `importance`, `client_id`), embedding vector(768), created_at, updated_at | HNSW cosine index |
| `memories` | id, project_id, title, content, memory_type (check: the 8 types), category, importance 1-10, confidence 0-1, tags, metadata (json: `source`, `source_key`, `via`, `synced_at`, `summary`, `entities`, `client_id`), embedding, timestamps | source indexed |
| `memory_versions` | id, memory_id (cascade delete), version_number (unique with memory_id), title, content, change_reason, created_at | stores the text **before** each change |
| `documents` | id, project_id, filename, file_type (check dropped; includes `web`), source_url, status (processing/ready/failed), summary, chunk_count, error, created_at | |
| `document_chunks` | id, document_id (cascade), chunk_index, content, metadata (`page`), embedding, created_at | |
| `projects` | id, name (unique on lower name), description, status (active/paused/done), metadata (`auto`, `reason`, `source`, ...), source_key (unique when set), timestamps | deleting sets items' `project_id` to null |
| `conversations` | id, title, created_at | |
| `messages` | id, conversation_id (cascade), role, content, metadata (intent, agent, router, trace, sources, actions, jobs, pending_delete, provider, model, latency_ms), created_at | |
| `brain_profile` | id = 1, summary, facts (json), updated_at | one row |
| `activity` | id, kind, message, payload (json, typed in `lib/activity.ts`), undone, created_at | |

Function: `match_knowledge(query_embedding, match_count, filter_project, min_similarity)` (security invoker; execute revoked from the public keys in `002_single_user.sql`).

### 5.2 Private store (`lib/private-store.ts`, bucket `hivemind-private`, JSON files)

| Key | Content |
|---|---|
| `embedding-model` | marker `{model, dim, target?, since?}` |
| `embedding-migration` | re-embed job |
| `prefs` | `{language}` |
| `resurface/state` | `{date, id, seen{}}` |
| `photos/index` | array of photo records |

### 5.3 Storage bucket

`hivemind-photos` (private, 4 MB file limit): `<id>.jpg` (light copy) and `<id>_t.jpg` (thumbnail).

### 5.4 Browser storage

| Key | Where | Meaning |
|---|---|---|
| `memories-view` | localStorage | "palace" or "list" |
| `projects-view` | localStorage | "reel" or "list" |
| `hivemind-speak-all` | localStorage | read answers aloud |
| `hivemind-ask` | sessionStorage | lets an Autopilot "Do it" button auto-run `/?ask=...` |
| `hivemind-share` | Cache Storage | inbox for Android shares (cleared after Save) |
| outbox, cached lists | browser storage managed by `lib/offline.ts` (storage type not verified) | offline notes and memories |

## 6. Configuration

| Variable | Required? | Meaning | Default |
|---|---|---|---|
| `GEMINI_API_KEY` | needed for agents, embeddings, photos, share summaries | Google AI key | none; "GEMINI_API_KEY is not set" |
| `GEMINI_CHAT_MODEL` | no | first model in the chain | `gemini-3.5-flash-lite` |
| `GEMINI_FALLBACK_MODEL` | no | third model | `gemini-2.5-flash` |
| `GEMINI_MODELS` | no | comma list replacing the whole chain | built-in 4-model chain |
| `GEMINI_EMBED_MODEL` | no | embedding model the deployment asks for (takes effect after a re-embed) | `gemini-embedding-001` |
| `NVIDIA_API_KEY`, `NVIDIA_MODEL` | no | NVIDIA fallback | `nvidia/nemotron-3-super-120b-a12b` |
| `GROQ_API_KEY`, `GROQ_MODEL` | no (strongly useful: router, metadata, organizer) | Groq | `qwen/qwen3.8-27b` |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | no | OpenRouter | `nvidia/nemotron-3.5-lightning:free` |
| `MISTRAL_API_KEY`, `MISTRAL_MODEL` | no | Mistral | `ministral-14b-latest` |
| `PORTFOLIO_MCP_URL` | no | MCP endpoint for the portfolio sync | unset: GitHub data |
| `PORTFOLIO_DATA_REPO` | no | GitHub `owner/repo` with `data/*.json` | `Karthikeyan260/Portfolio-mcp` |
| `WEB_SEARCH_MODELS` | no | models used for Google Search grounding | `gemini-2.5-flash,gemini-2.5-flash-lite` |
| `RAPIDAPI_KEY` / `RAPIDAPI_SECRET` | for job search | JSearch | none |
| `HOME_CITY` | no | default weather city | `Chennai` |
| `APP_URL` | no | base URL passed to agents and OpenRouter | request origin |
| `GITHUB_USER` | no | whose repos feed the Projects showcase | `Karthikeyan260` |

Settings page shows each provider's model and "key set / missing key" (server-rendered from `isConfigured()`).

## 7. Security and privacy

- **Who can reach it:** only the signed-in owner (`proxy.ts`). The database is only touched by the server key; RLS blocks the public key.
- **Validation:** zod on JSON bodies (lengths in section 4); ids in photo routes must match a UUID pattern; upload type and size checks for documents (extension, 4 MB) and photos (JPEG only, 3 MB and 512 KB); the `/api/notes?project=` value must look like an id.
- **Prompt injection:** pages, documents, photos and shared content are labelled as data in the prompts (`DATA_RULE` in `lib/photos.ts` and `lib/share.ts`, tool rules in the orchestrator). Changing or deleting tools only run if your own words in this message ask for that kind of action (`lib/agents/intent.ts`); deletes need a second message from you; delegated colleague agents cannot run destructive tools. Share needs a tap on Save.
- **SSRF:** web imports and YouTube oEmbed go through `safeFetch`, which blocks internal and cloud-metadata hosts on every redirect.
- **What leaves the server:** note, memory and document text goes to the AI providers for metadata (Groq/Mistral/OpenRouter/Gemini/NVIDIA in that order) and to Gemini for embeddings; chat turns go to Gemini (and fallbacks); photos (non-private) go to Gemini. Private photos never go to an AI. Settings warns that free-tier Gemini may use prompts to improve Google products. Keys stay on the server.
- **Export** leaves out vectors and secret-like private files (login secrets, rate-limit counters, push addresses, call room links, device locations, web task logs); it includes chat messages and the photo index, not the image files.
- **Rate limits:** none found in these routes (not verified elsewhere).
- The photo route sends `Cache-Control: private, max-age=604800, immutable`.

## 8. Limits and edge cases

| Thing | Limit / behaviour |
|---|---|
| Note content | 50,000 chars; memory 20,000; title 200; tags 20 x 40 chars |
| Text embedded | first 8000 chars of title + content (`embedMany` slices); long notes/memories are one vector, not chunked |
| Metadata input | first 12,000 chars; JSON output capped at 500 tokens |
| Document upload | 4 MB; max 400 chunks; chunks ~1200 chars with 200 overlap; scanned PDFs refused |
| Embedding batch | 50 texts per call; 768 dims, else error "didn't return 768-number vectors" |
| Search | `limit` 1-30 (API), default 8; thresholds 0.3 / 0.35 / 0.45 / 0.55 by use |
| Memory Explorer | loads the latest **500** memories, filters and facets work on those |
| List routes | notes 200, memories 200, photos 300, conversations 50 |
| Chat history sent to the model | last 8 messages |
| Agent loop | 6 steps; 8 s to first token per Gemini model; quota-out models skipped 1 h |
| Provider timeouts | Gemini 20 s, NVIDIA 25 s, Groq 8 s, OpenRouter 25 s, Mistral 20 s |
| Function time | chat 120 s; documents, photos, share, import, export, embeddings, brain 60 s; notes, memories 30 s |
| Photos | 30 per batch (client), ~1600 px copy, 3 MB max; description needs Gemini |
| Share | 5 files, 4 MB each; page text 24,000 chars to the AI |
| Resurface | once a day, >= 21 days old, repeats after 90 days |
| Embedding down | saves still work (vector added later, 10 notes and 10 memories per scheduler run); search falls back to words (notes and memories only); documents cannot be uploaded; editing a **note** fails (see 10) |
| All AI providers down | saving still works (blank metadata); chat returns an error event and is not saved; action requests get the honest "AI is busy" reply |
| Re-embed | stops after 3 days of failures; cancel leaves mixed vectors until re-run |
| 1000-row cap | Supabase returns at most 1000 rows per request; `/api/export` pages through, other counting queries do not (see 10) |

## 9. Tests

Unit tests (Vitest, `tests/`):

| File | Covers |
|---|---|
| `tests/chunker.test.ts` | empty and short text, no broken emoji, nothing lost with overlap, speed on odd shapes |
| `tests/retrieval.test.ts` | `match_knowledge` arguments, word-search fallback (ranking, Tamil, project scope), source links |
| `tests/embedding-migration.test.ts` | full re-embed, document-name prefix, resume after quota error, bad model refused, cancel, status counts |
| `tests/photos.test.ts` | photo search (place, content, month, date words, aliases, plurals, Tamil, accents), nicknames |
| `tests/resurface.test.ts` | pick rules, same all day, age wording |
| `tests/fuzzy.test.ts` | ranking of the fuzzy score |
| `tests/no-tools.test.ts` | which messages count as action requests |
| `tests/intent.test.ts`, `tests/router.test.ts` | owner-intent guard and agent routing rules |
| `tests/brain-blank-lookup.test.ts`, `tests/not-career-filter.test.ts`, `tests/dream-long-memories.test.ts` | touch `lib/knowledge.ts` / `lib/activity.ts` from other features |
| `tests/db-fault.test.ts`, `tests/scrub.test.ts` | database error mapping, text scrubbing |
| `tests/db.integration.test.ts`, `tests/tools.live.test.ts` | need a database / live services (not run here) |

Not covered by any test I could find: `lib/organizer.ts`, `lib/activity.ts` undo, `lib/profile.ts`, `lib/memory-explorer.ts`, `lib/share.ts`, `lib/imports/*`, `lib/documents/*` (parsing and storing), `lib/ai/providers.ts` (fallback order), `lib/ai/gemini.ts`, `lib/prefs.ts` language rule, `lib/photo-prep.ts` (EXIF), the notes/memories/documents/export/import/share API routes, `lib/knowledge.ts` version logic directly. E2E (`e2e/*.spec.ts`) are theatre-focused plus `smoke.spec.ts` and `sweep.spec.ts`; I did not read those two, so whether they touch these pages is not verified.

## 10. Checked and notes

**Verified by reading (works as designed):**

- The save pipeline: scrub, metadata (never throws), embed with fallback to no vector, insert, auto-file (`lib/knowledge.ts:74-134`). The 8 memory types in code (`lib/ai/metadata.ts:5-14`) match the database check (`supabase/schema.sql`).
- Versioning writes the *old* text before each change and restore reuses the same path (`lib/knowledge.ts:137-185`, `app/api/memories/[id]/versions/route.ts`). Importance/type-only edits make no version (by design).
- Offline duplicate protection with `client_id` (`app/api/notes/route.ts:80-94`).
- Embedding marker and migration are consistent: queries use the old model until every table is done, then the marker switches (`lib/embedding-migration.ts:123-127`); covered by tests.
- Delete safety: two steps, the confirmation must match the previously asked item and your words (`lib/agents/tools/shared.ts` `askedToDelete`, `lib/agents/intent.ts`).
- Fallback ladder in chat matches section 3.3 (`app/api/hivemind/route.ts:210-241`).
- Photo privacy: private photos skip the AI (`lib/photos.ts:114`).

**Bugs and risks:**

1. **Undo of a deleted memory loses its history.** The activity log stores only the memory row (`lib/knowledge.ts:194`); `memory_versions` rows are deleted with the memory (`on delete cascade`), so after Undo the memory is back but its version history is gone.
2. **Editing a note fails when the embedding model is down.** `PUT /api/notes/:id` (`app/api/notes/[id]/route.ts:144`) and the `update_note` chat tool (`lib/agents/tools/brain.ts:194`) call `embedOne` without the `tryEmbed` fallback that creation and memory edits use, so the whole edit errors (500) instead of saving without a vector. The same applies to the Memory detail view's related list (`lib/memory-explorer.ts:125`) for a memory with no vector.
3. **Portfolio sync is delete-then-insert, not atomic** (`lib/imports/portfolio.ts:145-161`). If the insert fails after the delete, the portfolio memories are gone until the next successful sync. It also discards any edits you made to imported memories and their history (by design, but worth knowing).
4. **Documents have no "embed later" path.** If embeddings are down the upload fails and leaves a `failed` row; `reembedMissing` only handles notes and memories (`lib/knowledge.ts:57-69`).
5. **Counts and lists can silently stop at 1000 / 500 rows.** `/api/brain` counts items per project by selecting every `project_id` (`app/api/brain/route.ts:19-21`), and the `list_projects` tool does the same (`lib/agents/tools/brain.ts:283-284`); the database returns at most 1000 rows per request (the export route has a comment saying exactly this). The Memory Explorer and the Palace only ever see the newest 500 memories (`lib/memory-explorer.ts:40`). Not an issue at today's size; it will be later. (Whether the project raises the 1000 limit was not verified.)
6. **Only notes without a project are rescanned by the organizer, and "organize" has no paging:** up to 200 notes, 200 memories, 100 documents per click, sequential AI calls inside a 60 s function (`lib/organizer.ts:104-129`). A large backlog needs several clicks and may time out partway (work done so far is kept).
7. **Chat history is saved but not browsable.** `/api/conversations` and `/api/conversations/:id` exist, but nothing in the app calls them (searched `app`, `components`, `lib`); the console keeps the conversation id only in the open tab and "New session" drops it. Old chats can only be reached through the export file.
8. **Message routing by regular expression can misfile an intent.** In `lib/agents/router.ts` the scheduler rule (words like "meeting", "reminder") comes before the "remember/save/note" rule, so "remember that the meeting moved to 4" goes to the Scheduler agent, not the Memory agent. Rules, then Groq, then `rag` is the order; anything odd lands on the Knowledge agent.
9. **Notes have no recovery:** deleting a note, document, photo or project cannot be undone, and notes keep no version history (only memories do).
10. **Long notes are only partly searchable.** One vector per note from the first 8000 characters (`lib/ai/embeddings.ts:62`), while notes can be 50,000 characters. Only documents are chunked.

**Dead or unfinished code:**

- `streamGemini` (`lib/ai/gemini.ts:43`) and `ANSWER_PROVIDERS` (`lib/ai/providers.ts:15`) are never used.
- The `maxTokensCap` option (`lib/ai/openai-compatible.ts:13`) is never set for any provider.
- `lib/memory-explorer.ts:166` has `void relMems;` (a leftover); the related-projects query still runs.
- The console (`app/(bridge)/page.tsx`, around line 307) decides "changed" from the old intent names `STORE_MEMORY` / `CREATE_PROJECT`, which the router no longer produces; refreshing still works because the server's `done` event carries `changed`.
- `app/(app)/(pages)/settings/page.tsx` says Groq is "Intent router, summaries & tags" (true) but not that it is also the organizer's first choice.
- The Sources page hard-codes the owner's two pages and the LinkedIn profile link (`app/(app)/(pages)/sources/page.tsx`).
- `proxy.ts` has no open exception for `/share-in`; a share from a phone with no live session and no service worker goes to the unlock page, which is acceptable but not documented elsewhere.

**Missing validation / inconsistencies:**

- `GET /api/memories?project=` is not format-checked (a bad id returns 404 "Not found" via the database error mapping, which is fine), while `/api/notes?project=` is checked.
- `PUT /api/notes/:id` does not `scrub` text (creation does); a NUL character gives a 400 "characters I can't store".
- Photo index is one JSON file updated by read-modify-write (`lib/photos.ts:133-134`); uploads are sent one at a time so this is safe in normal use, but two devices uploading at the same moment could lose a photo record.
- README says memories are "re-embedded on edit"; true, but when the embedding model is down the vector is cleared until the scheduler restores it, so such a memory is missing from semantic search in between (word search covers it).

**Nothing found wrong in:** chunker, fuzzy score, language rule text, profile rebuild, export paging, the provider timeouts (all set, and the clients do not retry).
