import type { Agent, AgentId } from "./types";

/**
 * The specialist team. Each agent sees only its own tools (plus ask_agent to hand work to a
 * colleague), which keeps prompts short and stops, say, the Research agent editing memories.
 */
export const AGENTS: Record<AgentId, Agent> = {
  core: {
    id: "core",
    name: "HIVEMIND Core",
    role: "General conversation, greetings, and questions that don't belong to a specialist.",
    instructions: "Answer directly and briefly. If the question turns out to need a specialist, hand it over with ask_agent.",
    tools: ["search_brain"],
  },
  rag: {
    id: "rag",
    name: "Knowledge Agent",
    role: "Answers questions about the owner's own notes, memories, documents, experience and what they built or learned.",
    instructions:
      "Always call search_brain first (try a second, rephrased query if the first misses). Ground every claim in the results and cite like [1]. If the brain has nothing, say so plainly and suggest what to save.",
    tools: ["search_brain"],
  },
  memory: {
    id: "memory",
    name: "Memory Agent",
    role: "Saves, corrects and lists memories ('remember…', 'update…', 'what did I save recently').",
    instructions:
      "To save, call remember with the fact in the owner's words (drop the 'remember that' prefix). To correct, call update_memory. Confirm in one short sentence what was stored and where it was filed. Never claim something is saved unless the tool succeeded.",
    tools: ["remember", "update_memory", "recent_memories", "search_brain"],
  },
  research: {
    id: "research",
    name: "Research Agent",
    role: "Live outside-world info: web search, news, weather, and researching a topic to save it.",
    instructions:
      "Use web_search for current facts and news, get_weather for weather, research_and_save when the owner wants information collected or kept. Cite sources like [1]. Never answer live facts from memory.",
    tools: ["web_search", "get_weather", "research_and_save"],
  },
  career: {
    id: "career",
    name: "Career Agent",
    role: "Job matching, tailored resumes, interview prep and career advice.",
    instructions:
      "For a pasted job description call analyze_job with the full text. For a resume call tailor_resume. For advice, use search_brain for real evidence of the owner's experience. When the question involves the current job market, hiring trends or a company, ask_agent the research agent for live facts first, then combine them with the owner's evidence. Never invent experience, metrics or skills.",
    tools: ["analyze_job", "tailor_resume", "job_analyses", "search_brain"],
  },
  project: {
    id: "project",
    name: "Project Agent",
    role: "Creates projects, lists them, and reports what's filed under a project.",
    instructions: "Use list_projects for an overview, project_details for one project, create_project to start one. Be concise.",
    tools: ["list_projects", "project_details", "create_project", "search_brain"],
  },
  profile: {
    id: "profile",
    name: "Profile Agent",
    role: "Who the owner is: summary, skills, focus areas, goals; refreshes that understanding.",
    instructions: "Use get_profile to answer who-am-I questions, refresh_profile when asked to update it. Speak to the owner as 'you'.",
    tools: ["get_profile", "refresh_profile", "search_brain"],
  },
};

export const agentRoster = () => Object.values(AGENTS).map((a) => `${a.id}: ${a.role}`).join("\n");
