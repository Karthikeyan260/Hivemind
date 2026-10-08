import type { Metadata } from "next";

export const metadata: Metadata = { title: "Morning brief" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
