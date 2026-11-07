import type { Group } from "./catalog";
import { REACTIONS } from "./protocol";

/**
 * Hands-free control of Friends Theatre, in English and Tamil. A speech recogniser (the browser's own, see speech.ts) turns
 * what you say into text; these functions turn the text into a command. They are plain functions with no browser in them,
 * so every phrase can be tested. Unknown speech returns null and nothing happens: a film must never jump because someone
 * on the sofa coughed or the film's own dialogue was picked up.
 */

// ---- inside a room ----------------------------------------------------------------------------------------------------

export type RoomCommand =
  | { t: "play" }
  | { t: "pause" }
  | { t: "seek"; by: number }
  | { t: "seekTo"; to: number }
  | { t: "volume"; by: number }
  | { t: "volumeSet"; to: number }
  | { t: "mute"; on: boolean }
  | { t: "fullscreen"; on: boolean }
  | { t: "next" }
  | { t: "prev" }
  | { t: "catchUp" }
  | { t: "invite" }
  | { t: "mic"; on: boolean }
  | { t: "chat"; text: string }
  | { t: "react"; e: string }
  | { t: "pick"; query: string }
  | { t: "quality"; label: string }
  | { t: "leave" }
  | { t: "help" };

/** Lower case, no punctuation, single spaces; Tamil letters are kept. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s:]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Words said around a command that mean nothing ("please play the movie").
const FILLER = /\b(please|now|the|a|an|movie|film|video|show|it|just|can you|could you|will you|hey|ok|okay)\b/g;
const strip = (t: string) => t.replace(FILLER, " ").replace(/\s+/g, " ").trim();

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100, half: 0.5 };
const num = (s: string): number | null => {
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return NUMBER_WORDS[s] ?? null;
};

/** "10 seconds", "two minutes", "1 hour 20 minutes", "1:20:30", "45 minutes" -> seconds; null if there is no amount. */
export function parseDuration(text: string): number | null {
  const clock = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?(?=\s|$)/);
  if (clock) return clock[3] !== undefined ? +clock[1] * 3600 + +clock[2] * 60 + +clock[3] : +clock[1] * 60 + +clock[2];
  const half = text.match(/half (?:an? )?(hour|minute)/);
  const andHalf = text.match(/(\d+|[a-z]+) and (?:an? )?half (hours?|minutes?)/);
  if (andHalf) {
    const n = num(andHalf[1]);
    if (n !== null) return (n + 0.5) * (andHalf[2].startsWith("hour") ? 3600 : 60);
  }
  if (half) return half[1] === "hour" ? 1800 : 30;
  let total = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?|[a-z]+)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?|மணி|நிமிடம்|நிமிடங்கள்|நிமிஷம்|நொடி|வினாடி)/g;
  for (const m of text.matchAll(re)) {
    const n = num(m[1]);
    if (n === null) continue;
    found = true;
    const unit = m[2];
    total += /^(hour|hr|மணி)/.test(unit) ? n * 3600 : /^(min|நிமி)/.test(unit) ? n * 60 : n;
  }
  return found ? total : null;
}

const PLAY = /^(play|start|resume|continue|go|unpause|play it|play again|ஓடு|ஓட்டு|போடு|தொடங்கு|தொடங்கு|ப்ளே|ஆரம்பி|ஆரம்பிக்கவும்|தொடரு)$/;
const PAUSE = /^(pause|stop|hold|wait|hold on|freeze|நிறுத்து|நிறுத்தவும்|நில்லு|நில்|பாஸ்|ஸ்டாப்)$/;
const FORWARD = /^(?:fast )?(forward|skip|skip ahead|ahead|jump ahead|fast forward|முன்னே|முன்னாடி|முன்னோக்கி|ஃபார்வர்டு|தாவு)(?=\s|$)/;
const BACK = /^(back|rewind|go back|skip back|replay|jump back|பின்னே|பின்னாடி|பின்னோக்கி|ரிவைண்ட்)(?=\s|$)/;

const REACT_WORDS: Array<[RegExp, string]> = [
  [/(?:^|\s)(laugh|laughing|haha|lol|funny|சிரி|சிரிப்பு|காமெடி)(?=\s|$)/, "😂"],
  [/(?:^|\s)(clap|applause|bravo|well done|கைதட்டு|கைத்தட்டு|சபாஷ்)(?=\s|$)/, "👏"],
  [/(?:^|\s)(heart|love|like|காதல்|அன்பு|இதயம்)(?=\s|$)/, "❤️"],
  [/(?:^|\s)(wow|surprise|surprised|omg|shock|ஆச்சரியம்|வாவ்)(?=\s|$)/, "😮"],
  [/(?:^|\s)(sad|cry|crying|tears|அழு|சோகம்)(?=\s|$)/, "😢"],
  [/(?:^|\s)(fire|lit|awesome|mass|தீ|மாஸ்)(?=\s|$)/, "🔥"],
];

