import { movieById, MOVIES } from "@/lib/theatre/catalog";
import TheatreRoomPage from "./room";

/**
 * A Friends Theatre room link. The server looks up the film named in the link (?m=) and hands just that one film to the
 * page, so a friend opening an invite doesn't have to download the whole film catalogue before the join button works
 * (see room.tsx, which loads the rest in the background).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string | string[] }> }) {
  const sp = await searchParams;
  const m = Array.isArray(sp.m) ? sp.m[0] : sp.m;
  return <TheatreRoomPage initial={movieById(m) ?? null} fallback={MOVIES[0]} />;
}
