"use client";

import Link from "next/link";
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useState } from "react";
import type { Project } from "@/lib/client-api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "quiet"; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
        // Taller on touch screens (44 px target for normal buttons).
        size === "sm" ? "h-7 px-2.5 text-xs pointer-coarse:h-9" : "h-9 px-3.5 text-sm pointer-coarse:h-11",
        variant === "primary" && "bg-core text-core-ink hover:bg-core/85 disabled:bg-raised disabled:text-faint disabled:opacity-100",
        variant === "ghost" && "border border-line-strong text-fg hover:border-data hover:text-data",
        variant === "quiet" && "text-soft hover:bg-raised hover:text-fg",
        variant === "danger" && "border border-alert/50 text-alert hover:bg-alert/10",
        className,
      )}
    />
  );
}

// A visible keyboard focus ring (the global outline is kept, plus a ring), not just a border tint.
const field = "rounded-md border border-line bg-sunken px-3 py-2 text-sm text-fg placeholder:text-faint transition-colors duration-150 focus:border-data focus-visible:ring-2 focus-visible:ring-data/50";

// Fields without a visible label get their placeholder as their accessible name, so screen
// readers announce what each box is for (an explicit aria-label always wins).
const named = (p: { placeholder?: string; "aria-label"?: string; "aria-labelledby"?: string; id?: string }) =>
  p["aria-label"] || p["aria-labelledby"] ? {} : p.placeholder ? { "aria-label": p.placeholder } : {};

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...named(p)} {...p} className={cx(field, "w-full", className)} />;

export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...named(p)} {...p} className={cx(field, "w-full resize-y", className)} />
);

export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(field, "hm-select max-w-full pr-8", className)} />
);