/** Turn what was said into a room command, or null when it isn't one. */
export function parseRoomCommand(said: string): RoomCommand | null {
  const raw = said.trim();
  if (!raw) return null;
  const t0 = normalise(raw);
  const t = strip(t0);
  if (!t) return null;

  // dictating a chat message wins over everything: whatever follows is the message
  const say = t0.match(/^(?:say|chat|message|type|tell everyone|tell them|send message|send|சொல்லு|சொல்|அனுப்பு)\s+(.+)$/u);
  if (say) {
    const text = say[1].trim();
    return text ? { t: "chat", text: text.charAt(0).toUpperCase() + text.slice(1) } : null;
  }

  if (/^(help|what can i say|commands|voice help|உதவி)$/.test(t)) return { t: "help" };
  if (/^(leave|leave room|exit room|go home|exit|வெளியேறு)$/.test(t)) return { t: "leave" };

  // microphone for talking to friends (before "mute", which is the film's sound)
  if (/(?:^|\s)(mic|microphone|talking|voice chat|மைக்)(?=\s|$)/.test(t)) {
    if (/(?:^|\s)(off|mute|stop|disable|close|நிறுத்து|ஆஃப்)(?=\s|$)/.test(t)) return { t: "mic", on: false };
    if (/(?:^|\s)(on|unmute|start|enable|open|ஆன்|தொடங்கு)(?=\s|$)/.test(t)) return { t: "mic", on: true };
    return null;
  }

  // volume and sound
  const volSet = t.match(/(?:^|\s)(?:volume|சத்தம்)\s+(?:to\s+|at\s+)?(\d{1,3})(?=\s|$)/);
  if (volSet) return { t: "volumeSet", to: Math.min(100, +volSet[1]) };
  if (/^(unmute|unmute sound|sound on|சத்தம் வை|அன்ம்யூட்)$/.test(t)) return { t: "mute", on: false };
  if (/^(mute|mute sound|sound off|silence|ம்யூட்|சத்தம் நிறுத்து)$/.test(t)) return { t: "mute", on: true };
  if (/(?:^|\s)(volume up|louder|increase volume|turn it up|turn up|raise volume|more volume|சத்தம் அதிகம்|சத்தம் கூட்டு|வால்யூம் அதிகம்)(?=\s|$)/.test(t) || /^volume (up|increase|higher)$/.test(t)) return { t: "volume", by: 15 };
  if (/(?:^|\s)(volume down|quieter|lower volume|decrease volume|turn it down|turn down|softer|less volume|சத்தம் குறை|சத்தம் குறைவு|வால்யூம் குறை)(?=\s|$)/.test(t) || /^volume (down|decrease|lower)$/.test(t)) return { t: "volume", by: -15 };

  // full screen
  if (/(?:^|\s)(exit full ?screen|leave full ?screen|close full ?screen|small screen|முழுத்திரை நிறுத்து)(?=\s|$)/.test(t)) return { t: "fullscreen", on: false };
  if (/(?:^|\s)(full ?screen|big screen|முழுத்திரை|பெரிய திரை)(?=\s|$)/.test(t)) return { t: "fullscreen", on: true };

  // other room actions
  if (/^(catch up|sync|resync|sync up|sync me|join them|ஒத்திசை)$/.test(t)) return { t: "catchUp" };
  if (/(?:^|\s)(invite|share link|copy link|invite friends|share the link|அழை|லிங்க்)(?=\s|$)/.test(t)) return { t: "invite" };
  if (/^(next|next episode|next one|play next|skip episode|next film|அடுத்தது|அடுத்த எபிசோட்)$/.test(t)) return { t: "next" };
  if (/^(previous|previous episode|last episode|previous one|go to previous|முந்தையது|முந்தைய எபிசோட்)$/.test(t)) return { t: "prev" };

  const q = t.match(/(?:^|\s)(?:quality|resolution)\s+(240|360|480|720|original|low|high|best)(?=\s|$)/) ?? t.match(/(?:^|\s)(low|high|best) quality(?=\s|$)/);
  if (q) {
    const w = q[1];
    return { t: "quality", label: w === "low" ? "240p" : w === "high" || w === "best" ? "Original" : /^\d+$/.test(w) ? `${w}p` : "Original" };
  }

  // start over / jump to a time
  if (/^(restart|start over|from the beginning|from beginning|beginning|play from start|replay from start|ஆரம்பத்திலிருந்து|முதலில் இருந்து)$/.test(t)) return { t: "seekTo", to: 0 };
  const jump = t.match(/(?:^|\s)(?:go to|jump to|seek to|skip to|move to|take me to|forward to|set time to|at)\s+(.+)$/);
  if (jump) {
    const d = parseDuration(jump[1]);
    if (d !== null) return { t: "seekTo", to: d };
  }

  // forward / back, with an optional amount
  const fwd = t.match(FORWARD);
  if (fwd) return { t: "seek", by: parseDuration(t) ?? 10 };
  const bk = t.match(BACK);
  if (bk) return { t: "seek", by: -(parseDuration(t) ?? 10) };

  if (PLAY.test(t)) return { t: "play" };
  if (PAUSE.test(t)) return { t: "pause" };

  // a reaction
  for (const [re, e] of REACT_WORDS) if (re.test(t) && REACTIONS.includes(e) && t.split(" ").length <= 3) return { t: "react", e };

  // "play X" / "watch X" / "open X": choose another film or episode
  const pick = t0.match(/^(?:play|watch|open|put on|switch to|change to|change film to|change movie to|show me|ஓட்டு|போடு|பார்க்க)\s+(.{2,})$/u);
  if (pick) {
    const query = strip(pick[1]);
    if (query.length >= 2) return { t: "pick", query };
  }
  return null;
}

