import { NextResponse } from "next/server";

/**
 * Android shares to /share-in (manifest share_target); HIVEMIND's service worker normally catches it.
 * If the worker isn't running yet, land on the Share page and ask to share once more.
 */
export const POST = (req: Request) => NextResponse.redirect(new URL("/share?error=1", req.url), 303);
