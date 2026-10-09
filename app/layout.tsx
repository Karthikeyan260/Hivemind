import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MobileNav } from "@/components/mobile-nav";
import { ServiceWorker } from "@/components/notifications";
import { OfflineStatusPill } from "@/components/offline-status";
import { WebTaskWindow } from "@/components/web/live-window";
import { MusicPlayer } from "@/components/music/player";
import { VideoPlayer } from "@/components/video/player";
import { LocationReporter } from "@/components/location-card";
import { ReminderWatcher } from "@/components/reminders/watcher";
import { GuestBanner, HandoffCard, OwnerCheckCard, VoiceDock } from "@/components/voice/dock";
import { VoiceProvider } from "@/components/voice/provider";
import { WakeListener } from "@/components/wake/listener";
import { passwordRequired } from "@/lib/session";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Each page sets its own name: "Notes · HIVEMIND" (browser tabs, recent apps, screen readers).
  title: { default: "HIVEMIND", template: "%s · HIVEMIND" },
  // Private: never in search results.
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  description: "Your personal AI: memory, projects and answers",
  applicationName: "HIVEMIND",
  // Added to the home screen, it opens full-screen like an app (see app/manifest.ts).
  appleWebApp: { capable: true, title: "HIVEMIND", statusBarStyle: "black" },
  formatDetection: { telephone: false },
};

// Edge-to-edge on phones (safe-area insets are handled in the layout) and a dark browser chrome.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1117",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <VoiceProvider>
          {children}
          <VoiceDock />
          <GuestBanner />
          <OwnerCheckCard />
          <HandoffCard />
          <ServiceWorker />
          <OfflineStatusPill />
          <WebTaskWindow />
          <MusicPlayer />
          <VideoPlayer />
          <LocationReporter />
          <MobileNav canLock={passwordRequired()} />
          <ReminderWatcher />
          <WakeListener />
        </VoiceProvider>
      </body>
    </html>
  );
}
