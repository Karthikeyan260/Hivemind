import "server-only";
import twilio from "twilio";

// Real phone calls from the browser: Twilio Voice. The caller ID is the owner's own verified
// number (TWILIO_CALLER_ID), so people see who's calling; the Twilio number is the fallback.
const env = (k: string) => process.env[k]?.trim() || "";

export const twilioConfigured = () =>
  !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_API_KEY_SID") && env("TWILIO_API_KEY_SECRET") && env("TWILIO_TWIML_APP_SID") && callerId());

export const callerId = () => env("TWILIO_CALLER_ID") || env("TWILIO_PHONE_NUMBER");

/** Short-lived token that lets this browser place outgoing calls through the TwiML app. */
export function voiceToken(identity = "owner") {
  const { AccessToken } = twilio.jwt;
  const token = new AccessToken(env("TWILIO_ACCOUNT_SID"), env("TWILIO_API_KEY_SID"), env("TWILIO_API_KEY_SECRET"), { identity, ttl: 3600 });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: env("TWILIO_TWIML_APP_SID"), incomingAllow: false }));
  return token.toJwt();
}

/** True only for requests Twilio really sent (signed with the account's auth token). */
export function fromTwilio(signature: string | null, url: string, params: Record<string, string>) {
  return !!signature && twilio.validateRequest(env("TWILIO_AUTH_TOKEN"), signature, url, params);
}

/** International format check: "+" then 8-15 digits. */
export const isE164 = (n: string) => /^\+[1-9]\d{7,14}$/.test(n);

/** TwiML that rings `to` with the owner's caller ID (ringing is heard in the browser). */
export function dialTwiml(to: string) {
  const r = new twilio.twiml.VoiceResponse();
  // Calling your own mobile (e.g. to test): showing that same number as the caller fails, so use the Twilio number.
  const from = to === callerId() && env("TWILIO_PHONE_NUMBER") ? env("TWILIO_PHONE_NUMBER") : callerId();
  const dial = r.dial({ callerId: from, answerOnBridge: true, timeout: 40 });
  dial.number(to);
  return r.toString();
}

export function sayTwiml(text: string) {
  const r = new twilio.twiml.VoiceResponse();
  r.say(text);
  return r.toString();
}
