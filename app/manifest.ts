import type { MetadataRoute } from "next";

/** Makes "Add to Home screen" install HIVEMIND as a full-screen app instead of a browser bookmark. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HIVEMIND",
    short_name: "HIVEMIND",
    description: "Your personal AI: memory, projects and answers",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d1117",
    theme_color: "#0d1117",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Memories", url: "/memories" },
      { name: "Career", url: "/career" },
      { name: "Journey", url: "/journey" },
    ],
  };
}
