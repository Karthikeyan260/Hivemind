import type { NextConfig } from "next";

// Baseline browser protections for every response. Kept to rules that can't break the app
// (no script-src: three.js, PeerJS and Gemini Live connect to several origins).
const SECURITY_HEADERS = [
  // Nobody can frame HIVEMIND (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Mic for voice and calls, camera for future photo capture: this site only. Nothing else.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home folder otherwise confuses root detection.
  turbopack: { root: __dirname },
  // PDF rendering uses Node-only internals (fonts, streams); load it at runtime instead of bundling.
  serverExternalPackages: ["@react-pdf/renderer"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
