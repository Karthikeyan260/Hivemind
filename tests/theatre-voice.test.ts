import { describe, expect, it } from "vitest";
import { MOVIES } from "@/lib/theatre/catalog";
import { findTitle, normalise, parseDuration, parseRoomCommand, parseShelfCommand } from "@/lib/theatre/voice-commands";

const room = (s: string) => parseRoomCommand(s);

describe("voice commands in a room (English)", () => {
  it.each([
    ["play", { t: "play" }],
    ["Play.", { t: "play" }],
    ["please play the movie", { t: "play" }],
    ["resume", { t: "play" }],
    ["continue", { t: "play" }],
    ["pause", { t: "pause" }],
    ["Pause!", { t: "pause" }],
    ["hold on", { t: "pause" }],
    ["stop", { t: "pause" }],
    ["could you pause it please", { t: "pause" }],
  ])("%s", (said, want) => expect(room(said)).toEqual(want));

  it.each([
    ["forward", { t: "seek", by: 10 }],
    ["skip ahead", { t: "seek", by: 10 }],
    ["forward 30 seconds", { t: "seek", by: 30 }],
    ["skip 2 minutes", { t: "seek", by: 120 }],
    ["fast forward one minute", { t: "seek", by: 60 }],
    ["back", { t: "seek", by: -10 }],
    ["rewind", { t: "seek", by: -10 }],
    ["go back 30 seconds", { t: "seek", by: -30 }],
    ["rewind 5 minutes", { t: "seek", by: -300 }],
    ["restart", { t: "seekTo", to: 0 }],
    ["from the beginning", { t: "seekTo", to: 0 }],
    ["go to 45 minutes", { t: "seekTo", to: 2700 }],
    ["jump to 1 hour 20 minutes", { t: "seekTo", to: 4800 }],
    ["skip to 1:05:30", { t: "seekTo", to: 3930 }],
    ["seek to 12:30", { t: "seekTo", to: 750 }],
  ])("%s", (said, want) => expect(room(said)).toEqual(want));

  it.each([
    ["volume up", { t: "volume", by: 15 }],
    ["louder", { t: "volume", by: 15 }],
    ["turn it up", { t: "volume", by: 15 }],
    ["volume down", { t: "volume", by: -15 }],
    ["quieter", { t: "volume", by: -15 }],
    ["volume 40", { t: "volumeSet", to: 40 }],
    ["volume to 100", { t: "volumeSet", to: 100 }],
    ["volume 500", { t: "volumeSet", to: 100 }],
    ["mute", { t: "mute", on: true }],
    ["unmute", { t: "mute", on: false }],
    ["full screen", { t: "fullscreen", on: true }],
    ["fullscreen", { t: "fullscreen", on: true }],
    ["exit full screen", { t: "fullscreen", on: false }],
  ])("%s", (said, want) => expect(room(said)).toEqual(want));

  it.each([
    ["next episode", { t: "next" }],
    ["next", { t: "next" }],
    ["previous episode", { t: "prev" }],
    ["catch up", { t: "catchUp" }],
    ["sync", { t: "catchUp" }],
    ["invite friends", { t: "invite" }],
    ["copy link", { t: "invite" }],
    ["mic on", { t: "mic", on: true }],
    ["turn on the mic", { t: "mic", on: true }],
    ["mic off", { t: "mic", on: false }],
    ["mute mic", { t: "mic", on: false }],
    ["quality 480", { t: "quality", label: "480p" }],
    ["low quality", { t: "quality", label: "240p" }],
    ["high quality", { t: "quality", label: "Original" }],
    ["help", { t: "help" }],
    ["what can I say", { t: "help" }],
    ["leave", { t: "leave" }],
  ])("%s", (said, want) => expect(room(said)).toEqual(want));

  it("keeps the volume of the film apart from the microphone for talking", () => {
    expect(room("mute")).toEqual({ t: "mute", on: true });
    expect(room("mute mic")).toEqual({ t: "mic", on: false });
    expect(room("mic")).toBeNull(); // not enough to act on
  });

  it("types what you dictate into the chat, whatever the words are", () => {
    expect(room("say that was great")).toEqual({ t: "chat", text: "That was great" });
    expect(room("chat play the movie")).toEqual({ t: "chat", text: "Play the movie" }); // not a command inside the message
    expect(room("tell everyone I am back")).toEqual({ t: "chat", text: "I am back" });
    expect(room("say")).toBeNull();
  });

  it.each([
    ["laugh", "😂"],
    ["haha", "😂"],
    ["clap", "👏"],
    ["love", "❤️"],
    ["wow", "😮"],
    ["sad", "😢"],
    ["fire", "🔥"],
  ])("reacts to %s", (said, e) => expect(room(said)).toEqual({ t: "react", e }));

  it("picks another film or episode by name", () => {
    expect(room("play Mayabazar")).toEqual({ t: "pick", query: "mayabazar" });
    expect(room("watch attack on titan")).toEqual({ t: "pick", query: "attack on titan" });
    expect(room("switch to Ben 10")).toEqual({ t: "pick", query: "ben 10" });
  });

  it("ignores talk that isn't a command (the film's own dialogue, chatter, coughs)", () => {
    for (const said of ["", "   ", "uh", "I will never play with you again", "what a lovely day", "he told me to stop the car and run", "the movie is really good", "go to the market tomorrow morning", "1 2 3", "😂"]) {
      expect(room(said), said).toBeNull();
    }
  });

  it("never throws, whatever it hears", () => {
    for (const said of ["\u0000\u0001", "a".repeat(5000), "$$$ ((( ))) ***", "{ 't': 'play' }", "<script>alert(1)</script>", "play " + "x".repeat(300), "volume " + "9".repeat(50)]) {
      expect(() => room(said)).not.toThrow();
    }
  });
});

