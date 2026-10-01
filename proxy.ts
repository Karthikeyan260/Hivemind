import { NextResponse, type NextRequest } from "next/server";
import { isUnlocked, misconfigured, SESSION_COOKIE } from "@/lib/session";

// Every page and API route is private to the owner. Only /unlock, its API, and the app manifest
// (name + icons, fetched by the phone without cookies when installing), the notification service
// worker, and the call "ring" a guest triggers (it only works for rooms the owner created) are open.
const OPEN_PATHS = ["/unlock", "/api/unlock", "/manifest.webmanifest", "/sw.js", "/api/call/ring"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Call pages are joined by the person you invited; they only see the call screen, never your data.
  if (OPEN_PATHS.some((p) => path === p) || path.startsWith("/call/")) return NextResponse.next();

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

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
