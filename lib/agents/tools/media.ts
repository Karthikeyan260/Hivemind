import "server-only";
import { obj, S, str } from "./shared";
import type { Tool } from "../types";

/** Music and video. */
export const media: Record<string, Tool> = {
  /* ───── music (plays in the owner's browser: the request is handed to the on-screen player) ───── */
  play_music: {
    name: "play_music",
    description:
      "Play music in HIVEMIND's own player on the owner's device (full songs, no ads, every Indian language). Use for ANY request to play / hear a song, artist, film's songs or mood, and for next / previous / pause / resume / stop. NEVER use web_task, YouTube or Spotify links for music. action: play (with query: starts now, replaces the queue), add (with query: queues the song to play after the current one finishes, without stopping it; use for 'play X next', 'queue X', 'after this song play X', 'once this finishes play X'), next, previous, pause, resume, stop. When the owner complains about what played ('it's not an Ilaiyaraaja song', 'that's not Vijay'), they STILL WANT that artist: play again with the artist kept and spelled properly ('Ilaiyaraaja motivational songs'). 'no song playing' / 'play' after a request = play the same request again. NOT for 'music lights on/off' or 'lights off' (the screen glow): that's screen_effects, and the music keeps playing.",
    parameters: obj({ action: { type: "string", enum: ["play", "add", "next", "previous", "pause", "resume", "stop"] }, query: S }, ["action"]),
    async run(args, ctx) {
      const action = str(args.action) || "play";
      const query = str(args.query);
      if ((action === "play" || action === "add") && !query) return { error: "Say what to play." };
      ctx.actions.push({ label: query ? `♪ ${query}` : `♪ ${action}`, href: `music:${encodeURIComponent(JSON.stringify({ action, query }))}` });
      return { done: action, query, note: "It plays in the music bar at the bottom of the screen. Say the song request in a few words; don't add links." };
    },
  },

  screen_effects: {
    name: "screen_effects",
    description:
      "Turn HIVEMIND's screen effects on or off: music_lights (the app glowing and pulsing with the beat of the song playing), weather (rain / lightning / sunshine / night stars drawn over the app, from the real weather), pet_voice (the pocket pet Nova speaking out loud), or lights (music lights and weather together). 'lights off', 'turn off the effects', 'stop the rain on screen', 'nova be quiet' all mean this, NOT a routine and NOT stopping the music.",
    parameters: obj({ effect: { type: "string", enum: ["music_lights", "weather", "pet_voice", "lights"] }, on: { type: "boolean" } }, ["effect", "on"]),
    async run(args, ctx) {
      const effect = ["music_lights", "weather", "pet_voice", "lights"].includes(String(args.effect)) ? String(args.effect) : "lights";
      const on = args.on === true || args.on === "true";
      const label = { music_lights: "Music lights", weather: "Weather effects", pet_voice: "Nova's voice", lights: "Screen lights" }[effect];
      ctx.actions.push({ label: `${on ? "✨" : "🌙"} ${label} ${on ? "on" : "off"}`, href: `fx:${encodeURIComponent(JSON.stringify({ effect, on }))}` });
      return { done: `${label} turned ${on ? "on" : "off"} on this screen`, note: "It's a setting of this device's screen; the music (if any) keeps playing." };
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
