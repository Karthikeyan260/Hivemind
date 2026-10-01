"use client";

import { AudioLines, ExternalLink, Loader2, Mic, Phone, Send, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";
import { isPublicPage } from "@/lib/public-paths";
import { useVoice } from "./provider";

const STATUS = { off: "", connecting: "CONNECTING", listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING" } as const;

/** Floating live-voice control on every page except the bridge (which has its own console). */
export function VoiceDock() {
  const path = usePathname();
  const v = useVoice();
  const ring = useRef<HTMLSpanElement>(null);

  // The ring breathes with the actual loudness of the conversation.
  useEffect(() => {
    if (!v.on) return;
    let raf = 0;
    const tick = () => {
      if (ring.current) ring.current.style.transform = `scale(${1 + Math.min(1, v.level() * 2.2) * 0.45})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v.on, v]);

  if (path === "/" || isPublicPage(path)) return null;
  const text = v.last?.a || v.last?.q;

  return (
    <div className="pointer-events-none fixed bottom-[calc(var(--tabbar-h)+1rem)] right-4 md:bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 flex max-w-[min(26rem,calc(100vw-2rem))] flex-col items-end gap-2">
      {(v.on || v.error) && (
        <div className="pointer-events-auto w-full border border-data/30 bg-[#0b1016]/90 p-3 shadow-[0_0_30px_-8px_rgba(56,189,248,0.35)] backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] tracking-[0.2em] text-core">{v.on ? `LIVE · ${STATUS[v.state]}` : "VOICE"}</span>
            {v.on && (
              <button type="button" onClick={v.stop} aria-label="End conversation" className="text-faint hover:text-alert">
                <X size={13} />
              </button>
            )}
          </div>
          {v.error ? (
            <p className="mt-1.5 text-xs text-alert">{v.error}</p>
          ) : text ? (
            <p className={cx("mt-1.5 line-clamp-4 text-[13px] leading-snug", v.last?.a ? "text-fg" : "italic text-soft")}>{text}</p>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-soft">Just talk. Try “open career” or “summarise this page”.</p>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={v.toggle}
        aria-pressed={v.on}
        aria-label={v.on ? "End live conversation" : "Talk to HIVEMIND"}
        title={v.on ? "End conversation (Space / Esc)" : "Talk to HIVEMIND (Space)"}
        className={cx(
          "pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur-md transition-colors",
          v.on ? "border-alert bg-alert/15 text-alert" : "border-data/40 bg-[#0b1016]/80 text-data hover:border-core hover:text-core",
        )}
      >
        <span ref={ring} className={cx("absolute inset-0 rounded-full border transition-transform duration-75", v.on ? "border-alert/50" : "border-transparent")} aria-hidden />
        {v.state === "connecting" ? <Loader2 size={18} className="animate-spin" /> : v.on ? <AudioLines size={18} /> : <Mic size={18} />}
      </button>
    </div>
  );
}

/** Buttons voice prepared ("Call Arif", "WhatsApp Vijay"): one tap hands off to the phone/WhatsApp. */
export function HandoffCard() {
  const path = usePathname();
  const v = useVoice();
  if (!v.handoff.length || isPublicPage(path)) return null;
  return (
    <div className="fixed inset-x-4 bottom-[calc(var(--tabbar-h)+5rem)] z-50 mx-auto flex max-w-sm flex-col gap-2 border border-ok/40 bg-[#0b1016]/95 p-3 shadow-[0_0_30px_-8px_rgba(74,222,128,0.35)] backdrop-blur-md md:bottom-24">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.2em] text-ok">TAP TO CONTINUE</span>
        <button type="button" onClick={v.clearHandoff} aria-label="Dismiss" className="text-faint hover:text-fg">
          <X size={13} />
        </button>
      </div>
      {v.handoff.map((h) => (
        <a
          key={h.href}
          href={h.href}
          target={h.href.startsWith("http") ? "_blank" : undefined}
          rel="noopener noreferrer"
          onClick={() => setTimeout(v.clearHandoff, 300)}
          className="flex items-center justify-center gap-2 rounded-full bg-ok/90 py-2.5 text-sm font-medium text-black"
        >
          {h.href.startsWith("tel:") ? <Phone size={16} /> : /^https?:\/\/(?!wa\.me)/.test(h.href) ? <ExternalLink size={16} /> : <Send size={16} />} {h.label}
        </a>
      ))}
    </div>
  );
}
