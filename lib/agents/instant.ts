import "server-only";
import { TOOLS } from "./tools";
import type { RunContext } from "./types";

/**
 * Everyday questions answered straight from the data, without the AI: "where am I", "what's the
 * weather", "my habits today", "how is Nova". Each took two model calls (pick the tool, then word
 * the answer): 7-25 s, worse when the free model stalled. Now about a second. Only a short message
 * that is exactly one of these matches; anything more ("weather tomorrow in Ooty for a trip?")
 * still goes to the agents, which can reason about it.
 */
export type Instant = { tool: string; run: (ctx: RunContext) => Promise<string | null> };

const clean = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hey |hi |ok )?(hivemind|nova)\b,?\s*/, "")
    .replace(/^(please |pls |can you tell me |tell me )/, "")
    .replace(/\s+(please|pls|now|right now)$/, "");

const round = (n: number) => Math.round(n);

export function instantAnswer(raw: string): Instant | null {
  const m = clean(raw);
  if (m.length > 60) return null;

  if (/^(where am i|where i am|where are we|my (current |live |present |exact )?(location|place|area)|which (area|place|town|city) (am i in|is this)|what('s| is) my (current |live )?location)$/.test(m))
    return {
      tool: "where_am_i",
      run: async (ctx) => {
        if (!ctx.location) return null; // no fix from this device: the agent explains how to share it
        const r = (await TOOLS.where_am_i.run({}, ctx)) as { address?: string; city?: string; accuracy?: string; error?: string };
        if (r.error || !r.address) return null;
        const town = r.city && !r.address.includes(r.city) ? `, ${r.city}` : "";
        return `📍 You're at **${r.address}${town}**.${r.accuracy && r.accuracy !== "precise" ? `\n\n_${r.accuracy[0].toUpperCase()}${r.accuracy.slice(1)}._` : ""}`;
      },
    };

  const weather = /^(what('s| is) |how('s| is) )?(the |today'?s )?weather( like)?( today| outside| now)?( (in|at|for) ([a-z][a-z .'-]{1,40}))?$|^(is it|will it) rain(ing)?( today| now)?$/.exec(m);
  if (weather)
    return {
      tool: "get_weather",
      run: async (ctx) => {
        const place = weather[9]?.trim();
        const w = (await TOOLS.get_weather.run(place ? { place } : {}, ctx)) as {
          place: string;
          current: { temp_c: number; feels_like_c: number; humidity_pct: number; condition: string; rain_mm: number };
          days: { date: string; max_c: number; min_c: number; rain_chance_pct: number; condition: string }[];
        };
        const c = w.current;
        const today = w.days[0];
        const rain = today ? (today.rain_chance_pct >= 60 ? " Carry an umbrella ☔" : today.rain_chance_pct >= 30 ? " Maybe keep an umbrella handy." : "") : "";
        return `🌦️ **${w.place}**: ${round(c.temp_c)}°, ${c.condition} (feels like ${round(c.feels_like_c)}°, humidity ${c.humidity_pct}%).${today ? `\n\nToday ${round(today.min_c)}–${round(today.max_c)}°, ${today.rain_chance_pct}% chance of rain.${rain}` : ""}`;
      },
    };

  if (/^((what are|show|list) )?(my |today'?s )?habits( today| for today| status)?$|^(have i|did i) (done|do|finish(ed)?) my habits( today)?$/.test(m))
    return {
      tool: "habits_status",
      run: async (ctx) => {
        const r = (await TOOLS.habits_status.run({}, ctx)) as { habits: { name: string; due_today: boolean; done_today: boolean; streak: number }[] };
        if (!r.habits?.length) return "You're not tracking any habits yet. Say “add a habit to walk at 7 am” to start one 🌱";
        const due = r.habits.filter((h) => h.due_today);
        const done = due.filter((h) => h.done_today);
        const line = (h: (typeof due)[number]) => `- ${h.done_today ? "✅" : "⬜"} ${h.name}${h.streak > 1 ? ` · 🔥 ${h.streak}-day streak` : ""}`;
        if (!due.length) return "No habits due today. Enjoy the day off 🌴";
        const head = done.length === due.length ? `All ${due.length} done today, nice work! 🎉` : `${done.length} of ${due.length} done today.`;
        return `${head}\n\n${due.map(line).join("\n")}`;
      },
    };

  if (/^(how is|how'?s|hows) (nova|my pet|my nova|the pet)( doing)?$|^(is )?(nova|my pet) (hungry|ok|okay|happy)$/.test(m))
    return {
      tool: "my_pet",
      run: async (ctx) => {
        const r = (await TOOLS.my_pet.run({}, ctx)) as { name?: string; stage?: string; mood?: string; says?: string; fed_today?: string; to_next_stage?: string | number; error?: string };
        if (r.error || !r.name) return null;
        const left = String(r.to_next_stage ?? "");
        const next = /^\d+$/.test(left) ? `${left} growth points to its next stage` : left || "fully grown";
        return `🏮 **${r.name}** is ${r.mood ?? "around"} · ${r.stage}.${r.says ? `\n\n> “${r.says}”` : ""}\n\nFed today: ${r.fed_today}. ${next[0].toUpperCase()}${next.slice(1)}.`;
      },
    };

  return null;
}
