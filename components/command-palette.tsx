"use client";

import { ArrowRight, CalendarHeart, CornerDownLeft, FolderKanban, Search, Sparkles, StickyNote } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { NAV } from "@/components/sidebar";
import { useMyApps } from "@/components/apps/nav-apps";
import { cx } from "@/components/ui";
import { score } from "@/lib/fuzzy";
import { api, PALETTE_EVENT, type Project } from "@/lib/client-api";

type Item = { id: string; group: string; label: string; hint?: string; href: string; icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; emoji?: string };
type Hit = { source_type: "note" | "memory" | "document"; source_id: string; parent_id: string; title: string; content: string };
type Habit = { id: string; name: string; emoji: string };

const KNOWLEDGE_PATH = { note: "notes", memory: "memories", document: "documents" } as const;

export function CommandPalette() {
  const router = useRouter();
  const apps = useMyApps();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [hits, setHits] = useState<{ q: string; list: Hit[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = () => {
    setOpen(false);
    setQ("");
    setCursor(0);
    setHits(null);
  };

  // Ctrl/Cmd+K anywhere, or "/" when you're not typing; also opened by the buttons.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const ask = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener(PALETTE_EVENT, ask);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener(PALETTE_EVENT, ask);
    };
  }, []);

  // When it opens: focus the box and fetch the small lists once.
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    let live = true;
    api<Project[]>("/api/projects").then((p) => live && Array.isArray(p) && setProjects(p)).catch(() => {});
    api<Habit[]>("/api/habits").then((h) => live && Array.isArray(h) && setHabits(h)).catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);

  // Meaning-based results from notes, memories and documents, once you pause typing.
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 3) return;
    let live = true;
    const t = setTimeout(() => {
      api<Hit[]>("/api/search", { method: "POST", json: { query: term, limit: 6 } })
        .then((list) => live && setHits({ q: term, list: Array.isArray(list) ? list : [] }))
        .catch(() => live && setHits({ q: term, list: [] }));
    }, 280);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open]);

  const items = useMemo(() => {
    const out: Array<Item & { s: number }> = [];
    const push = (it: Item, text: string) => {
      const s = score(text, q);
      if (s) out.push({ ...it, s });
    };
    for (const n of NAV) push({ id: "p" + n.href, group: "Go to", label: n.label, href: n.href, icon: n.icon }, n.label);
    for (const a of apps) push({ id: "a" + a.id, group: "Your apps", label: a.name, href: `/apps/${a.id}`, icon: Sparkles, emoji: a.emoji }, a.name);
    for (const p of projects) push({ id: "j" + p.id, group: "Projects", label: p.name, hint: p.status, href: `/projects/${p.id}`, icon: FolderKanban }, p.name);
    for (const h of habits) push({ id: "h" + h.id, group: "Habits", label: h.name, href: "/habits", icon: CalendarHeart, emoji: h.emoji }, h.name);
    // With no text yet, keep the page order; otherwise best match first within each group.
    const ordered = q.trim() ? out.sort((a, b) => b.s - a.s) : out;
    const groups: Record<string, number> = {};
    const capped = ordered.filter((it) => (groups[it.group] = (groups[it.group] ?? 0) + 1) <= (q.trim() ? 5 : it.group === "Go to" ? 40 : 4));
    const term = q.trim();
    const found = hits && hits.q === term ? hits.list : [];
    const knowledge: Item[] = found.map((h) => ({
      id: "k" + h.source_type + h.source_id,
      group: "From your notes and memories",
      label: h.title || h.content.slice(0, 60),
      hint: h.source_type,
      href: `/${KNOWLEDGE_PATH[h.source_type]}?open=${h.parent_id}`,
      icon: StickyNote,
    }));
    const tail: Item[] = term
      ? [{ id: "search-all", group: "Search", label: `Search everything for “${term}”`, href: "/search", icon: Search }]
      : [];
    return [...capped, ...knowledge, ...tail] as Item[];
  }, [q, apps, projects, habits, hits]);

  const at = Math.min(cursor, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at, items]);

  function go(it: Item | undefined) {
    if (!it) return;
    close();
    router.push(it.href);
  }

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[400] flex items-start justify-center px-3 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search and jump">
      <button aria-label="Close" onClick={close} className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-sm" tabIndex={-1} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((at + 1) % Math.max(1, items.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((at - 1 + items.length) % Math.max(1, items.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(items[at]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            placeholder="Jump to… or search what you know"
            className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={items[at] ? `pal-${at}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">esc</kbd>
        </div>
        <ul ref={listRef} id="palette-list" role="listbox" className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-soft">Nothing matches. Try fewer letters.</li>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            const Icon = it.icon;
            return (
              <li key={it.id} role="presentation">
                {head && <p className="px-3 pb-1 pt-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">{head}</p>}
                <button
                  id={`pal-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === at}
                  onMouseMove={() => i !== at && setCursor(i)}
                  onClick={() => go(it)}
                  className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm", i === at ? "bg-raised text-fg" : "text-soft")}
                >
                  {it.emoji ? <span className="w-4 text-center leading-none">{it.emoji}</span> : <Icon size={16} strokeWidth={1.75} className={i === at ? "text-core" : "text-faint"} />}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="shrink-0 text-xs text-faint">{it.hint}</span>}
                  {i === at && <CornerDownLeft size={13} className="shrink-0 text-faint" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-faint">
          <span className="flex items-center gap-1">
            <ArrowRight size={11} /> Enter to open
          </span>
          <span className="hidden sm:inline">↑ ↓ to move · Ctrl K any time</span>
        </div>
      </div>
    </div>
  );
}
