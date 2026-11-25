"use client";

import Link from "next/link";
import { useEffect } from "react";

/** When a page crashes: say so plainly, offer to try again (re-renders this part) or go home. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const detail = error instanceof Error ? error.message : null;
  return (
    <main className="hud-grid flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative grid size-20 place-items-center">
          <span className="absolute inset-0 animate-pulse rounded-full border border-alert/40 motion-reduce:animate-none" />
          <span className="font-mono text-2xl text-alert">!</span>
        </div>
        <p className="mt-6 font-mono text-[11px] tracking-[0.3em] text-faint uppercase">Something broke</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">This page hit a snag</h1>
        <p className="mt-2 text-sm text-soft">Nothing you saved is lost. Try again, and if it keeps happening, head back home.</p>
        {detail && <p className="mt-3 w-full truncate rounded-md border border-line bg-sunken px-3 py-1.5 font-mono text-[11px] text-faint" title={detail}>{detail}</p>}
        <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={() => retry()} className="inline-flex h-10 items-center justify-center rounded-md bg-core px-4 text-sm font-medium text-core-ink transition hover:bg-core/85 active:scale-[0.97]">
            Try again
          </button>
          <Link href="/" className="inline-flex h-10 items-center justify-center rounded-md border border-line-strong px-4 text-sm transition hover:border-data hover:text-data">
            Back to HIVEMIND
          </Link>
        </div>
      </div>
    </main>
  );
}
