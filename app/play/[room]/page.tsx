"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DrawGame } from "@/components/games/draw-game";
import { LudoGame } from "@/components/games/ludo-game";

/**
 * A friend's side of Draw & Guess (open to anyone with the link, no password): only the game, never
 * any of the owner's data. The game runs browser to browser. The friend's name is remembered in this
 * tab, so a reload or a quick look at another app goes straight back into the game.
 */
export default function PlayPage() {
  return (
    <Suspense>
      <Play />
    </Suspense>
  );
}

function Play() {
  const { room } = useParams<{ room: string }>();
  const params = useSearchParams();
  const host = (params.get("from") || "Your friend").slice(0, 30);
  // Which game the link is for (the same room serves every game; Draw & Guess when not given).
  const game = params.get("g") === "ludo" ? "ludo" : "draw";
  const title = game === "ludo" ? "Ludo" : "Draw & Guess";
  const key = `hm-play-${room}`;
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);

  // Already joined in this tab (reload, or the phone dropped the page): rejoin with the same name.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- only known in the browser
        setName(saved);
        setJoined(true);
      }
    } catch {}
  }, [key]);

  return (
    <main className="min-h-dvh bg-bg px-4 pb-[env(safe-area-inset-bottom)] pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="mb-3 font-mono text-[11px] tracking-[0.3em] text-faint">HIVEMIND · {title.toUpperCase()}</div>
      {joined && game === "ludo" ? (
        <LudoGame
          role="guest"
          room={room}
          myName={name.trim() || "Guest"}
          hostName={host}
          onHostAway={() => void fetch("/api/games/knock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, name: name.trim(), game: "ludo" }) }).catch(() => {})}
        />
      ) : joined ? (
        <DrawGame
          role="guest"
          room={room}
          myName={name.trim() || "Guest"}
          hostName={host}
          onHostAway={() => void fetch("/api/games/knock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, name: name.trim() }) }).catch(() => {})}
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              sessionStorage.setItem(key, name.trim());
            } catch {}
            setJoined(true);
          }}
          className="mx-auto mt-16 flex max-w-xs flex-col gap-3 text-center"
        >
          <h1 className="text-xl font-semibold">
            {host} challenged you to {title}
          </h1>
          <p className="text-sm text-soft">
            {game === "ludo" ? "Classic Ludo, you against your friend (and maybe HIVEMIND bots)." : "Take turns drawing and guessing. HIVEMIND, an AI, plays too."} Allow the microphone to talk while you play.
          </p>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} placeholder="Your name" aria-label="Your name" className="rounded-full border border-line bg-panel px-4 py-3 text-center text-sm" />
          <button type="submit" className="rounded-full bg-core py-3 text-sm font-semibold text-core-ink">
            Join the game
          </button>
        </form>
      )}
    </main>
  );
}
