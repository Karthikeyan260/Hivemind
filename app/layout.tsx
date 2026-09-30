import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ReminderWatcher } from "@/components/reminders/watcher";
import { VoiceDock } from "@/components/voice/dock";
import { VoiceProvider } from "@/components/voice/provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "HIVEMIND",
  description: "Your personal AI: memory, projects and answers",
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
          <ReminderWatcher />
        </VoiceProvider>
      </body>
    </html>
  );
}
