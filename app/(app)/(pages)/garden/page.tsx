"use client";

import { useEffect, useState } from "react";
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

export default function GardenPage() {
  const [mode, setMode] = useState<"3d" | "flat" | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- what the device can draw, checked once
    setMode(canDraw3D() ? "3d" : "flat");
  }, []);
  if (mode === "flat") return <FlatGarden />;
  if (mode === "3d") return <Garden3D onFail={() => setMode("flat")} />;
  return null;
}
