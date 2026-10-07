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
    // Long-press the home-screen icon.
    shortcuts: [
      { name: "Talk now", short_name: "Talk", description: "Hands-free voice mode", url: "/focus?talk=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Quick note", short_name: "Note", url: "/notes?new=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Today's brief", short_name: "Brief", url: "/?brief=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Remember this", short_name: "Remember", url: "/memories?new=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    // Android's Share menu: links, text, photos and files go to HIVEMIND (the service worker catches them).
    share_target: {
      action: "/share-in",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "files", accept: ["image/*", "application/pdf", "text/plain", "text/markdown", "text/csv", ".pdf", ".txt", ".md", ".csv", ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] }],
      },
    },
  };
}
