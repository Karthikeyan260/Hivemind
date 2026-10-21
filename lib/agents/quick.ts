/**
 * Simple screen switches answered at once, without asking the AI: "lights off", "weather effects
 * on", "Nova, lights off" (the lantern walk), "Nova be quiet", "make the music lights blue". The AI
 * took 10-17 s for these and, deep in a chat, sometimes flipped the wrong switch. Only short,
 * unambiguous commands match; anything else goes to the agents as usual.
 */
import { colorFromWords } from "@/lib/beat-color";

export type Quick = { args: { effect: "music_lights" | "weather" | "pet_voice" | "lantern_walk"; on: boolean; color?: string }; reply: string };

/**
 * "Show the garden for Deepavali", "garden in monsoon", "pongal island": open Nova's garden dressed
 * for that festival or season. Needs "garden" or "island" in it, so "Deepavali photos" still goes
 * to photos.
 */
export type GardenQuick = { fest: string; label: string; reply: string };
export function quickGarden(raw: string): GardenQuick | null {
  const m = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (m.length > 80 || !/\b(garden|island)\b|தோட்ட/.test(m)) return null;
  const pick: [RegExp, string, string, string][] = [
    [/deepavali|diwali|deewali|தீபாவளி/, "deepavali", "🎆", "Deepavali: clay lamps, a rangoli and fireworks"],
    [/karthigai|karthikai|deepam|கார்த்திகை/, "karthigai", "🪔", "Karthigai Deepam: oil lamps all along the path"],
    [/pongal|sankranti|பொங்கல்/, "pongal", "🌾", "Pongal: a kolam, sugarcane and a pongal pot"],
    [/monsoon|\brain(y)?\b|mazhai|மழை/, "monsoon", "🌧️", "the monsoon: puddles and frogs"],
  ];
  for (const [re, fest, icon, what] of pick) if (re.test(m)) return { fest, label: `${icon} Open the garden`, reply: `${icon} Here's Nova's garden for ${what}.` };
  if (/\b(normal|today|usual|back)\b/.test(m) && /\b(show|open|set|make)\b/.test(m)) return { fest: "today", label: "🌱 Open the garden", reply: "🌱 Nova's garden, as it is today." };
  return null;
}

/**
 * "Open nova garden", "go to settings", "take me to my photos", "let's play chess": open that page
 * at once (the AI took 10-15 s and sometimes only described it). Only a short command whose whole
 * object is a page name matches; "open my note about the trip" is a search, and goes to the agents.
 */
