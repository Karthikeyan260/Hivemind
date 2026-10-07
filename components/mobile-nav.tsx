"use client";

import { Blocks, ChefHat, Gamepad2, Laugh, Moon, Newspaper, PhoneIncoming, Share2, Zap, Brain, Briefcase, CalendarHeart, Compass, FileText, Globe, Map as MapIcon, FolderKanban, GitBranch, Lock, Menu, Radar, Search, Settings, Sparkles, StickyNote, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { isPublicPage } from "@/lib/public-paths";
import { clearOfflineCache } from "@/lib/offline";
import { useMyApps } from "@/components/apps/nav-apps";

const TABS = [
  { label: "Home", href: "/", icon: Sparkles },
  { label: "Memories", href: "/memories", icon: Brain },
  { label: "Career", href: "/career", icon: Briefcase },
  { label: "Journey", href: "/journey", icon: GitBranch },
] as const;

const MORE = [
  { label: "Autopilot", href: "/autopilot", icon: Compass },
  { label: "Web tasks", href: "/web", icon: Globe },
  { label: "Map", href: "/map", icon: MapIcon },
  { label: "Apps", href: "/apps", icon: Blocks },
  { label: "Routines", href: "/routines", icon: Zap },
  { label: "Morning brief", href: "/brief", icon: Newspaper },
  { label: "Dream mode", href: "/dream", icon: Moon },
  { label: "Calls", href: "/calls", icon: PhoneIncoming },
  { label: "Share", href: "/share", icon: Share2 },
  { label: "Kitchen mode", href: "/focus", icon: ChefHat },
  { label: "Day comic", href: "/comic", icon: Laugh },
  { label: "Games", href: "/games", icon: Gamepad2 },
  { label: "Habits", href: "/habits", icon: CalendarHeart },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Notes", href: "/notes", icon: StickyNote },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Sources", href: "/sources", icon: Radar },
  { label: "Search", href: "/search", icon: Search },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

/** Phone navigation like a native app: a bottom tab bar, with the rest of the pages in a "More" sheet. */
export function MobileNav({ canLock }: { canLock: boolean }) {
  const path = usePathname();
  const myApps = useMyApps();
  const router = useRouter();
  const [more, setMore] = useState(false);
  const hidden = isPublicPage(path);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const inMore = MORE.some((m) => active(m.href));

  // Lets page layouts reserve space for the bar (see --tabbar-h in globals.css).
  useEffect(() => {
    document.documentElement.classList.toggle("has-tabbar", !hidden);
  }, [hidden]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the sheet after navigating
  useEffect(() => setMore(false), [path]);

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
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="More pages">
          <button type="button" aria-label="Close" onClick={() => setMore(false)} className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
          <div className="sheet-up absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-sunken px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[11px] tracking-[0.25em] text-faint">MORE</span>
              <button type="button" onClick={() => setMore(false)} aria-label="Close" className="-mr-2 p-2 text-soft">
                <X size={18} />
              </button>
            </div>
            <nav className="grid grid-cols-3 gap-2" aria-label="More pages">
              {MORE.map(({ label, href, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cx(
                    "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3.5 text-[12.5px]",
                    active(href) ? "border-core/50 bg-core/10 text-fg" : "border-line text-soft active:bg-raised",
                  )}
                >
                  <Icon size={20} strokeWidth={1.75} className={active(href) ? "text-core" : ""} />
                  {label}
                </Link>
              ))}
              {myApps.map((a) => (
                <Link
                  key={a.id}
                  href={`/apps/${a.id}`}
                  className={cx("flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3.5 text-[12.5px]", active(`/apps/${a.id}`) ? "border-core/50 bg-core/10 text-fg" : "border-line text-soft active:bg-raised")}
                >
                  <span className="text-xl leading-none">{a.emoji}</span>
                  <span className="max-w-full truncate">{a.name}</span>
                </Link>
              ))}
            </nav>
            {canLock && (
              <button type="button" onClick={lock} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-line py-3 text-sm text-soft active:bg-raised">
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
        {TABS.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={cx("flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[10.5px]", active(href) ? "text-fg" : "text-faint")}
          >
            <Icon size={20} strokeWidth={1.75} className={active(href) ? "text-core" : ""} />
            {label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-expanded={more}
          className={cx("flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[10.5px]", inMore || more ? "text-fg" : "text-faint")}
        >
          <Menu size={20} strokeWidth={1.75} className={inMore ? "text-core" : ""} />
          More
        </button>
      </nav>
    </>
  );
}
