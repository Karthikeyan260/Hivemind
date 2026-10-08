import "server-only";
import { getWeather, HOME_CITY } from "@/lib/external/weather";
import { findProduct, STORE_IDS, type StoreId } from "@/lib/external/products";
import { researchAndSave, webSearch } from "@/lib/external/web";
import { cite, obj, S, str } from "./shared";
import type { Tool } from "../types";

/** The outside world: web search, links, products, weather, research, and the browser agent. */
export const web: Record<string, Tool> = {
  /* ───── research (outside world) ───── */
  web_search: {
    name: "web_search",
    description: "Search the internet (Google) for current or outside-world information: news, prices, releases, events, public facts.",
    parameters: obj({ query: S }, ["query"]),
    async run(args, ctx) {
      const r = await webSearch(str(args.query));
      const ns = cite(ctx, r.sources.map((s) => ({ type: "web", title: s.title, href: s.url, similarity: 1 })));
      return { answer: r.answer, sources: r.sources.map((s, i) => ({ n: ns[i], site: s.title, url: s.url })) };
    },
  },
  open_link: {
    name: "open_link",
    description:
      "Open a web link for the owner in a new browser tab: a product page, a job's apply link, a source. Use when they say open / click / go to a link ('open the first one', 'open the Flipkart link'). Pass the exact url from an earlier tool result or your earlier answer; never guess one.",
    parameters: obj({ url: S, label: { type: "string", description: "Short name for the button, e.g. 'Flipkart · boAt Airdopes 141'" } }, ["url"]),
    async run(args, ctx) {
      let u: URL;
      try {
        u = new URL(str(args.url));
      } catch {
        return { error: "That isn't a valid link." };
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Only web links can be opened." };
      const label = (str(args.label) || u.hostname.replace(/^www\./, "")).slice(0, 50);
      ctx.actions.push({ label: `Open ${label}`, href: u.href, open: true });
      return { opening: u.href, note: "It opens in a new tab. If the browser blocks it, a button is shown: ask the owner to tap it." };
    },
  },
  find_product: {
    name: "find_product",
    description:
      "Find a product to buy: exact product page links with price. Marketplaces: flipkart, amazon, meesho (the default). Quick-delivery apps: zepto, blinkit, instamart (Swiggy), bigbasket; pass these in 'stores' when the owner names one, says quick / 10-minute delivery, or wants groceries or everyday items delivered fast (Zomato's grocery app is blinkit). Use whenever the owner asks for a product, price or buying link.",
    parameters: obj({ query: S, stores: { type: "array", items: { type: "string", enum: STORE_IDS } } }, ["query"]),
    async run(args, ctx) {
      const stores = (Array.isArray(args.stores) ? args.stores : []).filter((s): s is StoreId => STORE_IDS.includes(s as StoreId));
      const r = await findProduct(str(args.query), stores.length ? stores : undefined);
      cite(ctx, [...r.products, ...r.other_pages].map((p) => ({ type: "web", title: `${p.store} · ${p.title}`, href: p.url, similarity: 1 })));
      r.products.forEach((p, i) => ctx.actions.push({ label: `${p.store} ${i + 1} · ${p.title.slice(0, 40)}`, href: p.url }));
      r.search_links.forEach((l) => ctx.actions.push({ label: `Search ${l.store}`, href: l.url }));
      return {
        summary: r.summary.slice(0, 2500),
        product_pages: r.products,
        store_search_links: r.search_links,
        ...(r.search_unavailable ? { search_unavailable: r.search_unavailable } : {}),
        note: "Give the owner these exact URLs (product_pages first). For a store with no product page, give its store_search_links URL. Never give a store's home page or make up a link.",
      };
    },
  },
  get_weather: {
    name: "get_weather",
    description: `Live weather and 4-day forecast for a place (default ${HOME_CITY}).`,
    parameters: obj({ place: S }),
    async run(args, ctx) {
      const w = await getWeather(str(args.place) || HOME_CITY);
      cite(ctx, [{ type: "web", title: `Open-Meteo · ${w.place}`, href: "https://open-meteo.com", similarity: 1 }]);
      return w;
    },
  },
  research_and_save: {
    name: "research_and_save",
    description: "Research a topic in depth on the web and save the brief (with sources) as a note in the brain.",
    parameters: obj({ topic: S }, ["topic"]),
    async run(args, ctx) {
      const { note, result } = await researchAndSave(ctx.supabase, str(args.topic), ctx.projectId);
      cite(ctx, result.sources.map((s) => ({ type: "web", title: s.title, href: s.url, similarity: 1 })));
      ctx.changed = true;
      ctx.actions.push({ label: "Open note", href: `/notes?open=${note.id}` });
      return { saved_note: note.title, brief: result.answer.slice(0, 4000), source_count: result.sources.length };
    },
  },

  /* ───── web agent (imported lazily: it pulls in the browser driver) ───── */
  web_task: {
    name: "web_task",
    description:
      "Operate a real web browser for the owner: open sites, search inside them, click through pages, fill forms, compare prices across store pages, collect details that need clicking around. Runs in the background and shows live on the Web tasks page; anything irreversible (submit, pay, send, delete) waits for the owner's Approve, and logins/OTPs are handed to them. Use when the job needs actually using a website, not just a web search. 'goal' is a complete instruction; 'start_url' optional.",
    parameters: obj({ goal: S, start_url: S }, ["goal"]),
    async run(args, ctx) {
      const [{ steelConfigured }, { createTask }, { kick }] = await Promise.all([import("@/lib/web-agent/steel"), import("@/lib/web-agent/store"), import("@/lib/web-agent/runner")]);
      if (!steelConfigured()) return { error: "The web agent isn't set up yet (STEEL_API_KEY missing)." };
      const goal = str(args.goal);
      if (goal.length < 3) return { error: "Say what to do on the web." };
      const startUrl = /^https?:\/\//.test(str(args.start_url)) ? str(args.start_url) : undefined;
      const task = await createTask(ctx.supabase, goal, startUrl);
      await kick(ctx.origin, task.id);
      // No page change: a small live browser window appears on whatever page the owner is on.
      ctx.actions.push({ label: "Watch it work", href: `/web?task=${task.id}` });
      return { started: goal, note: "It's working in a cloud browser now. Tell the owner they can watch it live in the small browser window on screen, and you'll ask before anything irreversible." };
    },
  },

  web_tasks_status: {
    name: "web_tasks_status",
    description:
      "The owner's web tasks (HIVEMIND driving a cloud browser): which are working, which wait for their Approve or for them to take over, and the results of finished ones. Use for 'how's the web task going', 'what did the browser find', 'anything waiting for me'.",
    parameters: obj({}),
    async run(_args, ctx) {
      const { listTasks } = await import("@/lib/web-agent/store");
      const tasks = await listTasks(ctx.supabase);
      ctx.actions.push({ label: "Open Web tasks", href: "/web" });
      return {
        tasks: tasks.slice(0, 8).map((t, i) => ({
          n: i + 1,
          goal: t.goal,
          status: t.status,
          waiting_for_approval: t.status === "needs_approval" ? t.pending?.label : undefined,
          needs_owner: t.status === "needs_you" ? t.question : undefined,
          steps: t.steps.length,
          result: t.result?.slice(0, 600),
          error: t.error,
        })),
      };
    },
  },
  web_task_answer: {
    name: "web_task_answer",
    description:
      "Answer or control a web task: 'approve' / 'reject' the step it paused on, 'continue' after the owner took over (logged in, entered an OTP), 'cancel' to stop it, 'retry' a stopped one. 'which' = words from its goal; empty = the task that most recently needs attention. Only on the owner's own request.",
    parameters: obj({ decision: { type: "string", enum: ["approve", "reject", "continue", "cancel", "retry"] }, which: S }, ["decision"]),
    async run(args, ctx) {
      const [{ listTasks, ACTIVE }, { decideTask, kick }] = await Promise.all([import("@/lib/web-agent/store"), import("@/lib/web-agent/runner")]);
      const decision = str(args.decision) as "approve" | "reject" | "continue" | "cancel" | "retry";
      const tasks = await listTasks(ctx.supabase);
      const words = str(args.which).toLowerCase();
      const wants = { approve: ["needs_approval"], reject: ["needs_approval"], continue: ["needs_you"], cancel: ACTIVE, retry: ["failed", "cancelled", "done", "needs_you"] }[decision];
      const pool = words ? tasks.filter((t) => t.goal.toLowerCase().includes(words) || words.split(/\s+/).every((w) => t.goal.toLowerCase().includes(w))) : tasks;
      const task = pool.find((t) => wants.includes(t.status));
      if (!task) return { error: words ? `No web task matching "${words}" can be ${decision}d right now.` : `No web task is waiting for "${decision}".` };
      const r = await decideTask(ctx.supabase, task.id, decision);
      if (!r) return { error: "That task is gone." };
      if (r.run) await kick(ctx.origin, task.id);
      ctx.changed = true;
      ctx.actions.push({ label: "Watch it", href: `/web?task=${task.id}` });
      return { task: task.goal, decision, now: r.run ? "working again" : r.task.status, step: decision === "approve" || decision === "reject" ? task.pending?.label : undefined };
    },
  },
  web_task_delete: {
    name: "web_task_delete",
    description: "Delete a web task from the list ('which' = words from its goal), or every finished one with which='finished'. A task still working is stopped first. Only on the owner's own request.",
    parameters: obj({ which: S }, ["which"]),
    async run(args, ctx) {
      const { listTasks, deleteTasks, ACTIVE } = await import("@/lib/web-agent/store");
      const { decideTask } = await import("@/lib/web-agent/runner");
      const tasks = await listTasks(ctx.supabase);
      const words = str(args.which).toLowerCase();
      if (/^(all )?(finished|done|completed|old)( ones| tasks)?$/.test(words)) {
        const n = await deleteTasks(ctx.supabase, tasks.filter((t) => !ACTIVE.includes(t.status)).map((t) => t.id));
        ctx.changed = true;
        return { deleted: n, note: "Tasks still working were kept." };
      }
      const task = tasks.find((t) => t.goal.toLowerCase().includes(words)) ?? tasks.find((t) => words.split(/\s+/).every((w) => t.goal.toLowerCase().includes(w)));
      if (!task) return { error: `No web task matching "${words}".`, tasks: tasks.slice(0, 6).map((t) => t.goal) };
      if (ACTIVE.includes(task.status)) await decideTask(ctx.supabase, task.id, "cancel");
      await deleteTasks(ctx.supabase, [task.id]);
      ctx.changed = true;
      return { deleted: task.goal };
    },
  },
};