export function ProjectSelect({
  projects,
  value,
  onChange,
  allLabel = "Let HIVEMIND decide",
}: {
  projects: Project[] | null;
  value: string | null;
  onChange: (v: string | null) => void;
  allLabel?: string;
}) {
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Project">
      <option value="">{allLabel}</option>
      {projects?.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

export const Badge = ({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "core" | "data" | "ok" | "accent" }) => (
  <span
    className={cx(
      "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider",
      tone === "neutral" && "bg-sunken text-soft",
      (tone === "core" || tone === "accent") && "bg-core/12 text-core",
      tone === "data" && "bg-data/10 text-data",
      tone === "ok" && "bg-ok/10 text-ok",
    )}
  >
    {children}
  </span>
);

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  // phones: a long description shows two lines (so the page itself starts higher), "more" opens the rest
  const [more, setMore] = useState(false);
  const long = (subtitle?.length ?? 0) > 90;
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="head-in min-w-0">
        {eyebrow && <div className="hud-label mb-2">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className={cx("mt-1.5 max-w-[65ch] text-sm text-soft", long && !more && "line-clamp-2 sm:line-clamp-none")}>
            {subtitle}
          </p>
        )}
        {long && (
          // A 40px-tall tap area (the word alone was 16px), pulled up so the spacing looks the same.
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="-mb-2 -ml-2 inline-flex h-10 items-center rounded-md px-2 text-[13px] text-data active:bg-data/10 sm:hidden">
            {more ? "Show less" : "Read more"}
          </button>
        )}
      </div>
      {actions && <div className="head-in-actions flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const ErrorText = ({ error }: { error: string | null }) =>
  error ? <p className="rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">{error}</p> : null;

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="hud-frame rise-in px-6 py-10 text-center text-sm text-soft">{children}</div>
);

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="shimmer h-3 rounded-sm" style={{ width: `${90 - i * 15}%`, animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

/** While a list loads: card-shaped shimmering placeholders that match the real cards (announced as "Loading"). */
export function CardSkeleton({ count = 3, grid = false }: { count?: number; grid?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className={grid ? "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6" : "space-y-2"}>
      {Array.from({ length: count }, (_, i) =>
        grid ? (
          <div key={i} className="shimmer aspect-square rounded-lg" style={{ animationDelay: `${i * 90}ms` }} />
        ) : (
          <div key={i} className="flex gap-3 rounded-xl border border-line bg-panel/60 p-4">
            <div className="shimmer size-9 shrink-0 rounded-lg" style={{ animationDelay: `${i * 120}ms` }} />
            <div className="flex-1 space-y-2 pt-0.5">
              <div className="shimmer h-3 w-2/5 rounded-sm" style={{ animationDelay: `${i * 120}ms` }} />
              <div className="shimmer h-2.5 w-11/12 rounded-sm" style={{ animationDelay: `${i * 120 + 60}ms` }} />
              <div className="shimmer h-2.5 w-3/4 rounded-sm" style={{ animationDelay: `${i * 120 + 120}ms` }} />
            </div>
          </div>
        ),
      )}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Minimal safe markdown: headings, **bold**, *italic*, bullet lists, > quotes, [n] citations linked to sources. No HTML injection. */
export function RichText({ text, sources, caret }: { text: string; sources?: { n: number; href: string }[]; caret?: boolean }) {
  const lines = text.split("\n");
  let lastLine = -1;
  lines.forEach((l, i) => l.trim() && (lastLine = i));
  const tail = (i: number) => (caret && i === lastLine ? <span className="stream-caret" aria-hidden /> : null);
  const inline = (s: string, key: string) =>
    s
      // "[3], [6]" → "[3, 6]" so adjacent citations render as one group
      .replace(/\]\s*,\s*\[(?=\d)/g, ", ")
      .split(/(\*\*[^*]+\*\*|(?<![*\w])\*[^*\s][^*]*\*(?![*\w])|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|`[^`]+`|\[\d+(?:,\s*\d+)*\]|(?<![\w/])https?:\/\/[^\s,)<>"']+[^\s,)<>"'.;:!?])/g)
      .map((part, i, all) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={key + i} className="font-semibold text-fg">{part.slice(2, -2)}</strong>;
      // A bare address ("Sources: https://…"): a short link showing just the site, the full address on hover.
      if (/^https?:\/\/\S+$/.test(part)) {
        let site = part;
        try {
          site = new URL(part).hostname.replace(/^www\./, "");
        } catch {}
        // Cut short by the writer ("…/itmab..."): it would open a broken page, so just name the site.
        if (/^(\.{3}|…)/.test(all[i + 1] ?? "")) {
          return (
            <span key={key + i} title={part} className="text-soft">
              {site}
            </span>
          );
        }
        return (
          <a key={key + i} href={part} title={part} target="_blank" rel="noreferrer noopener" className="text-data underline decoration-data/40 underline-offset-2 hover:decoration-data">
            {site} ↗
          </a>
        );
      }
      // Only http(s) links are rendered as anchors, so model output can't inject javascript: URLs.
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (link) {
        return (
          <a key={key + i} href={link[2]} target="_blank" rel="noreferrer noopener" className="text-data underline decoration-data/40 underline-offset-2 hover:decoration-data">
            {link[1]}
          </a>
        );
      }
      if (/^`[^`]+`$/.test(part)) {
        return <code key={key + i} className="rounded-sm bg-data/10 px-1 font-mono text-[0.88em] text-data">{part.slice(1, -1)}</code>;
      }
      if (/^\*[^*].*\*$/.test(part)) return <em key={key + i} className="text-fg">{part.slice(1, -1)}</em>;
      const cite = part.match(/^\[(\d+(?:,\s*\d+)*)\]$/);
      if (cite) {
        return cite[1].split(/,\s*/).map((n) => {
          const src = sources?.find((x) => x.n === +n);
          return src ? (
            <Link key={key + i + n} href={src.href} className="mx-0.5 rounded-sm bg-data/10 px-1 font-mono text-[11px] text-data hover:bg-data/20">
              {n}
            </Link>
          ) : (
            <span key={key + i + n} className="mx-0.5 font-mono text-[11px] text-faint">[{n}]</span>
          );
        });
      }
      return part;
    });

  const blocks: ReactNode[] = [];
  let list: { text: string; line: number }[] = [];
  const flush = () => {
    if (list.length) {
      const items = list;
      blocks.push(
        <ul key={`ul${blocks.length}`} className="my-2 space-y-1">
          {items.map((li, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-core" />
              <span>
                {inline(li.text, `li${blocks.length}-${i}`)}
                {tail(li.line)}
              </span>
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((line, i) => {
    const m = line.match(/^\s*[-*•]\s+(.*)/);
    if (m) return list.push({ text: m[1], line: i });
    flush();
    const heading = line.match(/^\s*#{1,4}\s+(.*)/);
    if (heading) {
      blocks.push(
        <h3 key={`h${i}`} className="hud-label mb-1 mt-5 text-core">
          {heading[1].replace(/\*\*/g, "")}
          {tail(i)}
        </h3>,
      );
      return;
    }
    // "> a quoted line" (verses, quotes): an indented line with a bar, not a raw ">".
    const quote = line.match(/^\s*>\s?(.*)/);
    if (quote) {
      if (quote[1].trim())
        blocks.push(
          <p key={`q${i}`} className="my-0.5 border-l-2 border-core/60 pl-3 text-fg">
            {inline(quote[1].replace(/^"|"$/g, ""), `q${i}`)}
            {tail(i)}
          </p>,
        );
      return;
    }
    if (line.trim()) {
      blocks.push(
        <p key={`p${i}`} className="my-1.5">
          {inline(line.replace(/^#+\s*/, ""), `p${i}`)}
          {tail(i)}
        </p>,
      );
    }
  });
  flush();
  return <div className="break-words leading-relaxed">{blocks}</div>;
}
