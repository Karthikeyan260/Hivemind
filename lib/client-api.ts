"use client";

import { useCallback, useEffect, useState } from "react";

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- plain helper, no router here
    window.location.assign("/unlock");
    throw new Error("Locked");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Fired when the brain changes outside the page's own actions (e.g. by voice). */
export const BRAIN_CHANGED = "hivemind:brain-changed";

export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    reload();
  }, [reload]);

  // Voice can change the brain from any page (remember / create project): refresh when it does.
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener(BRAIN_CHANGED, on);
    return () => window.removeEventListener(BRAIN_CHANGED, on);
  }, [reload]);

  return { data, error, loading, reload, setData };
}

export type Project = { id: string; name: string; description: string | null; status: string };

export type Note = {
  id: string;
  project_id: string | null;
  title: string;
  content: string;
  summary: string | null;
  category: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type Memory = {
  id: string;
  project_id: string | null;
  title: string;
  content: string;
  memory_type: string;
  category: string | null;
  importance: number;
  confidence: number;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export const MEMORY_TYPES = [
  "fact",
  "knowledge",
  "experience",
  "decision",
  "idea",
  "preference",
  "project_context",
  "learning",
] as const;

export type Profile = {
  name: string;
  headline: string;
  current_role: string;
  location: string;
  summary: string;
  top_skills: string[];
  focus_areas: string[];
  goals: string[];
  working_style: string;
  updated_at?: string;
};

export type BrainProject = Project & { items: number; metadata: { auto?: boolean; source?: string; cluster?: string | null; year?: number | null } };
export type Activity = { id: string; kind: string; message: string; undone: boolean; undoable: boolean; created_at: string };
export type Brain = {
  profile: Profile | null;
  projects: BrainProject[];
  activity: Activity[];
  counts: { notes: number; memories: number; documents: number; projects: number };
};

export type Source = { n: number; type: string; title: string; href: string; similarity: number };
/** One live job opening from the Career agent's search_jobs tool. */
export type JobListing = {
  id: string;
  title: string;
  company: string;
  logo: string | null;
  location: string;
  remote: boolean;
  employment_type: string;
  posted: string;
  salary: string;
  publisher: string;
  apply_link: string;
  description: string;
};

export type HiveEvent =
  | { type: "meta"; conversation_id: string; intent: string; sources: Source[] }
  | { type: "delta"; text: string }
  | { type: "action"; label: string; href?: string; navigate?: boolean }
  | { type: "jobs"; jobs: JobListing[] }
  | { type: "agent"; agent: string; name: string; via: "router" | "delegation" }
  | { type: "tool"; agent: string; tool: string; status: "run" | "ok" | "error"; detail?: string }
  | { type: "done"; provider?: string; model?: string; latency_ms?: number; changed?: boolean }
  | { type: "error"; message: string };

/** Streams HIVEMIND's newline-delimited JSON events. */
export async function streamHivemind(body: object, onEvent: (e: HiveEvent) => void) {
  const res = await fetch("/api/hivemind", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- plain helper, no router here
    window.location.assign("/unlock");
    return;
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as HiveEvent);
    }
  }
}

export const timeAgo = (s: string) => {
  const m = Math.round((Date.now() - +new Date(s)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