// ---- on the shelf -----------------------------------------------------------------------------------------------------

export type ShelfCommand =
  | { t: "search"; q: string }
  | { t: "clearSearch" }
  | { t: "group"; g: Group | "all" }
  | { t: "open"; q: string }
  | { t: "start" }
  | { t: "close" }
  | { t: "back" }
  | { t: "help" };

const GROUP_WORDS: Array<[RegExp, Group | "all"]> = [
  [/(?:^|\s)(kids?|children|cartoons?|kid cartoons|கார்ட்டூன்|குழந்தைகள்|குட்டீஸ்)(?=\s|$)/, "kids"],
  [/(?:^|\s)(anime|அனிமே)(?=\s|$)/, "anime"],
  [/(?:^|\s)(hollywood|english movies|ஹாலிவுட்)(?=\s|$)/, "hollywood"],
  [/(?:^|\s)(korean|k ?drama|கொரிய|கொரியன்)(?=\s|$)/, "korean"],
  [/(?:^|\s)(world cinema|world movies|chinese|japanese|உலக சினிமா)(?=\s|$)/, "world"],
  [/(?:^|\s)(other indian|malayalam|telugu|kannada|hindi|indian languages|மலையாளம்|தெலுங்கு)(?=\s|$)/, "indian"],
  [/(?:^|\s)(tamil films?|tamil movies?|tamil|தமிழ் படம்|தமிழ்)(?=\s|$)/, "tamil"],
  [/(?:^|\s)(all|everything|home|all movies|எல்லாம்|அனைத்தும்)(?=\s|$)/, "all"],
];

export function parseShelfCommand(said: string): ShelfCommand | null {
  const t0 = normalise(said);
  const t = strip(t0);
  if (!t) return null;
  if (/^(help|what can i say|commands|voice help|உதவி)$/.test(t)) return { t: "help" };
  if (/^(clear|clear search|reset|reset search|clear filter|அழி)$/.test(t)) return { t: "clearSearch" };
  if (/^(start|start screening|start the screening|yes|confirm|watch together|go ahead|do it|screening|ஆமா|ஆம்|தொடங்கு)$/.test(t)) return { t: "start" };
  if (/^(close|cancel|no|never mind|dismiss|escape|மூடு|வேண்டாம்)$/.test(t)) return { t: "close" };
  if (/^(back|go back|home|தலைப்பு|திரும்பு)$/.test(t)) return { t: "back" };

  const search = t0.match(/^(?:search(?: for)?|find|look for|look up|தேடு|தேடுங்கள்)\s+(.{1,60})$/u);
  if (search) return { t: "search", q: strip(search[1]) || search[1] };

  const show = t.match(/^(?:show|show me|open|go to|switch to|filter|category|section|காட்டு|திற)\s+(.+)$/) ?? (t.split(" ").length <= 3 ? [t, t] : null);
  if (show) {
    for (const [re, g] of GROUP_WORDS) if (re.test(show[1])) return { t: "group", g };
  }

  const open = t0.match(/^(?:play|watch|open|put on|more about|details of|show details|ஓட்டு|போடு|பார்க்க)\s+(.{2,})$/u);
  if (open) return { t: "open", q: strip(open[1]) || open[1] };
  return null;
}

/** The best match for a spoken title among films and series, or null if nothing is close. */
export function findTitle<T extends { title: string; series: string | null; ep?: number | null }>(query: string, list: T[]): T | null {
  const q = normalise(query);
  if (q.length < 2) return null;
  const words = q.split(" ").filter((w) => w.length > 1);
  let best: { m: T; score: number } | null = null;
  for (const m of list) {
    const names = [normalise(m.title), m.series ? normalise(m.series) : ""].filter(Boolean);
    let score = 0;
    for (const n of names) {
      if (n === q) score = Math.max(score, 100);
      else if (n.startsWith(q)) score = Math.max(score, 80);
      else if (n.includes(q)) score = Math.max(score, 60);
      else if (words.length && words.every((w) => n.includes(w))) score = Math.max(score, 50);
      else if (words.length > 1) {
        const hit = words.filter((w) => n.includes(w)).length;
        if (hit / words.length >= 0.6) score = Math.max(score, 30 + hit);
      }
    }
    // prefer a series' first episode over a later one, and shorter titles over rambling ones
    if (score && m.series) score -= 1 + (m.ep ?? 0) / 1000;
    if (score) score -= Math.min(5, m.title.length / 40);
    if (score > (best?.score ?? 0)) best = { m, score };
  }
  return best && best.score >= 30 ? best.m : null;
}