describe("voice commands in a room (Tamil)", () => {
  it.each([
    ["ஓடு", { t: "play" }],
    ["தொடங்கு", { t: "play" }],
    ["நிறுத்து", { t: "pause" }],
    ["நில்லு", { t: "pause" }],
    ["முன்னே", { t: "seek", by: 10 }],
    ["பின்னே", { t: "seek", by: -10 }],
    ["முன்னாடி 30 நொடி", { t: "seek", by: 30 }],
    ["பின்னாடி 2 நிமிடம்", { t: "seek", by: -120 }],
    ["சத்தம் அதிகம்", { t: "volume", by: 15 }],
    ["சத்தம் குறை", { t: "volume", by: -15 }],
    ["ம்யூட்", { t: "mute", on: true }],
    ["முழுத்திரை", { t: "fullscreen", on: true }],
    ["அடுத்தது", { t: "next" }],
    ["உதவி", { t: "help" }],
    ["சிரிப்பு", { t: "react", e: "😂" }],
    ["கைதட்டு", { t: "react", e: "👏" }],
    ["காதல்", { t: "react", e: "❤️" }],
  ])("%s", (said, want) => expect(room(said)).toEqual(want));

  it("dictates a chat message in Tamil", () => {
    expect(room("சொல்லு அருமையான படம்")).toEqual({ t: "chat", text: "அருமையான படம்" });
  });

  it("keeps Tamil letters when it cleans up the text", () => {
    expect(normalise("நிறுத்து!")).toBe("நிறுத்து");
    expect(normalise("  Play,  the   MOVIE ")).toBe("play the movie");
  });
});

describe("durations", () => {
  it.each([
    ["10 seconds", 10],
    ["ten seconds", 10],
    ["2 minutes", 120],
    ["half a minute", 30],
    ["half an hour", 1800],
    ["1 hour", 3600],
    ["1 hour 20 minutes", 4800],
    ["1:20:30", 4830],
    ["45:00", 2700],
    ["two and a half minutes", 150],
    ["soon", null],
  ])("%s", (said, want) => expect(parseDuration(said)).toBe(want));
});

