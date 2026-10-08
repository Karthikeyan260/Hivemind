# HIVEMIND manual test

What the automated checks can't do: mic, speakers, phone hardware, notifications, two people, real time passing.
Run on the **phone (installed app)** unless it says laptop. Tick each box; note anything odd next to it.

Automated first (laptop, server running): `npm test` · `npm run test:db` · `npm run build && npm run test:e2e` · `npm run test:sweep`.

## 1. Sign-in and devices
- [ ] Open the app → lock screen. Wrong password → "Wrong password". Right one → home.
- [ ] Settings → Signed-in devices lists this phone. Lock (sidebar / "lock HIVEMIND") → back to lock screen.
- [ ] Settings → System check: all green (Database, Table privacy, Embeddings).

## 2. Voice
- [ ] Tap the mic (or Space on laptop): "what's on today" → answers from your schedule.
- [ ] "When is <something only in your notes>?" → answers from your note, not the web.
- [ ] "What's the weather in Chennai" → real temperature.
- [ ] Interrupt it mid-answer by talking → it stops and listens.
- [ ] "Open career" → page changes. "Scroll down" → scrolls.
- [ ] "Remind me to drink water in 2 minutes" → reminder notification arrives on time.
- [ ] "Go to sleep" → short goodbye, mic turns off.
- [ ] Tamil: ask something in Tamil → reply in Tamil.

## 3. Wake word (each device separately)
- [ ] Settings → Wake word → Teach it (8 takes + sentence) → "Saved".
- [ ] Test → say the word 5 times → heard ≥4. Talk normally for 1 minute → no false wake.
- [ ] Leave Settings, say the word → voice starts on its own.
- [ ] Turn the screen off and on again → still works after one tap.

## 4. Guest mode
- [ ] "This is Harini, my friend, talk to her" → yellow banner "Talking with Harini".
- [ ] As the guest: ask about your projects → answers in your style.
- [ ] As the guest: "remember that I like coffee" → refuses to save, says it'll pass it on.
- [ ] As the guest: ask for your bank / phone number → refuses.
- [ ] "Come back" (or tap Back to me) → recap + "save anything?". Say "save the coffee one" → appears in Memories.
- [ ] Do it again and say "no" → nothing new in Memories or chat history.

## 5. Notifications and scheduler
- [ ] Settings → Notifications → send test → arrives.
- [ ] Next morning: "Good morning" brief arrives; Brief page has today's topics.
- [ ] Settings shows "scheduler last checked" within the last ~10 minutes.
- [ ] Add a habit with a time 2 minutes away → nudge arrives.

## 6. Calls and games (needs a second phone / person)
- [ ] Calls → share your call link → friend calls, you answer, both hear each other.
- [ ] Don't answer → call screening picks up, friend talks, you get "📞 <name> called" with a summary.
- [ ] Games → Draw & Guess with a friend: both join, drawing shows live, voice chat works.
- [ ] Paattu quiz: clip plays, answering by voice works, next round is a different song.

## 7. Everyday pages
- [ ] Notes: add, edit, delete. Memories: edit → version history shows the old one; restore works.
- [ ] Documents: upload a PDF → ready in under a minute → ask about it in chat → cites it.
- [ ] Search: finds by meaning, not just words.
- [ ] Music: "play an Anirudh song" → plays, next/pause from the music bar and by voice.
- [ ] Video: "play the Leo trailer" → video window, minimise / full screen.
- [ ] Map: Locate me → your area; "tea shop near me" → list + route.
- [ ] Apps: "make me an app to track petrol" → opens in ~30 s; add an entry; it's still there after reload.
- [ ] Career: paste a job description → ATS score + tailored resume.
- [ ] Kitchen mode: screen stays on; voice still works; exit.
- [ ] Comic: make today's comic → 4 panels; Share works.
- [ ] Autopilot: Run now → finishes in under a minute with some insights (or "nothing new").
- [ ] Web tasks (laptop): "go to example.com and tell me the heading" → live window → answer.

## 8. Phone app things
- [ ] Share a link/text from another app to HIVEMIND → saved.
- [ ] Long-press the app icon → shortcuts work.
- [ ] Airplane mode: open notes (cached), add a note → "waiting" pill; back online → it syncs once (no duplicate).
- [ ] Rotate / small screen: no page scrolls sideways.

## 9. After a deploy
- [ ] Home loads in under ~3 s on mobile data; galaxy appears after the page.
- [ ] GitHub → Actions: latest run green.
