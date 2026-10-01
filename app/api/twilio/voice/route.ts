import { dialTwiml, fromTwilio, isE164, sayTwiml } from "@/lib/twilio";

const xml = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/xml" } });

/**
 * Twilio's webhook when the browser places a call: answers with "dial this number".
 * Open past the password gate (Twilio has no cookie), so it only obeys signed Twilio requests.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  // The URL Twilio signed is the public one it called, not the internal one behind the proxy.
  const url = `${process.env.APP_URL || new URL(req.url).origin}/api/twilio/voice`;
  if (!fromTwilio(req.headers.get("x-twilio-signature"), url, params)) return xml(sayTwiml("Unauthorized."), 403);
  const to = (params.To ?? "").replace(/[^\d+]/g, "");
  if (!isE164(to)) return xml(sayTwiml("That number isn't valid."));
  return xml(dialTwiml(to));
}
