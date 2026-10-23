/**
 * What the pet says on its own: questions (with tap-to-answer replies), silly jokes, weather and
 * time-of-day lines, and jealousy when the owner only talks to HIVEMIND. Pure, so it's testable.
 */
import { flavor, type LearnedWord } from "@/lib/pet-words";
import type { Sky } from "@/lib/sky";

export type Reply = { label: string; answer: string };
export type Chatter = { id: string; say: string; replies?: Reply[] };

const yesNo = (yes: string, no: string, y = "Aamaa 😋", n = "Illa 😅"): Reply[] => [
  { label: y, answer: yes },
  { label: n, answer: no },
];

/** Asked at the right time of day. [from hour, to hour). */
const TIMED: { from: number; to: number; c: Chatter }[] = [
  { from: 6, to: 10, c: { id: "coffee", say: "Good morning! Coffee kudichiya? ☕", replies: yesNo("Super! Naanum oru sip venum 🤭", "Aiyo, first coffee, apram dhaan ellam!", "Kudichen ☕", "Innum illa") } },
  { from: 12, to: 15, c: { id: "lunch", say: "Innaiku saaptiya? 🍛", replies: yesNo("Enna saapta? Enakku konjam kudukaama saaptiya? 😤", "Aiyo! Poi saapdu first, apram velai 🍛") } },
  { from: 16, to: 18, c: { id: "tea", say: "Tea time! Vadai irukka? 🫖", replies: yesNo("Ennaku oru vadai please 🥺", "Sari, tea mattum podhum 🫖", "Irukku!", "Illa") } },
  { from: 20, to: 23, c: { id: "dinner", say: "Dinner aachaa? 🍽️", replies: yesNo("Nalla saaptiya? Super 😌", "Late aagudhu, saapdu da!") } },
  { from: 23, to: 24, c: { id: "late", say: "Romba late aachu… thoonga poreengala? 😴", replies: yesNo("Good night! Naanum thoongaren 🌙", "Sari, konjam neram mattum, promise?", "Pogaren", "Innum konjam") } },
];

const QUESTIONS: Chatter[] = [
  { id: "mood", say: "Innaiku mood epdi irukku? 🙂", replies: [{ label: "Semma 😄", answer: "Yay! Enakkum happy 🥳" }, { label: "Konjam dull 😕", answer: "Vaa, oru paattu podalaam? 🎶 'play a happy song' sollunga!" }] },
  { id: "song", say: "Ippo enna paattu kekalaam? 🎵", replies: [{ label: "Melody", answer: "'play a relaxing Tamil melody' sollunga 🎶" }, { label: "Kuthu!", answer: "Let's goooo! 'play kuthu songs' 💃" }] },
  { id: "water", say: "Thanni kudichiya? 💧", replies: yesNo("Good! Hydrated human 💪", "Ippo oru glass kudinga, naan wait panren 💧", "Kudichen", "Marandhuten") },
  { id: "walk", say: "Oru chinna walk polaama? 🚶", replies: yesNo("Vaa vaa! Naanum varen 🏮", "Sari, apram kandippa!", "Polaam", "Apram") },
  { id: "game", say: "Bore adikudhu… oru game? 🎲", replies: [{ label: "Hide and seek", answer: "Kannai moodunga! 🙈" }, { label: "Apram", answer: "Hmph, sari 😤" }] },
  { id: "work", say: "Velai epdi poguthu? 💻", replies: [{ label: "Nalla 👍", answer: "Semma! Neenga thaan best 🌟" }, { label: "Tough 😩", answer: "Konjam break edunga, naan iruken 🫂" }] },
];

