import "server-only";
import { obj, S, str } from "./shared";
import type { Tool } from "../types";

/** Music and video. */
export const media: Record<string, Tool> = {
  /* ───── music (plays in the owner's browser: the request is handed to the on-screen player) ───── */
  play_music: {
    name: "play_music",
    description:
      "Play music in HIVEMIND's own player on the owner's device (full songs, no ads, every Indian language). Use for ANY request to play / hear a song, artist, film's songs or mood, and for next / previous / pause / resume / stop. NEVER use web_task, YouTube or Spotify links for music. action: play (with query), add (play query next), next, previous, pause, resume, stop.",
    parameters: obj({ action: { type: "string", enum: ["play", "add", "next", "previous", "pause", "resume", "stop"] }, query: S }, ["action"]),
    async run(args, ctx) {
      const action = str(args.action) || "play";
      const query = str(args.query);
      if ((action === "play" || action === "add") && !query) return { error: "Say what to play." };
      ctx.actions.push({ label: query ? `♪ ${query}` : `♪ ${action}`, href: `music:${encodeURIComponent(JSON.stringify({ action, query }))}` });
      return { done: action, query, note: "It plays in the music bar at the bottom of the screen. Say the song request in a few words; don't add links." };
    },
  },

  play_video: {
    name: "play_video",
    description:
      "Play a video in HIVEMIND's video window on the owner's screen (YouTube's player, free): trailers, video songs, how-tos, clips. Also next / previous / pause / resume / close / fullscreen. NEVER use web_task or links for videos. action: play (with query), add (play next), next, previous, pause, resume, stop, fullscreen.",
    parameters: obj({ action: { type: "string", enum: ["play", "add", "next", "previous", "pause", "resume", "stop", "fullscreen"] }, query: S }, ["action"]),
    async run(args, ctx) {
      const action = str(args.action) || "play";
      const query = str(args.query);
      if ((action === "play" || action === "add") && !query) return { error: "Say what to watch." };
      ctx.actions.push({ label: query ? `▶ ${query}` : `▶ ${action}`, href: `video:${encodeURIComponent(JSON.stringify({ action, query }))}` });
      return { done: action, query, note: "It opens in the video window on screen. Say it in a few words; don't add links." };
    },
  },
};
