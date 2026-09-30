import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/lib/external/jobs";

export const AGENT_IDS = ["core", "memory", "rag", "research", "career", "project", "profile", "scheduler"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type Source = { n: number; type: string; title: string; href: string; similarity: number };
/** navigate: the console opens it right after the answer (in-app pages only). */
export type Action = { label: string; href?: string; navigate?: boolean };

/** Streamed to the console so the owner can watch the orchestrator work. */
export type AgentEvent =
  | { type: "agent"; agent: AgentId; name: string; via: "router" | "delegation" }
  | { type: "tool"; agent: AgentId; tool: string; status: "run" | "ok" | "error"; detail?: string };

/** Shared state for one request: every agent and tool writes into the same sources/actions. */
export type RunContext = {
  supabase: SupabaseClient;
  projectId: string | null;
  conversationId: string;
  sources: Source[];
  actions: Action[];
  /** True once any tool changed the brain (so the UI refreshes). */
  changed: boolean;
  /** Listings from a job search in this request: shown as cards and kept so "check #2" works next turn. */
  jobs: Job[] | null;
  /** A memory the owner was asked to confirm deleting; only confirm_delete_memory on the next turn can remove it. */
  pendingDelete: { id: string; title: string } | null;
  /** State from earlier turns kept by the caller instead of chat history (live voice keeps it in the browser). */
  carried?: { jobs?: Job[]; pendingDelete?: { id: string; title: string } };
  emit: (e: AgentEvent) => void;
};

export type Tool = {
  name: string;
  description: string;
  /** JSON schema for the arguments (passed to Gemini as parametersJsonSchema). */
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: RunContext) => Promise<Record<string, unknown>>;
};

export type Agent = {
  id: AgentId;
  name: string;
  /** One line: what the router and other agents should send here. */
  role: string;
  instructions: string;
  tools: string[];
};
