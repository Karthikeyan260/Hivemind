import type { Metadata } from "next";

export const metadata: Metadata = { title: "Day comic" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
