import type { LucideIcon } from "lucide-react";
import { Activity, Blocks, Brain, Briefcase, CalendarHeart, CalendarRange, ChefHat, Clapperboard, Compass, FileText, FolderKanban, Gamepad2, GitBranch, Globe, Images, Laugh, Map as MapIcon, MicVocal, Moon, Newspaper, PartyPopper, PhoneIncoming, Radar, Search, Settings, Share2, Sparkles, StickyNote, Sprout, Zap } from "lucide-react";

/** Every page, grouped for the menus (laptop sidebar and the phone "More" sheet). The home page sits above the groups. */
export type NavItem = { label: string; href: string; icon: LucideIcon };

export const HOME: NavItem = { label: "HIVEMIND", href: "/", icon: Sparkles };

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Today",
    items: [
      { label: "Morning brief", href: "/brief", icon: Newspaper },
      { label: "Habits", href: "/habits", icon: CalendarHeart },
      { label: "This week", href: "/weekly", icon: CalendarRange },
      { label: "Routines", href: "/routines", icon: Zap },
      { label: "Notes", href: "/notes", icon: StickyNote },
      { label: "Documents", href: "/documents", icon: FileText },
    ],
  },
  {
    title: "Get things done",
    items: [
      { label: "Autopilot", href: "/autopilot", icon: Compass },
      { label: "Web tasks", href: "/web", icon: Globe },
      { label: "Apps", href: "/apps", icon: Blocks },
      { label: "Mission control", href: "/mission", icon: Activity },
      { label: "Map", href: "/map", icon: MapIcon },
      { label: "Calls", href: "/calls", icon: PhoneIncoming },
      { label: "Share", href: "/share", icon: Share2 },
      { label: "Kitchen mode", href: "/focus", icon: ChefHat },
    ],
  },
  {
    title: "My life",
    items: [
      { label: "Memories", href: "/memories", icon: Brain },
      { label: "Career", href: "/career", icon: Briefcase },
      { label: "Journey", href: "/journey", icon: GitBranch },
      { label: "Projects", href: "/projects", icon: FolderKanban },
      { label: "Photos", href: "/photos", icon: Images },
      { label: "My Wrapped", href: "/wrapped", icon: PartyPopper },
      { label: "Sources", href: "/sources", icon: Radar },
    ],
  },
  {
    title: "Play",
    items: [
      { label: "Games", href: "/games", icon: Gamepad2 },
      { label: "Karaoke", href: "/karaoke", icon: MicVocal },
      { label: "Friends theatre", href: "/theatre", icon: Clapperboard },
      { label: "Day comic", href: "/comic", icon: Laugh },
      { label: "Nova's garden", href: "/garden", icon: Sprout },
      { label: "Dream mode", href: "/dream", icon: Moon },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Search", href: "/search", icon: Search },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

/** Flat list (home first); the command palette and the phone title bar use it. */
export const NAV: NavItem[] = [HOME, ...NAV_GROUPS.flatMap((g) => g.items)];
