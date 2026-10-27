"use client";

import { Crown, Home, Layers, MessageCircle, Mic, MicOff, Send, Users, X } from "lucide-react";
import { CardsGame } from "@/components/games/cards-game";
import { ChessVsFriend } from "@/components/games/chess/vs-friend";
import { DotsGame } from "@/components/games/dots-game";
import { BingoGame } from "@/components/games/bingo-game";
import { Connect4Game } from "@/components/games/connect4-game";
import { BusinessGame } from "@/components/games/business-game";
import { LudoGame } from "@/components/games/ludo-game";
import { SnakesGame } from "@/components/games/snakes-game";
import { PartyDraw } from "@/components/games/party-draw";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { useEffect, useMemo, useRef, useState } from "react";
import { FireflyGame } from "@/components/pet/fireflies";
import { MiniPet, PetPals, type GuestControls } from "@/components/games/pet-pals";
import { PetRace } from "@/components/games/pet-race";
import { PetRoam } from "@/components/games/pet-roam";
import { useFetch } from "@/lib/client-api";
import { afterFireflies, afterFlower, afterGame, type GuestPet, guestStage, loadGuestPet, newGuestPet, saveGuestPet } from "@/lib/guest-pet";
import type { Pet } from "@/lib/pet";
import { MAX_PLAYERS, type Party, PartyContext, type PartyChat, type PartyFloat, type PartyGameKind, usePartyNet } from "@/lib/games/party";
import { here, REACTIONS, spokenGame, spokenPlayer } from "@/lib/games/party-rules";

/**
 * Game night: the lobby and the game everyone is playing, for the owner (host) and each friend.
 * The owner picks the game; everyone's screen follows; "Lobby" brings everyone back for the next one.
 */
const GAMES: { id: PartyGameKind; name: string; emoji: string; min: number; max: number; about: string; ready: boolean }[] = [
  { id: "cards", name: "Colour Clash", emoji: "🃏", min: 2, max: 6, about: "Match the colour or number. +2s, Wild +4s, and don't forget Last card!", ready: true },
  { id: "ludo", name: "Ludo", emoji: "🎲", min: 2, max: 4, about: "Race your tokens home. Up to 4 play; with more, the first four in the lobby play.", ready: true },
  { id: "draw", name: "Draw & Guess", emoji: "✏️", min: 2, max: 6, about: "Take turns drawing; everyone else (and HIVEMIND) races to guess the word.", ready: true },
  { id: "dots", name: "Dots & Boxes", emoji: "🔲", min: 2, max: 4, about: "Join the dots, close boxes. Up to 4 play; with more, the first four in the lobby play.", ready: true },
  { id: "chess", name: "Chess", emoji: "♟️", min: 2, max: 6, about: "You pick a friend to play; everyone else watches live.", ready: true },
  { id: "snakes", name: "Snakes & Ladders", emoji: "🐍", min: 1, max: 6, about: "Climb the ladders, dodge the snakes, first to 100 wins. Everyone plays (add HIVEMIND bots if you like).", ready: true },
  { id: "bingo", name: "Bingo", emoji: "🎱", min: 1, max: 6, about: "Fill your 5×5 card with 1–25 your way, take turns calling numbers, and spell B-I-N-G-O with five complete lines first. Add HIVEMIND bots if you like.", ready: true },
  { id: "connect4", name: "Connect Four", emoji: "🔴", min: 1, max: 2, about: "Drop discs, four in a row wins. Two play (the first two in the lobby, or you against HIVEMIND); everyone else watches.", ready: true },
  { id: "business", name: "Business", emoji: "🏦", min: 1, max: 6, about: "Buy Indian cities, charge rent, build hotels, bankrupt your friends. Pick a round limit for a quicker game.", ready: true },
];