const PAGE_WORDS: [RegExp, string, string][] = [
  [/^(nova'?s? |my |the |pet'?s? |nova pet )?(garden|island|thottam)$/, "/garden", "🌱 Nova's garden"],
  [/^(the )?(home|bridge|console|galaxy|main page)$/, "/", "🏠 Home"],
  [/^(my )?(notes?)$/, "/notes", "📝 Notes"],
  [/^(my |the )?(memories|memory|memory palace|palace)$/, "/memories", "🧠 Memories"],
  [/^(my )?projects?$/, "/projects", "📁 Projects"],
  [/^(my )?(career|jobs?|resume)$/, "/career", "💼 Career"],
  [/^(my )?(journey|story|timeline)$/, "/journey", "🧭 Journey"],
  [/^(my )?(habits?|birthdays?)$/, "/habits", "✅ Habits"],
  [/^(my )?(documents?|docs|files)$/, "/documents", "📄 Documents"],
  [/^(my )?(sources?|imports?)$/, "/sources", "🔗 Sources"],
  [/^search$/, "/search", "🔎 Search"],
  [/^(the )?(settings?|preferences)$/, "/settings", "⚙️ Settings"],
  [/^(the )?autopilot$/, "/autopilot", "🛰️ Autopilot"],
  [/^(the )?web( tasks?)?$/, "/web", "🌐 Web tasks"],
  [/^(the )?maps?$/, "/map", "🗺️ Map"],
  [/^(my )?apps$/, "/apps", "🧩 Apps"],
  [/^(my )?routines?$/, "/routines", "⚡ Routines"],
  [/^share$/, "/share", "📤 Share"],
  [/^(my |the |today'?s |day )?comics?$/, "/comic", "🖍️ Day comic"],
  [/^(my )?(photos?|pictures|gallery)$/, "/photos", "🖼️ Photos"],
  [/^(my )?wrapped$/, "/wrapped", "🎁 My Wrapped"],
  [/^(the )?games?$/, "/games", "🎮 Games"],
  [/^(a |the )?(game night|party( games?)?|games? with (my )?friends)$/, "/games/party", "🎮 Game night"],
  [/^(a |the )?(game of )?chess$/, "/games/chess", "♟️ Chess"],
  [/^ludo$/, "/games/ludo", "🎲 Ludo"],
  [/^(snakes?( (and|&) ladders?)?|paramapadham)$/, "/games/snakes", "🐍 Snakes & Ladders"],
  [/^(bingo|housie|tambola)$/, "/games/bingo", "🎱 Bingo"],
  [/^(business|monopoly)( game)?$/, "/games/business", "🏦 Business"],
  [/^(the )?(paattu( quiz)?|song quiz)$/, "/games/paattu", "🎵 Paattu Quiz"],
  [/^(draw (and|&) guess|drawing)$/, "/games/draw", "✏️ Draw & Guess"],
  [/^(dots( and boxes)?)$/, "/games/dots", "🔲 Dots and Boxes"],
  [/^(cards|colou?r clash|uno)$/, "/games/cards", "🃏 Colour Clash"],
  [/^(my |the |morning )?brief$/, "/brief", "📰 Morning brief"],
  [/^(the )?dream( mode)?$/, "/dream", "🌙 Dream mode"],
  [/^(kitchen|focus|hands-?free)( mode)?$/, "/focus", "🍳 Kitchen mode"],
  [/^(my )?calls?$/, "/calls", "📞 Calls"],
];
export function quickPage(raw: string): { href: string; label: string; reply: string } | null {
  const m = raw
    .toLowerCase()
    .replace(/[.!?"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hey )?(hivemind|nova),?\s*/, "")
    .replace(/^(please|pls|can you|could you)\s+/, "")
    .replace(/\s+(please|pls)$/, "");
  if (m.length > 50) return null;
  const verb = /^(open(?: up)?|go to|goto|take me to|show(?: me)?|bring up|launch|let'?s play|play)\s+(.+?)(?:\s+(?:page|screen|tab|section))?$/.exec(m);
  if (!verb) return null;
  const what = verb[2].trim();
  // "play X" is music unless X is a game.
  const isPlay = /^(let'?s play|play)$/.test(verb[1]);
  for (const [re, href, label] of PAGE_WORDS) {
    if (!re.test(what)) continue;
    if (isPlay && !href.startsWith("/games")) return null;
    return { href, label, reply: `${label.split(" ")[0]} Opening ${label.slice(label.indexOf(" ") + 1)}.` };
  }
  return null;
}

/** "Nova, good night" / "good night Nova" / "Nova, sleep time": the bedtime routine in the garden. Needs Nova's name, so a plain "good night" stays a chat or routine. */
export function quickGoodNight(raw: string, pet = "nova"): boolean {
  const m = raw
    .toLowerCase()
    .replace(/[.!?"',]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const n = pet.toLowerCase();
  return m.length <= 40 && new RegExp(`^(${n} (good ?night|gn|sleep time|time to sleep|go to sleep|let'?s sleep)|(good ?night|gn) ${n})( da| ma| di)?$`).test(m);
}

export function quickEffect(raw: string): Quick | null {
  const m = raw
    .toLowerCase()
    .replace(/[.!?"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A polite word at either end never changes what is asked ("pink music lights please").
    .replace(/^(please|pls) /, "")
    .replace(/ (please|pls)$/, "");
  if (m.length > 60) return null;
  const nova = /^(hey )?nova\b,?/.test(m);
  const rest = m.replace(/^(hey )?nova\b,?\s*/, "").replace(/^(please|pls) /, "").replace(/ (please|pls)$/, "");

  // The pet's lantern walk: "Nova, lights off" starts it (the screen goes dark), "Nova, lights on" ends it.
  if (nova && /^(lights?|light) off$|^lantern walk$|^(start )?(the )?(lantern walk|spark hunt)$/.test(rest)) return { args: { effect: "lantern_walk", on: true }, reply: "Lights off! 🏮 Nova's lantern walk is on: find the sparks." };
  if (/^(start )?(a |the )?(lantern walk|spark hunt)$/.test(m)) return { args: { effect: "lantern_walk", on: true }, reply: "Lights off! 🏮 Nova's lantern walk is on: find the sparks." };
  if ((nova && /^(lights?|light) on$/.test(rest)) || /^(stop|end) (the )?(lantern walk|walk|spark hunt)$/.test(m)) return { args: { effect: "lantern_walk", on: false }, reply: "Lights on! 💡 The lantern walk is over." };

  // The pet's voice.
  if (nova && /^(be )?(quiet|silent)$|^(shut up|mute|stop talking|keep quiet|amaidhiya iru)$/.test(rest)) return { args: { effect: "pet_voice", on: false }, reply: "Nova will keep quiet now 🤐 (bubbles still show)." };
  if (nova && /^(you can )?(talk|speak)( again)?$|^unmute$|^(voice on|pesu)$/.test(rest)) return { args: { effect: "pet_voice", on: true }, reply: "Nova's voice is back on 🥳" };

  // Music lights colour: "make the music lights blue", "music lights rainbow", "pink music lights".
  const colourAsk = /^(make |set |turn |change )?(the )?(music )?lights? (to |colou?r to |colou?r )?([a-z#0-9 ]+)$/.exec(m) ?? /^([a-z#0-9]+) (music )?lights?$/.exec(m);
  if (colourAsk) {
    const word = colourAsk[5] ?? colourAsk[1];
    if (word && !/^(on|off)$/.test(word.trim())) {
      const c = colorFromWords(word);
      if (c) return { args: { effect: "music_lights", on: true, color: c }, reply: `Music lights are now ${c} ✨` };
    }
  }

  // Music lights / weather on and off.
  const onOff = (s: string) => (/\b(off|stop|disable|hide)\b/.test(s) ? false : /\b(on|start|enable|show|back)\b/.test(s) ? true : null);
  if (/^(turn |switch )?(the )?(music )?lights? (on|off)$|^(turn |switch )(on|off) (the )?(music )?lights?$/.test(m)) {
    const on = onOff(m)!;
    return { args: { effect: "music_lights", on }, reply: on ? "Music lights on ✨ (they glow with the beat when a song plays)." : "Music lights off 🌙 The music keeps playing." };
  }
  if (/^(turn |switch )?(the )?weather (effects?|animations?)( on| off)?$|^(turn |switch )(on|off) (the )?weather (effects?|animations?)$|^(stop|hide|show|start) the rain( on (the )?screen)?$/.test(m)) {
    const on = onOff(m);
    if (on === null) return null;
    return { args: { effect: "weather", on }, reply: on ? "Weather effects on 🌦️" : "Weather effects off. The screen is calm now." };
  }
  return null;
}
