import Link from "next/link";

export const metadata = { title: "Not found · HIVEMIND" };

/**
 * Any address HIVEMIND doesn't have (and anything a page reports missing). Kept a plain server file with links only:
 * Next.js sends the root not-found with every page.
 */
export default function NotFound() {
  return (
    <main className="hud-grid flex min-h-screen items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative grid size-28 place-items-center">
          <span className="absolute inset-0 rounded-full border border-dashed border-line-strong" />
          <span className="absolute inset-3 rounded-full border border-core/30" />
          <span className="font-mono text-3xl font-semibold tracking-tight text-core">404</span>
        </div>
        <p className="mt-6 font-mono text-[11px] tracking-[0.3em] text-faint uppercase">Signal lost</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">This page isn&apos;t in your brain</h1>
        <p className="mt-2 text-sm text-soft">The link may be old, or the page was moved. Everything you saved is still where it was.</p>
        <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/" className="inline-flex h-10 items-center justify-center rounded-md bg-core px-4 text-sm font-medium text-core-ink transition hover:bg-core/85">
            Back to HIVEMIND
          </Link>
          <Link href="/search" className="inline-flex h-10 items-center justify-center rounded-md border border-line-strong px-4 text-sm transition hover:border-data hover:text-data">
            Search your notes
          </Link>
        </div>
      </div>
    </main>
  );
}