export function PartyTable({ role, room, myName, hostName, onHostAway }: { role: "host" | "guest"; room: string; myName: string; hostName: string; onHostAway?: () => void }) {
  const host = role === "host";
  // Pets: the owner's is Nova (from the app); a friend's is a guest pet kept in their own browser.
  const nova = useFetch<{ pet: Pet }>(host ? "/api/pet" : null);
  const [guestPet, setGuestPet] = useState<GuestPet | null>(null);
  const [gotFlower, setGotFlower] = useState(false);
  const [firefly, setFirefly] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the friend's pet, read from this browser once
    if (!host) setGuestPet(loadGuestPet());
  }, [host]);
  const myPet = useMemo(() => {
    const np = nova.data?.pet;
    if (host) return np ? { name: np.name, hue: 0, stage: np.stage, xp: np.xp, wear: np.wear, best: np.fireflies.best, flowers: 0 } : null;
    return guestPet ? { name: guestPet.name, hue: guestPet.hue, stage: guestStage(guestPet), xp: guestPet.xp, wear: null, best: guestPet.fireflies.best, flowers: guestPet.flowers } : null;
  }, [host, nova.data, guestPet]);
  const party = usePartyNet({
    role,
    room,
    myName,
    hostName,
    onHostAway,
    pet: myPet,
    onGift: () => {
      if (host) return;
      setGuestPet((p) => {
        if (!p) return p;
        const n = afterFlower(p);
        saveGuestPet(n);
        return n;
      });
      setGotFlower(true);
      setTimeout(() => setGotFlower(false), 5000);
    },
  });
  const ph = party.phase;
  // A friend's pet grows with every game that starts at the table.
  const lastGame = useRef(0);
  const gameN = ph.screen === "game" ? ph.n : 0;
  useEffect(() => {
    if (host || !party.live || !gameN || gameN === lastGame.current) return;
    lastGame.current = gameN;
    setGuestPet((p) => {
      if (!p) return p;
      const n = afterGame(p);
      saveGuestPet(n);
      return n;
    });
  }, [gameN, host, party.live]);
  const guestControls: GuestControls | undefined = host
    ? undefined
    : {
        hatch: (name, hue) => {
          const p = newGuestPet(name, hue);
          if (!p) return;
          saveGuestPet(p);
          setGuestPet(p);
        },
        fireflies: () => setFirefly(true),
        gotFlower,
      };

  // Voice: run game night by speaking ("let's play ludo", "back to the lobby", "who's here?", "mute me").
  useVoiceActions({
    party_game: {
      description: "Game night page: switch everyone to a game (the owner only). input: the game: Colour Clash (cards/uno), Ludo, Draw & Guess, Dots & Boxes, Chess, Snakes & Ladders, Business (monopoly) or Bingo (housie/tambola). Then the game's own voice actions start it.",
      run: ({ input }) => {
        if (!host) return { error: "Only the host picks the game." };
        const id = spokenGame(String(input ?? ""));
        const g = GAMES.find((x) => x.id === id);
        if (!g) return { error: "Say a game: Colour Clash, Ludo, Draw & Guess, Dots & Boxes, Chess, Snakes & Ladders, Business or Bingo." };
        if (here(party.players).length < g.min) return { error: "Needs at least one friend here first." };
        party.startGame(g.id);
        return { opened: g.name, players: here(party.players).length };
      },
    },
    party_lobby: {
      description: "Game night page: bring everyone back to the lobby to pick the next game (the owner only).",
      run: () => (host ? (party.backToLobby(), { lobby: true }) : { error: "Only the host can do that." }),
    },
    party_players: {
      description: "Game night page: who's at the table (here or away), how many seats are left, and which game is on.",
      run: () => ({
        here: here(party.players).map((p) => p.name),
        away: party.players.filter((p) => !p.online && !p.host).map((p) => p.name),
        seats_left: MAX_PLAYERS - party.players.length,
        game: ph.screen === "game" ? GAMES.find((g) => g.id === ph.game)?.name : "lobby",
      }),
    },
    party_mute: {
      description: "Game night page: mute or unmute the owner's microphone in the group voice chat. input: 'mute' or 'unmute'.",
      run: ({ input }) => {
        const v = party.voice;
        if (v.noMic) return { error: "The microphone is blocked in the browser." };
        const want = /unmute|on|open/i.test(String(input ?? "")) ? false : /mute|off|quiet/i.test(String(input ?? "")) ? true : !v.muted;
        if (want !== v.muted) v.toggleMute();
        return { muted: want };
      },
    },
    party_chat: {
      description: "Game night page: send a chat message to everyone at the table. input: the message, word for word.",
      run: ({ input }) => (party.chat(String(input ?? "")) ? { sent: true } : { error: "Couldn't send that (empty, too fast, or not connected)." }),
    },
    party_remove: {
      description: "Game night page: remove a friend from the table (the owner only). Only when the owner clearly asks. input: the friend's name.",
      run: ({ input }) => {
        if (!host) return { error: "Only the host can do that." };
        const p = spokenPlayer(
          party.players.filter((x) => !x.host),
          String(input ?? ""),
        );
        if (!p) return { error: "I couldn't find that name at the table." };
        party.removePlayer(p.id);
        return { removed: p.name };
      },
    },
  });

  return (
    <PartyContext.Provider value={party}>
      {party.stage === "error" || party.stage === "full" ? (
        <p className="mx-auto mt-10 max-w-md rounded-2xl border border-alert/40 bg-alert/10 p-4 text-center text-sm text-alert">{party.err}</p>
      ) : ph.screen === "game" && (party.role === "host" || party.live) ? (
        <GameScreen party={party} game={ph.game} n={ph.n} room={room} />
      ) : (
        <Lobby party={party} pals={
            <>
              <PetPals party={party} guest={guestControls} mine={myPet} />
              <PetRace party={party} />
            </>
          } />
      )}
      {(host ? party.stage !== "error" : party.live) && (
        <>
          <Reactions party={party} />
          <Chat party={party} />
        </>
      )}
      {firefly && guestPet && (
        <FireflyGame
          name={guestPet.name}
          stage={guestStage(guestPet)}
          wear={null}
          best={guestPet.fireflies.best}
          onClose={() => setFirefly(false)}
          onFinish={async (score) => {
            const r = afterFireflies(guestPet, score);
            saveGuestPet(r.pet);
            setGuestPet(r.pet);
            return { best: r.pet.fireflies.best, newBest: r.newBest };
          }}
        />
      )}
    </PartyContext.Provider>
  );
}

