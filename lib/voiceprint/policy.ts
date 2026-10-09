import { GUEST_TOOLS } from "@/lib/agents/guest";
import { isGuarded } from "@/lib/agents/intent";

/**
 * When HIVEMIND checks that it's really the owner speaking (only once a voiceprint is set up):
 * - ending guest mode ("come back"),
 * - anything that deletes, sends, calls, approves or changes (the guarded tools),
 * - and after a guest has talked in this conversation, anything that saves at all, since the guest
 *   may still be in the room ("yes, save it").
 * Reading and looking things up never need it.
 */
export function needsOwnerVoice(tool: string, opts: { guestSeen: boolean }) {
  if (tool === "guest_mode:end") return true;
  if (isGuarded(tool)) return true;
  return opts.guestSeen && !GUEST_TOOLS.has(tool);
}

export type Strictness = "relaxed" | "normal" | "strict";
/** Similarity to the owner's print needed to pass (same person ≈ 0.65–0.9, others ≈ 0.1–0.35). */
export const THRESHOLD: Record<Strictness, number> = { relaxed: 0.42, normal: 0.5, strict: 0.6 };

/** How well the enrolment takes agree with each other: a low score means noisy or mixed recordings. */
export function enrolQuality(selfSims: number[]): "good" | "ok" | "poor" {
  const min = Math.min(...selfSims);
  return min >= 0.8 ? "good" : min >= 0.65 ? "ok" : "poor";
}
