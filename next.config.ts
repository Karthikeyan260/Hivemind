import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home folder otherwise confuses root detection.
  turbopack: { root: __dirname },
  // PDF rendering uses Node-only internals (fonts, streams); load it at runtime instead of bundling.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
