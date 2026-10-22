/**
 * A picture of the garden to send to a friend: the 3D scene's frame with the pet's name, the season
 * and what has grown written over it. Browser only (canvas and the share sheet).
 */
export type SnapshotCard = {
  title: string;
  /** Under the title, e.g. "🍂 autumn · golden hour". */
  sub: string;
  /** What has grown, as short pieces, e.g. ["🌸 12", "🌳 3"]. */
  stats: string[];
  date: string;
};

/** The file name for a snapshot of a day ("nova-garden-2026-10-22.png"). */
export const snapshotName = (pet: string, date: string) => `${pet.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my"}-garden-${date}.png`;

function load(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The garden picture didn't load."));
    img.src = src;
  });
}

/** The scene's frame (a data URL) with the card written over it, as a PNG. */
export async function composeSnapshot(frame: string, card: SnapshotCard): Promise<Blob> {
  const img = await load(frame);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser can't draw the picture.");
  g.drawImage(img, 0, 0, w, h);
  const u = Math.max(w, h * 1.4) / 1600;
  // Soft dark fades at the top and bottom so the writing reads over any sky.
  const top = g.createLinearGradient(0, 0, 0, h * 0.28);
  top.addColorStop(0, "rgba(0,0,0,0.55)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = top;
  g.fillRect(0, 0, w, h * 0.28);
  const bottom = g.createLinearGradient(0, h * 0.74, 0, h);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(1, "rgba(0,0,0,0.65)");
  g.fillStyle = bottom;
  g.fillRect(0, h * 0.74, w, h * 0.26);
  g.textBaseline = "alphabetic";
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowBlur = 14 * u;
  g.fillStyle = "#fff";
  g.font = `600 ${56 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.fillText(card.title, 44 * u, 92 * u);
  g.fillStyle = "rgba(255,255,255,0.8)";
  g.font = `500 ${26 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.fillText(card.sub, 46 * u, 134 * u);
  g.fillStyle = "#fff";
  g.font = `600 ${34 * u}px system-ui, -apple-system, "Segoe UI Emoji", "Segoe UI", sans-serif`;
  g.fillText(card.stats.join("    "), 46 * u, h - 62 * u);
  g.fillStyle = "rgba(255,255,255,0.65)";
  g.font = `500 ${22 * u}px system-ui, -apple-system, sans-serif`;
  g.fillText(`${card.date} · HIVEMIND`, 46 * u, h - 24 * u);
  return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't save the picture."))), "image/png"));
}

/** Opens the phone's share sheet with the picture; where that isn't possible, saves it as a file. Returns what happened. */
export async function shareSnapshot(blob: Blob, name: string, text: string): Promise<"shared" | "saved" | "cancelled"> {
  const file = new File([blob], name, { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return "shared";
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}
