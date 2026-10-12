"use client";

import { Bot, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";

export type GameMode = "bot" | "friend";

/** Against HIVEMIND by default; a friend's knock (notification) opens the page with ?friend=1. */
export function useGameMode() {
  const [mode, setMode] = useState<GameMode>("bot");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the address
    if (new URLSearchParams(location.search).get("friend") === "1") setMode("friend");
  }, []);
  return [mode, setMode] as const;
}

export function ModeTabs({ mode, onChange }: { mode: GameMode; onChange: (m: GameMode) => void }) {
  return (
    <div className="mb-4 inline-flex rounded-full border border-line bg-panel p-1">
      {(
        [
          ["bot", "Play HIVEMIND", Bot],
          ["friend", "Play a friend", Users],
        ] as const
      ).map(([m, label, Icon]) => (
        <button key={m} type="button" onClick={() => onChange(m)} aria-pressed={mode === m} className={cx("flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold", mode === m ? "bg-core text-core-ink" : "text-soft hover:text-fg")}>
          <Icon size={15} /> {label}
        </button>
      ))}
    </div>
  );
}
