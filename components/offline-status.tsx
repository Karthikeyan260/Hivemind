"use client";

import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { flush, getStatus, OFFLINE_STATUS, type OfflineStatus } from "@/lib/offline";
import { isPublicPage } from "@/lib/public-paths";

/** Small pill: offline, changes waiting to sync, syncing, or a sync problem. Hidden when all is well. */
export function OfflineStatusPill() {
  const path = usePathname();
  const [s, setS] = useState<OfflineStatus>(getStatus);
  useEffect(() => {
    const on = (e: Event) => setS((e as CustomEvent<OfflineStatus>).detail);
    window.addEventListener(OFFLINE_STATUS, on);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pick up status emitted before mount
    setS(getStatus());
    return () => window.removeEventListener(OFFLINE_STATUS, on);
  }, []);

  if (isPublicPage(path) || (s.online && !s.pending && !s.syncing && !s.error)) return null;
  const waiting = s.pending ? `${s.pending} change${s.pending === 1 ? "" : "s"} waiting` : "";
  const text = !s.online ? `Offline${waiting ? ` · ${waiting}` : " · notes & memories still work"}` : s.syncing ? "Syncing…" : s.error ? s.error : waiting;
  const Icon = !s.online ? CloudOff : s.error && !s.syncing ? TriangleAlert : RefreshCw;

  return (
    <button
      type="button"
      role="status"
      onClick={() => void flush()}
      disabled={!s.online || s.syncing}
      title={s.online ? "Sync now" : "Changes sync when you're back online"}
      className={cx(
        "fixed left-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 border bg-[#0b1016]/95 px-3 py-1.5 font-mono text-[11px] tracking-wide backdrop-blur-md",
        "bottom-[calc(var(--tabbar-h)+var(--music-h,0px)+1rem)] md:bottom-[calc(1rem+var(--music-h,0px))] md:left-56",
        s.error && s.online ? "border-alert/50 text-alert" : "border-line text-soft",
      )}
    >
      <Icon size={13} className={cx("shrink-0", s.syncing && "motion-safe:animate-spin")} />
      <span className="truncate">{text}</span>
    </button>
  );
}
