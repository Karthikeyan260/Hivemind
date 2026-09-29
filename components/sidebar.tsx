"use client";

import { Brain, Briefcase, FileText, FolderKanban, Lock, Radar, Search, Settings, Sparkles, StickyNote } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cx } from "@/components/ui";

const NAV = [
  { label: "HIVEMIND", href: "/", icon: Sparkles },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Memories", href: "/memories", icon: Brain },
  { label: "Career", href: "/career", icon: Briefcase },
  { label: "Notes", href: "/notes", icon: StickyNote },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Sources", href: "/sources", icon: Radar },
  { label: "Search", href: "/search", icon: Search },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

export function Sidebar({ canLock }: { canLock: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  async function lock() {
    await fetch("/api/unlock", { method: "DELETE" });
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
        </nav>
        {canLock && (
          <button onClick={lock} className="mx-3 mb-4 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-faint hover:bg-raised/60 hover:text-fg">
            <Lock size={16} strokeWidth={1.75} /> Lock
          </button>
        )}
      </aside>

      {/* Phone: top bar with scrollable nav */}
      <header className="sticky top-0 z-30 border-b border-line bg-sunken md:hidden">
        <div className="flex items-center gap-2 px-4 pt-3">
          <span className="h-2 w-2 rounded-full bg-core" />
          <span className="font-mono text-xs font-semibold tracking-[0.3em]">HIVEMIND</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 py-2" aria-label="Main">
          {NAV.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={cx(
                "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs",
                active(href) ? "bg-raised text-fg" : "text-soft",
              )}
            >
              <Icon size={14} className={active(href) ? "text-core" : ""} />
              {label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
