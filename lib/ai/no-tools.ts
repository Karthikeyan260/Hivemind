/**
 * When Gemini (the only model with HIVEMIND's tools) is down, chat falls back to a plain model that
 * can't do anything: no playing, saving, reminding or renaming. Free models still say "Done!" anyway,
 * so a request to DO something gets an honest "try again" instead of a made-up confirmation.
 */
export const ACTION_REQUEST =
  /^\s*(?:(?:hey |ok |okay )?(?:hivemind|nova)[, ]+)?(?:(?:please|pls|can you|could you|will you|kindly)\s+)?(?:play|pause|resume|stop|skip|queue|set|remind|schedule|rename|call|message|text|send|save|remember|note|add|create|make|build|delete|remove|cancel|move|reschedule|update|change|edit|log|mark|tick|check ?in|start|open|turn|switch|book|order|share|show|find my photos|hide|feed|run|forget)\b/i;

export const asksForAction = (message: string) => ACTION_REQUEST.test(message);

export const ACTION_BUSY_REPLY =
  "I couldn't do that just now: Google's AI (the part of me that plays, saves, reminds and changes things) is overloaded for a moment. Nothing was changed. Please ask again in a minute.";

/** Added to the plain model's instructions: it may answer, never claim it did something. */
export const NO_TOOLS_RULE =
  "Right now you have NO tools: you cannot play music, save, remind, rename, message, open or change anything. Never say or suggest you did, started or set something. If the owner asks you to do something, say it couldn't be done right now because the AI is busy and to ask again in a minute; answer questions normally.";
