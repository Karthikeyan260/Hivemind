"use client";

import { Crown, Home, Layers, Mic, MicOff, Users, X } from "lucide-react";
import { CardsGame } from "@/components/games/cards-game";
import { ChessVsFriend } from "@/components/games/chess/vs-friend";
import { DotsGame } from "@/components/games/dots-game";
import { BusinessGame } from "@/components/games/business-game";
import { LudoGame } from "@/components/games/ludo-game";
import { SnakesGame } from "@/components/games/snakes-game";
import { PartyDraw } from "@/components/games/party-draw";
import { cx } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { useEffect, useState } from "react";
import { MAX_PLAYERS, type Party, PartyContext, type PartyFloat, type PartyGameKind, usePartyNet } from "@/lib/games/party";
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
  { id: "business", name: "Business", emoji: "🏦", min: 1, max: 6, about: "Buy Indian cities, charge rent, build hotels, bankrupt your friends. Pick a round limit for a quicker game.", ready: true },
];

export function PartyTable({ role, room, myName, hostName, onHostAway }: { role: "host" | "guest"; room: string; myName: string; hostName: string; onHostAway?: () => void }) {
  const party = usePartyNet({ role, room, myName, hostName, onHostAway });
  const ph = party.phase;
  const host = role === "host";

  // Voice: run game night by speaking ("let's play ludo", "back to the lobby", "who's here?", "mute me").
  useVoiceActions({
    party_game: {
      description: "Game night page: switch everyone to a game (the owner only). input: the game: Colour Clash (cards/uno), Ludo, Draw & Guess, Dots & Boxes or Chess. Then the game's own voice actions start it.",
      run: ({ input }) => {
        if (!host) return { error: "Only the host picks the game." };
        const id = spokenGame(String(input ?? ""));
        const g = GAMES.find((x) => x.id === id);
        if (!g) return { error: "Say a game: Colour Clash, Ludo, Draw & Guess, Dots & Boxes or Chess." };
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
        <Lobby party={party} />
      )}
      {(host ? party.stage !== "error" : party.live) && <Reactions party={party} />}
    </PartyContext.Provider>
  );
}

/** The reaction buttons (a slim bar at the side) and the reactions floating up from the bottom. */
function Reactions({ party }: { party: Party }) {
  const [floats, setFloats] = useState<PartyFloat[]>([]);
  const { onFloats } = party;
  useEffect(() => onFloats(setFloats), [onFloats]);
  const nameOf = (id: string) => (id === party.me ? "You" : (party.players.find((p) => p.id === id)?.name ?? (id === "host" ? party.hostName : "Friend")));
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" aria-live="polite">
        {floats.map((f) => (
          <span key={f.k} className="party-float absolute bottom-16 flex flex-col items-center" style={{ left: `${f.x}%` }}>
            <span className="text-4xl drop-shadow-lg">{f.e}</span>
            <span className="mt-0.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">{nameOf(f.who)}</span>
          </span>
        ))}
      </div>
      <div className="fixed top-[58%] right-1 z-40 flex -translate-y-1/2 flex-col gap-0.5 rounded-full border border-line bg-panel/70 p-0.5 shadow-lg backdrop-blur sm:top-1/2 sm:right-1.5 sm:gap-1 sm:bg-panel/85 sm:p-1" role="toolbar" aria-label="Reactions">
        {REACTIONS.map((e) => (
          <button key={e} type="button" onClick={() => party.react(e)} aria-label={`React ${e}`} className="flex size-7 items-center justify-center rounded-full text-base transition-transform hover:scale-125 active:scale-90 sm:size-9 sm:text-xl">
            {e}
          </button>
        ))}
      </div>
    </>
  );
}

function VoiceChip({ party }: { party: Party }) {
  const v = party.voice;
  return v.on ? (
    <button type="button" onClick={v.toggleMute} className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", v.muted ? "border-alert text-alert" : "border-ok/50 text-ok")}>
      {v.muted ? <MicOff size={13} /> : <Mic size={13} />} {v.muted ? "Muted" : "Voice on"}
    </button>
  ) : (
    <span className={cx("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", v.noMic ? "border-alert/50 text-alert" : "border-line text-faint")}>
      {v.noMic ? <MicOff size={13} /> : <Mic size={13} />} {v.noMic ? "Mic blocked" : "Voice"}
    </span>
  );
}

function Lobby({ party }: { party: Party }) {
  const host = party.role === "host";
  const here = party.players.filter((p) => p.online || p.host);
  const waiting = !host && !party.live;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
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
        <p className="animate-pulse rounded-2xl border border-line bg-panel p-4 text-sm text-soft">{party.stage === "reconnecting" ? `Waiting for ${party.hostName} to open game night… it connects as soon as they do.` : `Joining ${party.hostName}'s game night…`}</p>
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
  const watching = (game === "ludo" || game === "dots") && !here.slice(0, 4).some((p) => p.id === party.me);
  return (
    <div className="flex flex-col gap-3">
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
              <span className={cx("size-1.5 rounded-full", p.online || p.host ? "bg-ok" : "bg-faint")} />
              {p.name}
            </span>
          ))}
        </span>
        <VoiceChip party={party} />
      </div>
      {watching && <p className="text-sm text-soft">{game === "ludo" ? "Ludo" : "Dots & Boxes"} seats four: you&apos;re watching this one. You&apos;ll be in the next game.</p>}
      {game === "cards" ? (
        <CardsGame key={`cards-${n}`} {...props} />
      ) : game === "ludo" ? (
        <LudoGame key={`ludo-${n}`} {...props} />
      ) : game === "dots" ? (
        <DotsGame key={`dots-${n}`} {...props} />
      ) : game === "snakes" ? (
        <SnakesGame key={`snakes-${n}`} myName={me?.name ?? "You"} party={party} />
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
