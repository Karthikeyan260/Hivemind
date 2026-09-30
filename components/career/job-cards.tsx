"use client";

import { useState } from "react";
import { cx } from "@/components/ui";
import type { JobListing } from "@/lib/client-api";

/** Live job search results in the console: role, company, full description, Apply, and one-click ATS + resume. */
export function JobCards({ jobs, onCheck, busy }: { jobs: JobListing[]; onCheck: (n: number, job: JobListing) => void; busy?: boolean }) {
  return (
    <div className="stagger mt-3 space-y-2">
      {jobs.map((j, i) => (
        <JobCard key={j.id} n={i + 1} job={j} onCheck={() => onCheck(i + 1, j)} busy={busy} />
      ))}
    </div>
  );
}

function JobCard({ n, job, onCheck, busy }: { n: number; job: JobListing; onCheck: () => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = [job.location, job.remote ? "Remote" : "", job.employment_type.replace(/_/g, " ").toLowerCase(), job.posted, job.salary].filter(Boolean);
  const desc = job.description.trim();
  return (
    <div className="border border-data/25 bg-sunken/60 p-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 font-mono text-[11px] text-core">{String(n).padStart(2, "0")}</span>
        {job.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote logos from many hosts
          <img src={job.logo} alt="" className="mt-0.5 size-7 shrink-0 rounded-sm bg-white/90 object-contain p-0.5" loading="lazy" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] leading-snug text-fg">{job.title}</div>
          <div className="font-mono text-[11px] text-data">{job.company}</div>
          {meta.length ? <div className="mt-0.5 font-mono text-[10px] text-soft">{meta.join(" · ")}</div> : null}
        </div>
      </div>
      {desc ? (
        <div className={cx("mt-2 whitespace-pre-line text-[12.5px] leading-relaxed text-fg/75", !open && "line-clamp-3")}>{desc}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10.5px]">
        {desc.length > 240 && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-soft hover:text-data">
            {open ? "Less ▴" : "Full description ▾"}
          </button>
        )}
        <span className="flex-1" />
        {job.apply_link && (
          <a href={job.apply_link} target="_blank" rel="noopener noreferrer" className="border border-data/40 px-2 py-0.5 text-data hover:border-data">
            Apply{job.publisher ? ` · ${job.publisher}` : ""} ↗
          </a>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onCheck}
          className="border border-core/50 px-2 py-0.5 text-core hover:border-core disabled:cursor-not-allowed disabled:opacity-40"
        >
          Check ATS + resume
        </button>
      </div>
    </div>
  );
}