describe("voice commands on the shelf", () => {
  const shelf = (s: string) => parseShelfCommand(s);

  it.each([
    ["search Mayabazar", { t: "search", q: "mayabazar" }],
    ["search for ben 10", { t: "search", q: "ben 10" }],
    ["find the lion guard", { t: "search", q: "lion guard" }],
    ["தேடு பைரவி", { t: "search", q: "பைரவி" }],
    ["show kids cartoons", { t: "group", g: "kids" }],
    ["kids", { t: "group", g: "kids" }],
    ["show anime", { t: "group", g: "anime" }],
    ["show Hollywood", { t: "group", g: "hollywood" }],
    ["show Korean", { t: "group", g: "korean" }],
    ["show world cinema", { t: "group", g: "world" }],
    ["show malayalam", { t: "group", g: "indian" }],
    ["show Tamil films", { t: "group", g: "tamil" }],
    ["show all", { t: "group", g: "all" }],
    ["கார்ட்டூன்", { t: "group", g: "kids" }],
    ["play ben 10", { t: "open", q: "ben 10" }],
    ["watch Mayabazar", { t: "open", q: "mayabazar" }],
    ["start", { t: "start" }],
    ["yes", { t: "start" }],
    ["start the screening", { t: "start" }],
    ["close", { t: "close" }],
    ["cancel", { t: "close" }],
    ["clear", { t: "clearSearch" }],
    ["back", { t: "back" }],
    ["help", { t: "help" }],
  ])("%s", (said, want) => expect(shelf(said)).toEqual(want));

  it("ignores chatter", () => {
    for (const said of ["", "hmm", "I like the weather today", "wow that is long"]) expect(shelf(said), said).toBeNull();
  });
});

describe("finding a film by what you said", () => {
  const list = [
    { title: "Mayabazar", series: null, ep: null },
    { title: "Pathala Bhairavi", series: null, ep: null },
    { title: "Attack on Titan · Episode 2", series: "Attack on Titan", ep: 2 },
    { title: "Attack on Titan · Episode 1", series: "Attack on Titan", ep: 1 },
    { title: "Ben 10 · Episode 1", series: "Ben 10 Classic · Season 1", ep: 1 },
    { title: "The Lion Guard · Episode 1", series: "The Lion Guard", ep: 1 },
  ];

  it("matches exact, partial and word-order-free names", () => {
    expect(findTitle("mayabazar", list)?.title).toBe("Mayabazar");
    expect(findTitle("maya", list)?.title).toBe("Mayabazar");
    expect(findTitle("bhairavi pathala", list)?.title).toBe("Pathala Bhairavi");
    expect(findTitle("lion guard", list)?.series).toBe("The Lion Guard");
  });

  it("starts a series at its first episode", () => {
    expect(findTitle("attack on titan", list)?.ep).toBe(1);
  });

  it("gives nothing when nothing is close", () => {
    expect(findTitle("zzzz qqqq", list)).toBeNull();
    expect(findTitle("a", list)).toBeNull();
    expect(findTitle("", list)).toBeNull();
  });

  it("finds real films in the catalogue", () => {
    expect(findTitle("mayabazar", MOVIES)?.id).toBe("mayabazar");
    expect(findTitle("chandralekha", MOVIES)?.title).toBe("Chandralekha");
    expect(findTitle("one punch man", MOVIES)?.series).toBeTruthy();
  });
});

describe("amounts survive the filler-word clean-up", () => {
  it("understands halves said naturally", () => {
    expect(parseRoomCommand("skip half a minute")).toEqual({ t: "seek", by: 30 });
    expect(parseRoomCommand("rewind two and a half minutes")).toEqual({ t: "seek", by: -150 });
  });
});
