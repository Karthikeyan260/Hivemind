"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { FlatGarden } from "@/components/garden/flat-garden";
import { Garden3D } from "@/components/garden/garden-3d";

/** Nova's garden: the 3D island where the device can draw it, the flat picture otherwise. */
function canDraw3D() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

function Garden() {
  // ?fest=deepavali (or pongal, karthigai, monsoon, today) dresses the island; chat links here too.
  const params = useSearchParams();
  const asked = params.get("fest");
  // ?goodnight=1 starts Nova's bedtime routine (from chat or voice).
  const bedtime = params.get("goodnight") === "1";
  // ?season=autumn (or spring, summer, winter) previews a season on the island.
  const askedSeason = params.get("season");
  // ?mood=1 to 5 previews how a check-in tints the light.
  const askedMood = params.get("mood");
  // ?visitors=owl,deer previews the rare visitors.
  const askedVisitors = params.get("visitors");
  const [mode, setMode] = useState<"3d" | "flat" | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- what the device can draw, checked once
    setMode(canDraw3D() ? "3d" : "flat");
  }, []);
  if (mode === "flat") return <FlatGarden />;
  if (mode === "3d") return <Garden3D onFail={() => setMode("flat")} asked={asked} bedtimeAsk={bedtime} askedSeason={askedSeason} askedMood={askedMood} askedVisitors={askedVisitors} />;
  return null;
}

export default function GardenPage() {
  return (
    <Suspense fallback={null}>
      <Garden />
    </Suspense>
  );
}
