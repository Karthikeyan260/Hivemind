import { Sidebar } from "@/components/sidebar";
import { passwordRequired } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar canLock={passwordRequired()} />
      <main className="min-w-0 flex-1 pb-[calc(var(--tabbar-h)+var(--music-h,0px))]">{children}</main>
    </div>
  );
}
