/**
 * Simple screen switches answered at once, without asking the AI: "lights off", "weather effects
 * on", "Nova, lights off" (the lantern walk), "Nova be quiet", "make the music lights blue". The AI
 * took 10-17 s for these and, deep in a chat, sometimes flipped the wrong switch. Only short,
 * unambiguous commands match; anything else goes to the agents as usual.
 */
import { colorFromWords } from "@/lib/beat-color";

export type Quick = { args: { effect: "music_lights" | "weather" | "pet_voice" | "lantern_walk"; on: boolean; color?: string }; reply: string };

export function quickEffect(raw: string): Quick | null {
  const m = raw
    .toLowerCase()
    .replace(/[.!?"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