/** The reaction buttons (a slim bar at the side) and the reactions floating up from the bottom. */
function Reactions({ party }: { party: Party }) {
  const [floats, setFloats] = useState<PartyFloat[]>([]);
  const { onFloats } = party;
  useEffect(() => onFloats(setFloats), [onFloats]);
  // Phone: one 😀 button that opens a row of reactions beside it, instead of a tall strip over the game.
  const [tray, setTray] = useState(false);
  useEffect(() => {
    if (!tray) return;
    const t = setTimeout(() => setTray(false), 5000);
    return () => clearTimeout(t);
  }, [tray]);
  const nameOf = (id: string) => (id === party.me ? "You" : (party.players.find((p) => p.id === id)?.name ?? (id === "host" ? party.hostName : "Friend")));
  return (
    <>
      <div className="fixed top-[58%] right-1.5 z-40 -translate-y-1/2 sm:hidden">
        <button type="button" onClick={() => setTray((o) => !o)} aria-expanded={tray} aria-label={tray ? "Close reactions" : "Open reactions"} className="flex size-10 items-center justify-center rounded-full border border-line bg-panel/90 text-xl shadow-lg backdrop-blur active:scale-90">
          {tray ? <X size={18} /> : "😀"}
        </button>
        {tray && (
          <div className="absolute top-1/2 right-full mr-2 flex -translate-y-1/2 gap-0.5 rounded-full border border-line bg-panel/95 p-1 shadow-xl backdrop-blur" role="toolbar" aria-label="Reactions">
            {REACTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  party.react(e);
                  setTray(false);
                }}
                aria-label={`React ${e}`}
                className="flex size-9 items-center justify-center rounded-full text-xl active:scale-90"
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" aria-live="polite">
        {floats.map((f) => (
          <span key={f.k} className="party-float absolute bottom-16 flex flex-col items-center" style={{ left: `${f.x}%` }}>
            <span className="text-4xl drop-shadow-lg">{f.e}</span>
            <span className="mt-0.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">{nameOf(f.who)}</span>
          </span>
        ))}
      </div>
      <div className="fixed top-1/2 right-1.5 z-40 hidden -translate-y-1/2 flex-col gap-1 rounded-full border border-line bg-panel/85 p-1 shadow-lg backdrop-blur sm:flex" role="toolbar" aria-label="Reactions">
        {REACTIONS.map((e) => (
          <button key={e} type="button" onClick={() => party.react(e)} aria-label={`React ${e}`} className="flex size-9 items-center justify-center rounded-full text-xl transition-transform hover:scale-125 active:scale-90">
            {e}
          </button>
        ))}
      </div>
    </>
  );
}

/** Game night chat: a button with the unread count, a panel to read and type, and a bubble for new messages while it's closed. */
function Chat({ party }: { party: Party }) {
  const [list, setList] = useState<PartyChat[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const [text, setText] = useState("");
  const [peek, setPeek] = useState<PartyChat | null>(null);
  const { onChat } = party;
  useEffect(() => onChat(setList), [onChat]);
  const end = useRef<HTMLDivElement>(null);
  const lastK = list[list.length - 1]?.k ?? 0;
  // Open: everything is read, and the newest is in view.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the chat marks it read
    setSeen(lastK);
    end.current?.scrollIntoView({ block: "end" });
  }, [open, lastK]);
  // Closed: someone else's new message pops up for a few seconds.
  const lastMsg = list[list.length - 1];
  useEffect(() => {
    if (open || !lastMsg || lastMsg.who === party.me) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new message arrived
    setPeek(lastMsg);
    const t = setTimeout(() => setPeek((p) => (p?.k === lastMsg.k ? null : p)), 4500);
    return () => clearTimeout(t);
  }, [lastMsg, open, party.me]);
  const unread = open ? 0 : list.filter((m) => m.k > seen && m.who !== party.me).length;
  const nameOf = (id: string) => (id === party.me ? "You" : (party.players.find((p) => p.id === id)?.name ?? (id === "host" ? party.hostName : "Friend")));
  const mine = (id: string) => id === party.me;
  function send(e: React.FormEvent) {
    e.preventDefault();
    if (party.chat(text)) setText("");
  }
  const time = (at: number) => (at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close the chat" : `Open the chat${unread ? `, ${unread} new` : ""}`}
        className="fixed top-[calc(58%+2.75rem)] right-1.5 z-40 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-panel/90 text-fg shadow-lg backdrop-blur sm:top-[calc(50%+9.5rem)] sm:size-11"
      >
        <MessageCircle size={18} />
        {unread > 0 && <span className="absolute -top-1 -left-1 flex min-w-5 items-center justify-center rounded-full bg-alert px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {peek && !open && (
        <button type="button" onClick={() => setOpen(true)} className="fixed top-[calc(58%+2.75rem)] right-14 z-40 max-w-[65vw] -translate-y-1/2 rounded-2xl rounded-br-sm border border-line bg-panel/95 px-3 py-2 text-left text-sm shadow-xl backdrop-blur sm:top-auto sm:right-16 sm:bottom-24 sm:max-w-xs sm:translate-y-0">
          <span className="block text-[11px] font-semibold text-core">{nameOf(peek.who)}</span>
          <span className="line-clamp-3 break-words">{peek.text}</span>
        </button>
      )}

      {open && (
        <div role="dialog" aria-label="Game night chat" className="fixed inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] z-[70] flex h-[min(55dvh,26rem)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl sm:inset-x-auto sm:top-auto sm:right-16 sm:bottom-6 sm:h-[28rem] sm:w-80">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <MessageCircle size={15} className="text-core" />
            <span className="flex-1 text-sm font-semibold">Table chat</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the chat" className="rounded-full p-1 text-soft hover:text-fg">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
            {!list.length && <p className="pt-6 text-center text-sm text-faint">No messages yet. Say hi to the table!</p>}
            {list.map((m) => (
              <div key={m.k} className={cx("flex flex-col", mine(m.who) ? "items-end" : "items-start")}>
                {!mine(m.who) && <span className="mb-0.5 px-1 text-[11px] font-semibold text-soft">{nameOf(m.who)}</span>}
                <span className={cx("max-w-[85%] rounded-2xl px-3 py-1.5 text-sm break-words whitespace-pre-wrap", mine(m.who) ? "rounded-br-sm bg-core text-core-ink" : "rounded-bl-sm border border-line bg-white/[0.07] text-fg")}>{m.text}</span>
                <span className="mt-0.5 px-1 text-[10px] text-faint">{time(m.at)}</span>
              </div>
            ))}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-line p-2">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Message the table…" aria-label="Chat message" autoComplete="off" enterKeyHint="send" className="min-w-0 flex-1 rounded-full border border-line bg-sunken px-3 py-2 text-base sm:text-sm" />
            <button type="submit" disabled={!text.trim()} aria-label="Send" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-core text-core-ink disabled:opacity-40">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function VoiceChip({ party, compact }: { party: Party; /** Icon only on a phone (the game bar is tight). */ compact?: boolean }) {
  const v = party.voice;
  // The mic is off until this is tapped (the browser asks for permission then, not when joining).
  return (
    <button type="button" onClick={v.toggleMute} aria-label={v.muted ? "Turn your microphone on" : "Mute your microphone"} title={v.muted ? "Turn your microphone on" : "Mute your microphone"} className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", v.noMic ? "border-alert/50 text-alert" : v.muted ? "border-line text-faint hover:text-fg" : "border-ok/50 text-ok")}>
      {v.muted ? <MicOff size={13} /> : <Mic size={13} />} <span className={compact ? "hidden sm:inline" : undefined}>{v.noMic ? "Mic blocked" : v.muted ? "Mic off" : "Mic on"}</span>
      {v.muted && <span className="hidden sm:inline">· {v.noMic ? "tap to retry" : "tap to talk"}</span>}
    </button>
  );
}

function Lobby({ party, pals }: { party: Party; pals?: React.ReactNode }) {
  const host = party.role === "host";
  const here = party.players.filter((p) => p.online || p.host);
  const waiting = !host && !party.live;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pr-12 sm:pr-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users size={18} className="text-core" /> Game night
        </h2>
        <span className="font-mono text-xs text-faint">
          {here.length}/{MAX_PLAYERS} players
        </span>
        <span className="ml-auto">
          <VoiceChip party={party} />
        </span>
      </div>

      {host && party.stage !== "lobby" && (
        <p className="animate-pulse rounded-2xl border border-line bg-panel p-3 text-sm text-soft">Opening game night… (just after a reload this can take up to a minute)</p>
      )}
      {waiting ? (
        <div className="rounded-2xl border border-line bg-panel p-4 text-sm text-soft">
          <p className="animate-pulse">{party.stage === "reconnecting" ? `Waiting for ${party.hostName} to open game night… it connects as soon as they do.` : `Joining ${party.hostName}'s game night…`}</p>
          {party.note && <p className="mt-2 text-xs text-faint">{party.note}</p>}
          <p className="mt-2 text-[11px] text-faint">Still stuck? Both of you need to be on the same site, with {party.hostName} keeping the game night page open. Try a different browser, or turn off a VPN or &quot;block WebRTC&quot; setting.</p>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {party.players.map((p) => (
            <li key={p.id} className={cx("flex items-center gap-3 rounded-2xl border px-4 py-3", p.online || p.host ? "border-line bg-panel" : "border-line/50 bg-panel/40 opacity-60")}>
              <span className={cx("size-2.5 rounded-full", p.online || p.host ? "bg-ok shadow-[0_0_8px_rgba(74,222,128,.8)]" : "bg-faint")} />
              <span className="flex-1 truncate font-medium">
                {p.name}
                {p.id === party.me && <span className="ml-1.5 text-xs text-faint">(you)</span>}
              </span>
              {p.host && <Crown size={15} className="text-core" aria-label="Host" />}
              {!p.online && !p.host && <span className="text-xs text-faint">away</span>}
              {host && !p.host && !p.online && (
                <button type="button" onClick={() => party.removePlayer(p.id)} aria-label={`Remove ${p.name}`} className="rounded-full p-1 text-faint hover:text-alert">
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {pals}

      {host ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-soft">{here.length < 2 ? "Share your link: friends appear here as they join. Then pick a game." : "Pick a game: everyone's screen switches to it."}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {GAMES.map((g) => {
              const ok = g.ready && here.length >= g.min;
              return (
                <button
                  key={g.id}
                  type="button"
                  disabled={!ok}
                  onClick={() => g.ready && party.startGame(g.id as PartyGameKind)}
                  className={cx("flex items-start gap-3 rounded-2xl border p-4 text-left transition", ok ? "border-line bg-panel hover:border-core hover:bg-core/10" : "cursor-not-allowed border-line/50 bg-panel/40 opacity-50")}
                >
                  <span className="text-2xl">{g.emoji}</span>
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {g.name} <span className="font-mono text-[11px] font-normal text-faint">{g.min === g.max ? `${g.min}` : `${g.min}–${g.max}`} players</span>
                    </span>
                    <span className="block text-xs text-soft">{g.ready && here.length < g.min ? "Needs at least one friend." : g.about}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        party.live && <p className="rounded-2xl border border-dashed border-line p-4 text-center text-sm text-soft">You&apos;re in! {party.hostName} is picking a game…</p>
      )}
    </div>
  );
}

function GameScreen({ party, game, n, room }: { party: Party; game: PartyGameKind; n: number; room: string }) {
  const host = party.role === "host";
  const here = party.players.filter((p) => p.online || p.host);
  const me = party.players.find((p) => p.id === party.me);
  const props = { role: party.role, room, myName: me?.name ?? "You", hostName: party.hostName, party };
  // Ludo seats four: the rest of the lobby watches.
  const watching = ((game === "ludo" || game === "dots") && !here.slice(0, 4).some((p) => p.id === party.me)) || (game === "connect4" && here.length >= 2 && !here.slice(0, 2).some((p) => p.id === party.me));
  return (
    <div className="flex flex-col gap-3 pr-12 sm:pr-0">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel px-3 py-2 text-sm">
        {host ? (
          <button type="button" onClick={party.backToLobby} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-semibold hover:border-core hover:text-core">
            <Home size={13} /> Lobby
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-soft">
            <Layers size={13} /> Game night
          </span>
        )}
        <span className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {party.players.map((p) => (
            <span key={p.id} className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", p.online || p.host ? "bg-ok/10 text-fg" : "bg-panel text-faint line-through")}>
              {p.pet && (p.online || p.host) ? <MiniPet pet={p.pet} /> : <span className={cx("size-1.5 rounded-full", p.online || p.host ? "bg-ok" : "bg-faint")} />}
              {p.name}
            </span>
          ))}
        </span>
        <VoiceChip party={party} compact />
      </div>
      <PetRoam party={party} />
      {watching && <p className="text-sm text-soft">{game === "connect4" ? "Connect Four seats two" : game === "ludo" ? "Ludo seats four" : "Dots & Boxes seats four"}: you&apos;re watching this one. You&apos;ll be in the next game.</p>}
      {game === "cards" ? (
        <CardsGame key={`cards-${n}`} {...props} />
      ) : game === "ludo" ? (
        <LudoGame key={`ludo-${n}`} {...props} />
      ) : game === "dots" ? (
        <DotsGame key={`dots-${n}`} {...props} />
      ) : game === "snakes" ? (
        <SnakesGame key={`snakes-${n}`} myName={me?.name ?? "You"} party={party} />
      ) : game === "bingo" ? (
        <BingoGame key={`bingo-${n}`} myName={me?.name ?? "You"} party={party} />
      ) : game === "connect4" ? (
        <Connect4Game key={`connect4-${n}`} myName={me?.name ?? "You"} party={party} />
      ) : game === "business" ? (
        <BusinessGame key={`business-${n}`} myName={me?.name ?? "You"} party={party} />
      ) : game === "chess" ? (
        <ChessVsFriend key={`chess-${n}`} {...props} />
      ) : (
        <PartyDraw key={`draw-${n}`} party={party} />
      )}
    </div>
  );
}
