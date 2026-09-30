import type { Commit } from "../git-graph";
import type { Age } from "./avatar";
import { type SceneKind, sceneFor } from "./scenes";

/** Imperative controls shared by the 2D and 3D life-story views (used by the page and voice). */
export type StoryHandle = { goTo: (i: number) => void; next: () => void; prev: () => void; replay: () => void; tour: (on: boolean) => void; index: () => number };

export type Stage = { commit: Commit; scene: SceneKind; age: Age; line: string };

const an = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
export const year = (c: Commit) => c.at.slice(0, 4);

/** First-person line for each milestone, built only from the stored data. */
function lineFor(c: Commit, scene: SceneKind, certs?: Commit): string {
  // Keep spoken lines short: whole sentences up to ~200 characters (the full text is in Log view).
  // Split on ". " before a capital, so numbers like "1.6M" stay intact.
  const sentences = (c.description ?? "").split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean);
  let short = "";
  for (const x of sentences) {
    if (short && (short + " " + x).length > 200) break;
    short = short ? `${short} ${x}` : x;
  }
  const desc = short ? ` ${short.trim()}` : "";
  switch (scene) {
    case "school":
      return `This is me at ${c.subtitle ?? "school"}. In ${year(c)} I completed my ${c.title.replace(/ completed$/, "")}.${desc}`;
    case "college":
      return `In ${year(c)} I started my ${c.subtitle ?? c.title}. Over the next four years: internships, projects${certs ? ` and ${certs.title.toLowerCase()}` : ""}.`;
    case "lab":
    case "remote":
      return `I worked as ${an(c.title)} ${c.title} at ${c.subtitle?.split("·")[0]?.trim()}.${desc}`;
    case "desk":
      return c.id.startsWith("minor:") ? `In ${year(c)} I also built ${c.subtitle}.` : `I built ${c.title}: ${c.subtitle ?? ""}.${desc}`;
    case "certs":
      return `Along the way I earned ${c.title}: ${c.subtitle}.`;
    case "graduation":
      return `${year(c)}: I graduated from ${c.subtitle}.${desc}`;
    case "office":
      return `Today I'm ${an(c.title)} ${c.title} at ${c.subtitle?.split("·")[0]?.trim()}.${desc}`;
    case "future":
      return "And this is where I am now, still building. Through that door is the next version of me.";
  }
}

function ageFor(scene: SceneKind, i: number, stages: { scene: SceneKind }[]): Age {
  if (scene === "school") return stages.findIndex((s) => s.scene === "school") === i ? "kid" : "teen";
  if (scene === "graduation") return "grad";
  if (scene === "office") return "pro";
  if (scene === "future") return "future";
  return "student";
}

export function buildStages(commits: Commit[]): Stage[] {
  const certs = commits.find((c) => c.kind === "milestone");
  const base = commits.map((c) => ({ commit: c, scene: sceneFor(c) }));
  return base.map((s, i) => ({ ...s, age: ageFor(s.scene, i, base), line: lineFor(s.commit, s.scene, certs) }));
}
