import { NextResponse, type NextRequest } from "next/server";
import { isUnlocked, misconfigured, SESSION_COOKIE } from "@/lib/session";

// Every page and API route is private to the owner. Only /unlock, its API, and the app manifest
// (name + icons, fetched by the phone without cookies when installing), the notification service
// worker, and the call "ring" and screening a guest triggers (they only work for rooms the owner created) are open.
const OPEN_PATHS = ["/unlock", "/api/unlock", "/manifest.webmanifest", "/sw.js", "/api/call/ring", "/api/call/screen", "/api/games/knock", "/api/peer/verify", "/robots.txt"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Call pages are joined by the person you invited; they only see the call screen, never your data.
  // Draw & Guess invites (/play/…) are the same: a friend sees only the game.
  if (OPEN_PATHS.some((p) => path === p) || path.startsWith("/call/") || path.startsWith("/play/")) return NextResponse.next();

  if (misconfigured()) {
    return new NextResponse("APP_PASSWORD is not set. Add it in Vercel → Settings → Environment Variables.", {
      status: 503,
    });
  }
  if (await isUnlocked(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (path.startsWith("/api/")) return NextResponse.json({ error: "Locked" }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = "";
  return NextResponse.redirect(url);
}

// Only build assets and the few files that must load without a session (app icons for install and
// notifications) skip the gate. Never exclude by file extension: "/api/x/anything.png" would then
// bypass the password, and personal images in public/ would be readable by anyone.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|icons/|api/cron/).*)"],
};
