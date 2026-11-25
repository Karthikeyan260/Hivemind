"use client";

import { Brain, Briefcase, GitBranch, Lock, Menu, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { cx } from "@/components/ui";
import { isPublicPage } from "@/lib/public-paths";
import { clearOfflineCache } from "@/lib/offline";
import { useMyApps } from "@/components/apps/nav-apps";
import { NAV_GROUPS } from "@/components/nav-config";

const TABS = [
  { label: "Home", href: "/", icon: Sparkles },
  { label: "Memories", href: "/memories", icon: Brain },
  { label: "Career", href: "/career", icon: Briefcase },
  { label: "Journey", href: "/journey", icon: GitBranch },
] as const;

// The bottom bar already holds Home, Memories, Career and Journey; the sheet lists everything else, in groups.
const TAB_HREFS: string[] = TABS.map((t) => t.href);
const MORE_GROUPS = NAV_GROUPS.map((g) => ({ title: g.title, items: g.items.filter((i) => !TAB_HREFS.includes(i.href)) })).filter((g) => g.items.length);
const MORE = MORE_GROUPS.flatMap((g) => g.items);
/** Each group's tint in the More sheet: today gold, getting things done blue, my life violet. */
const TINT = ["text-core bg-core/10 border-core/25", "text-data bg-data/10 border-data/25", "text-violet-300 bg-violet-400/10 border-violet-400/25"];

/** Phone navigation like a native app: a bottom tab bar, with the rest of the pages in a "More" sheet. */
export function MobileNav({ canLock }: { canLock: boolean }) {
  const path = usePathname();
  const myApps = useMyApps();
  const router = useRouter();
  const [more, setMore] = useState(false);
  const hidden = isPublicPage(path);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const inMore = MORE.some((m) => active(m.href));
  // which of the five slots is current (the four tabs, then More); the highlight slides to it
  const tabAt = TABS.findIndex((t) => active(t.href));
  const slot = tabAt >= 0 ? tabAt : inMore ? TABS.length : -1;

  // Lets page layouts reserve space for the bar (see --tabbar-h in globals.css).
  useEffect(() => {
    document.documentElement.classList.toggle("has-tabbar", !hidden);
  }, [hidden]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the sheet after navigating
  useEffect(() => setMore(false), [path]);

  // The sheet behaves like a dialog: focus moves into it, Esc closes it, and focus returns to "More".
  const moreBtn = useRef<HTMLButtonElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!more) return;
    const opener = moreBtn.current;
    sheet.current?.querySelector<HTMLElement>("nav a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMore(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [more]);

  if (hidden) return null;

  async function lock() {
    await fetch("/api/unlock", { method: "DELETE" });
    await clearOfflineCache();
    router.replace("/unlock");
    router.refresh();
  }

  return (
    <>
      {more && (
        <div ref={sheet} className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="More pages">
          <button type="button" aria-label="Close" onClick={() => setMore(false)} className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
          <div className="sheet-up absolute inset-x-0 bottom-0 flex max-h-[86dvh] flex-col rounded-t-2xl border-t border-line bg-sunken px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <span aria-hidden className="mx-auto -mt-1 mb-2 block h-1 w-10 shrink-0 rounded-full bg-line-strong" />
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <span className="font-mono text-[11px] tracking-[0.25em] text-faint">MORE</span>
              <button type="button" onClick={() => setMore(false)} aria-label="Close" className="-mr-2 p-2 text-soft">
                <X size={18} />
              </button>
            </div>
            <nav className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto overscroll-contain pb-1" aria-label="More pages">
              {MORE_GROUPS.map((g, gi) => (
                <div key={g.title} className="list-in col-span-3 grid grid-cols-3 gap-2">
                  <div className="hud-label col-span-3 mt-1 text-[9.5px] tracking-[0.2em]">{g.title.toUpperCase()}</div>
                  {g.items.map(({ label, href, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      className={cx(
                        "flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 py-2.5 text-center text-[12px] leading-tight",
                        active(href) ? "border-core/50 bg-core/10 text-fg" : "border-line text-soft active:bg-raised",
                      )}
                    >
                      <span className={cx("grid size-9 place-items-center rounded-lg border", active(href) ? "border-core/50 bg-core/15 text-core" : TINT[gi % TINT.length])}>
                        <Icon size={18} strokeWidth={1.75} />
                      </span>
                      {label}
                    </Link>
                  ))}
                </div>
              ))}
              {myApps.map((a) => (
                <Link
                  key={a.id}
                  href={`/apps/${a.id}`}
                  className={cx("flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 py-2.5 text-center text-[12px] leading-tight", active(`/apps/${a.id}`) ? "border-core/50 bg-core/10 text-fg" : "border-line text-soft active:bg-raised")}
                >
                  <span className="text-xl leading-none">{a.emoji}</span>
                  <span className="max-w-full truncate">{a.name}</span>
                </Link>
              ))}
            </nav>
            {canLock && (
              <button type="button" onClick={lock} className="mt-2 flex w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-sm text-soft active:bg-raised">
                <Lock size={16} /> Lock
              </button>
            )}
          </div>
        </div>
      )}

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-sunken/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {slot >= 0 && (
          <span aria-hidden className="tab-mark pointer-events-none absolute top-0 left-0 h-14 w-1/5" style={{ transform: `translateX(${slot * 100}%)` }}>
            <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-core shadow-[0_0_10px_var(--core)]" />
            <span className="absolute top-[7px] left-1/2 h-7 w-12 -translate-x-1/2 rounded-full bg-core/10" />
          </span>
        )}
        {TABS.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={cx("relative flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[10.5px] transition-colors", active(href) ? "text-fg" : "text-faint")}
          >
            <Icon size={20} strokeWidth={1.75} className={active(href) ? "text-core" : ""} />
            {label}
          </Link>
        ))}
        <button
          type="button"
          ref={moreBtn}
          onClick={() => setMore(true)}
          aria-expanded={more}
          aria-haspopup="dialog"
          className={cx("relative flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[10.5px] transition-colors", inMore || more ? "text-fg" : "text-faint")}
        >
          <Menu size={20} strokeWidth={1.75} className={inMore ? "text-core" : ""} />
          More
        </button>
      </nav>
    </>
  );
}
