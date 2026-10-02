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
  // playwright-core (web agent) only drives a remote browser; keep it out of the bundle too.
  serverExternalPackages: ["@react-pdf/renderer", "playwright-core"],
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // The Career page previews the resume PDF in an iframe: allow framing by HIVEMIND itself only.
      // Listed last so these override the same keys above.
      {
        source: "/api/career/:id/resume",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
