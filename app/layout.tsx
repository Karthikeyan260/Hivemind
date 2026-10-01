import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MobileNav } from "@/components/mobile-nav";
import { ReminderWatcher } from "@/components/reminders/watcher";
import { HandoffCard, VoiceDock } from "@/components/voice/dock";
import { VoiceProvider } from "@/components/voice/provider";
import { passwordRequired } from "@/lib/session";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "HIVEMIND",
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
          <HandoffCard />
          <MobileNav canLock={passwordRequired()} />
          <ReminderWatcher />
        </VoiceProvider>
      </body>
    </html>
  );
}
