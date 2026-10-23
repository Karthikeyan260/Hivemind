/** How a pet grows: the growth points each stage needs. Shared by the owner's Nova and the guest pets friends get at game night. */
export const STAGES = [
  { at: 0, name: "Star seed" },
  { at: 60, name: "Baby" },
  { at: 300, name: "Glowing" },
  { at: 900, name: "Crowned" },
] as const;

/** The stage (0..3) that `xp` growth points reach. */
export const stageFor = (xp: number) => STAGES.reduce((s, x, i) => (xp >= x.at ? i : s), 0);
