"use client";

import { Loader2, ScrollText, Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import type { DailyKural } from "@/lib/kural";
import { isReading, onReading, readAloud, stopReading } from "@/lib/read-aloud";

export type KuralView = DailyKural & { speech: string };

/** Today's kural from the server (made on first ask each day, so it can take a few seconds). */
export function useKural(enabled = true) {
  const [k, setK] = useState<KuralView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/kural", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<KuralView>) : Promise.reject()))
      .then((x) => alive && setK(x))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return { kural: k, failed };
}

/** The verse (always the original text), the meanings, "for your day", and read-aloud. */
export function KuralCard({ k, compact }: { k: KuralView; compact?: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pick up a reading started elsewhere
    setOn(isReading());
    return onReading(setOn);
  }, []);
  return (
    <div className={cx("rounded-xl border border-core/30 bg-gradient-to-br from-core/10 to-transparent", compact ? "p-3" : "p-4")}>
      <div className="flex items-center gap-2">
        <ScrollText size={14} className="text-core" />
        <span className="min-w-0 text-[11.5px] font-semibold text-core" lang="ta">
          இன்றைய குறள் · {k.num} · {k.chapter.ta}
        </span>
        <button
          type="button"
          onClick={() => (on ? stopReading() : void readAloud(k.speech))}
          className={cx("ml-auto flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", on ? "bg-alert/15 text-alert" : "bg-core text-black")}
        >
          {on ? <Square size={11} /> : <Volume2 size={12} />} {on ? "Stop" : "Listen"}
        </button>
      </div>
      <p className={cx("mt-2 font-semibold leading-relaxed", compact ? "text-[14px]" : "text-[16px]")} lang="ta">
        {k.line1}
        <br />
        {k.line2}
      </p>
      {k.ta && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-soft" lang="ta">
          {k.ta}
        </p>
      )}
      <p className="mt-1 text-[13px] leading-relaxed text-soft">{k.en || k.pope}</p>
      {k.forYou && (
        <p className="mt-2 border-l-2 border-core/60 pl-2.5 text-[13px] leading-relaxed">
          <span className="font-semibold text-core">For your day: </span>
          {k.forYou}
        </p>
      )}
      {!compact && (
        <p className="mt-2 text-[10.5px] text-faint">
          {k.chapter.en} · Verse from the Thirukkural; meanings written by HIVEMIND{k.basedOn === "checkin" ? ", picked for last night's check-in" : k.basedOn === "chats" ? ", picked for last night's chats" : ""}. Pope (1886): “{k.pope}”
        </p>
      )}
    </div>
  );
}

/** For places that only want the card when it's ready. */
export function TodaysKural({ compact }: { compact?: boolean }) {
  const { kural, failed } = useKural();
  if (failed) return null;
  if (!kural)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line p-3 text-xs text-soft">
        <Loader2 size={13} className="animate-spin text-core" /> Choosing today&apos;s kural…
      </div>
    );
  return <KuralCard k={kural} compact={compact} />;
}