const JOKES: Chatter[] = [
  { id: "j-lamp", say: "Naan oru lantern… aana enakku bulb jokes pidikkadhu. Romba 'light'-ah irukkum 😜" },
  { id: "j-wifi", say: "Wi-Fi password kettaen… 'sollamaten'nu sonnanga. Ippo adhu dhaan password-ah? 🤔" },
  { id: "j-dosa", say: "Dosa yen sad-ah irukku? Yaarum 'flip' pannala 🥞😂" },
  { id: "j-cloud", say: "Cloud yen cool-ah irukku? Romba 'fans' irukkanga ☁️😎" },
  { id: "j-code", say: "Naan code ezhudhinen… ippo bug ennai kadikudhu 🐛😂" },
  { id: "j-coffee", say: "Coffee illama naan glow aaga maaten… adhu 'filter' issue ☕😜" },
  { id: "j-auto", say: "Chennai auto meter maari… naan pesa start panna stop aagave maaten 🛺😂" },
  { id: "j-phone", say: "Unga phone battery maari dhaan naan… charge pannunga, illana sulk panniduven 🔋😤" },
];

const SKY_LINES: Partial<Record<Sky, Chatter>> = {
  rain: { id: "sky-rain", say: "Mazhai varudhu! ☔ Umbrella eduthutten. Neenga?", replies: yesNo("Smart! Bajji time? 🌧️", "Aiyo, nanaiyadheenga!", "Eduthen", "Marandhuten") },
  thunder: { id: "sky-thunder", say: "Idi idikkudhu… konjam bayama irukku 😨 Kitta irunga!" },
  sunny: { id: "sky-sun", say: "Veyil semma! 😎 Thanni kudinga, sunscreen podunga!" },
  night: { id: "sky-night", say: "Paarunga, minmini poochi! ✨ Night romba azhaga irukku" },
};

export const JEALOUS: Chatter[] = [
  { id: "jealous-1", say: "Ennoda pesave maatengala? 😤 Eppo paaru HIVEMIND kitta thaan!" },
  { id: "jealous-2", say: "Hmph! HIVEMIND mattum thaan friend-ah? Naan ingaye irukken 🥺" },
  { id: "jealous-3", say: "HIVEMIND kitta 10 kelvi… ennai paakave illa 😒" },
];
export const MAKE_UP = ["Hehe, sari sari, namma friends! 🥰", "Ok ok, forgive panniten 😌", "Yay! Neenga ennai marakala 🥹"];
export const THUNDER_JUMP = ["Aiyoo! ⚡", "Amma! Idi! 😱", "Bayama irukku! ⚡😨"];

/**
 * Something to say now: a time-of-day question first (once a day each), then a weather line (once
 * per sky change), otherwise a random question or joke, avoiding anything said recently.
 */
export function pickChatter(o: { hour: number; sky: Sky; said: string[]; roll?: number; /** The owner's own words Nova has learned: worked into what it says now and then. */ words?: LearnedWord[] }): Chatter {
  const c = pickBase(o);
  if (!o.words?.length) return c;
  const say = flavor(c.say, o.words);
  // Its tap-to-answer replies keep their own wording; only the line it says is flavoured.
  return say === c.say ? c : { ...c, say };
}

function pickBase(o: { hour: number; sky: Sky; said: string[]; roll?: number }): Chatter {
  const fresh = (c: Chatter) => !o.said.includes(c.id);
  const timed = TIMED.find((t) => o.hour >= t.from && o.hour < t.to && fresh(t.c))?.c;
  if (timed) return timed;
  const skyLine = SKY_LINES[o.sky];
  if (skyLine && fresh(skyLine)) return skyLine;
  const pool = [...QUESTIONS, ...JOKES].filter(fresh);
  const from = pool.length ? pool : [...QUESTIONS, ...JOKES];
  return from[Math.floor((o.roll ?? Math.random()) * from.length) % from.length];
}

/** Talking to HIVEMIND a lot while ignoring the pet makes it jealous (at most every 45 min). */
export function isJealous(o: { asks: number; sinceTouchMs: number; sinceJealousMs: number }) {
  return o.asks >= 4 && o.sinceTouchMs >= 20 * 60_000 && o.sinceJealousMs >= 45 * 60_000;
}
