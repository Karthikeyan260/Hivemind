"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
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
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[background-color,border-color,color,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        // Taller on touch screens (44 px target for normal buttons).
        size === "sm" ? "h-7 px-2.5 text-xs pointer-coarse:h-9" : "h-9 px-3.5 text-sm pointer-coarse:h-11",
        variant === "primary" && "bg-core text-core-ink hover:bg-core/85",
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
  <select {...p} className={cx(field, "pr-8", className)} />
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
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="hud-label mb-2">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-[65ch] text-sm text-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const ErrorText = ({ error }: { error: string | null }) =>
  error ? <p className="rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">{error}</p> : null;

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="hud-frame px-6 py-10 text-center text-sm text-soft">{children}</div>
);

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-3 animate-pulse rounded-sm bg-raised" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

/** Minimal safe markdown: headings, **bold**, *italic*, bullet lists, [n] citations linked to sources. No HTML injection. */
export function RichText({ text, sources, caret }: { text: string; sources?: { n: number; href: string }[]; caret?: boolean }) {
  const lines = text.split("\n");
  let lastLine = -1;
  lines.forEach((l, i) => l.trim() && (lastLine = i));
  const tail = (i: number) => (caret && i === lastLine ? <span className="stream-caret" aria-hidden /> : null);
  const inline = (s: string, key: string) =>
    s
      // "[3], [6]" → "[3, 6]" so adjacent citations render as one group
      .replace(/\]\s*,\s*\[(?=\d)/g, ", ")
      .split(/(\*\*[^*]+\*\*|(?<![*\w])\*[^*\s][^*]*\*(?![*\w])|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|`[^`]+`|\[\d+(?:,\s*\d+)*\])/g)
      .map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={key + i} className="font-semibold text-fg">{part.slice(2, -2)}</strong>;
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
