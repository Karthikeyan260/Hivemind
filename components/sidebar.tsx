"use client";

import { Blocks, ChefHat, PhoneIncoming, Share2, Zap, Brain, Briefcase, CalendarHeart, Compass, FileText, Globe, Map as MapIcon, FolderKanban, GitBranch, Lock, Radar, Search, Settings, Sparkles, StickyNote } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cx } from "@/components/ui";
import { clearOfflineCache } from "@/lib/offline";
import { useMyApps } from "@/components/apps/nav-apps";

const NAV = [
  { label: "HIVEMIND", href: "/", icon: Sparkles },
  { label: "Autopilot", href: "/autopilot", icon: Compass },
  { label: "Web tasks", href: "/web", icon: Globe },
  { label: "Map", href: "/map", icon: MapIcon },
  { label: "Apps", href: "/apps", icon: Blocks },
  { label: "Routines", href: "/routines", icon: Zap },
  { label: "Calls", href: "/calls", icon: PhoneIncoming },
  { label: "Share", href: "/share", icon: Share2 },
  { label: "Kitchen mode", href: "/focus", icon: ChefHat },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Memories", href: "/memories", icon: Brain },
  { label: "Career", href: "/career", icon: Briefcase },
  { label: "Journey", href: "/journey", icon: GitBranch },
  { label: "Habits", href: "/habits", icon: CalendarHeart },
  { label: "Notes", href: "/notes", icon: StickyNote },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Sources", href: "/sources", icon: Radar },
  { label: "Search", href: "/search", icon: Search },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

export function Sidebar({ canLock }: { canLock: boolean }) {
  const path = usePathname();
  const myApps = useMyApps();
  const router = useRouter();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  async function lock() {
    await fetch("/api/unlock", { method: "DELETE" });
    await clearOfflineCache();
    router.replace("/unlock");
    router.refresh();
  }

  return (
    <>
      {/* Laptop: slim labeled rail */}
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-line bg-sunken md:flex">
        <Link href="/" className="flex items-center gap-2.5 px-5 pb-6 pt-6">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-core opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-core" />
          </span>
          <span className="font-mono text-sm font-semibold tracking-[0.3em]">HIVEMIND</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
          {NAV.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={cx(
                "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                active(href) ? "bg-raised text-fg" : "text-soft hover:bg-raised/60 hover:text-fg",
              )}
            >
              <Icon size={16} strokeWidth={1.75} className={active(href) ? "text-core" : "text-faint group-hover:text-soft"} />
              {label}
            </Link>
          ))}
          {/* Apps HIVEMIND built: each one gets its own menu entry. */}
          {myApps.length > 0 && (
            <div className="mt-1 border-t border-line/60 pt-1">
              {myApps.map((a) => (
                <Link
                  key={a.id}
                  href={`/apps/${a.id}`}
                  aria-current={path === `/apps/${a.id}` ? "page" : undefined}
                  className={cx("flex items-center gap-3 rounded-md px-3 py-1.5 text-[13px]", path === `/apps/${a.id}` ? "bg-raised text-fg" : "text-soft hover:bg-raised/60 hover:text-fg")}
                >
                  <span className="w-4 text-center text-sm leading-none">{a.emoji}</span>
                  <span className="truncate">{a.name}</span>
                </Link>
              ))}
            </div>
          )}
        </nav>
        {canLock && (
          <button onClick={lock} className="mx-3 mb-4 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-faint hover:bg-raised/60 hover:text-fg">
            <Lock size={16} strokeWidth={1.75} /> Lock
          </button>
        )}
      </aside>

      {/* Phone: slim title bar; navigation is the bottom tab bar (components/mobile-nav.tsx) */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-sunken/95 px-4 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur md:hidden">
        <span className="h-2 w-2 rounded-full bg-core" />
        <Link href="/" className="font-mono text-xs font-semibold tracking-[0.3em]">
          HIVEMIND
        </Link>
        <span className="ml-auto truncate font-mono text-[10.5px] uppercase tracking-wider text-faint">{NAV.find((n) => n.href !== "/" && active(n.href))?.label}</span>
      </header>
    </>
  );
}
