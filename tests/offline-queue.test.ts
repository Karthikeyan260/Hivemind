import { setMaxListeners } from "node:events";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The offline layer (lib/offline.ts) run against an imitation of the browser's IndexedDB: writes made without a
 * network wait in a queue, show up at once under temporary "local-…" ids, and are sent in order when the network returns.
 */

type Row = Record<string, unknown> & { id: string };
type Call = { method: string; path: string; body: Record<string, unknown> | null };

const sent: Call[] = [];
const sessionStore = new Map<string, string>();
const pageCaches: string[] = [];
let online = true;
// What the fake server answers to writes (a function so a test can script a sequence).
let answer: (c: Call) => Response | Promise<Response>;
let get: Record<string, unknown> = {};
const win = new EventTarget();
setMaxListeners(200, win);
const events: { online?: boolean; pending: number; syncing: boolean; error: string | null }[] = [];
const history = { state: null as unknown, replaceState: vi.fn() };
const location = { origin: "http://app.test", search: "", href: "http://app.test/notes" };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let counter = 0;
const created = (c: Call) => json(201, { id: `real-${++counter}`, ...(c.body ?? {}) });

async function lib() {
  return import("@/lib/offline");
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", history);
  vi.stubGlobal("navigator", { get onLine() { return online; }, serviceWorker: undefined });
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => sessionStore.get(k) ?? null, setItem: (k: string, v: string) => void sessionStore.set(k, v) });
  vi.stubGlobal("caches", { delete: async (n: string) => void pageCaches.push(n) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (!online) throw new TypeError("Failed to fetch");
      if (method === "GET") return path in get ? json(200, get[path]) : json(404, {});
      const call: Call = { method, path, body: init?.body ? JSON.parse(String(init.body)) : null };
      sent.push(call);
      return answer(call);
    }),
  );
  online = true;
  sent.length = 0;
  sessionStore.clear();
  pageCaches.length = 0;
  events.length = 0;
  counter = 0;
  get = {};
  answer = created;
  history.replaceState.mockClear();
  location.search = "";
  location.href = "http://app.test/notes";
  win.addEventListener("hivemind:offline-status", (e) => events.push((e as CustomEvent).detail));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const seed = async (path: string, data: unknown) => (await lib()).writeCache(path, data);
const note = (id: string, title = id) => ({ id, title, content: `${title} body`, tags: [] });

describe("what may be cached or queued", () => {
  it("only notes, memories and projects are cached; only note/memory writes are queued", async () => {
    const o = await lib();
    for (const p of ["/api/notes", "/api/notes/abc", "/api/memories?x=1", "/api/memories/explore", "/api/projects", "/api/projects/p1"]) expect(o.canCache(p), p).toBe(true);
    for (const p of ["/api/documents", "/api/photos", "/api/unlock", "/api/export", "/api/notesx", "/api/sessions"]) expect(o.canCache(p), p).toBe(false);
    expect(o.canQueue("POST", "/api/notes")).toBe(true);
    expect(o.canQueue("POST", "/api/memories")).toBe(true);
    expect(o.canQueue("PUT", "/api/notes/abc-123")).toBe(true);
    expect(o.canQueue("DELETE", "/api/memories/abc")).toBe(true);
    for (const [m, p] of [["POST", "/api/documents"], ["POST", "/api/notes/abc"], ["PUT", "/api/notes"], ["DELETE", "/api/notes"], ["GET", "/api/notes"], ["DELETE", "/api/projects/p1"], ["POST", "/api/unlock"], ["PUT", "/api/notes/a/b"]]) expect(o.canQueue(m, p), `${m} ${p}`).toBe(false);
  });
  it("tells temporary ids from real ones and network errors from others", async () => {
    const o = await lib();
    expect(o.isLocalId("local-1234")).toBe(true);
    expect(o.isLocalId("1234")).toBe(false);
    expect(o.isLocalId(undefined)).toBe(false);
    expect(o.isNetworkError(new TypeError("x"))).toBe(true);
    expect(o.isNetworkError(new Error("x"))).toBe(false);
  });
});

describe("writing while offline", () => {
  it("a new note shows at once under a temporary id and waits in the queue", async () => {
    await seed("/api/notes", [note("n1")]);
    online = false;
    const o = await lib();
    const row = await o.queueWrite("POST", "/api/notes", { title: "Offline note", content: "written on a train" });
    expect(row?.id).toMatch(/^local-[0-9a-f-]{36}$/);
    const list = (await o.readCache<Row[]>("/api/notes"))!;
    expect(list.map((r) => r.title)).toEqual(["Offline note", "n1"]);
    expect(o.getStatus().pending).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("a new memory also appears in the explore list with its defaults", async () => {
    await seed("/api/memories", []);
    await seed("/api/memories/explore", { facets: { total: 0, types: {} }, items: [] });
    const o = await lib();
    await o.queueWrite("POST", "/api/memories", { content: "I prefer green tea\nsecond line" });
    const ex = (await o.readCache<{ facets: { total: number }; items: Row[] }>("/api/memories/explore"))!;
    expect(ex.facets.total).toBe(1);
    expect(ex.items[0]).toMatchObject({ title: "I prefer green tea", memory_type: "fact", importance: 5, source: "hivemind" });
  });

  it("editing an unsynced item changes its create instead of queueing a second operation; deleting it cancels the create", async () => {
    await seed("/api/notes", []);
    const o = await lib();
    const row = (await o.queueWrite("POST", "/api/notes", { title: "Draft", content: "v1" }))!;
    await o.queueWrite("PUT", `/api/notes/${row.id}`, { content: "v2" });
    expect(o.getStatus().pending).toBe(1);
    expect((await o.readCache<Row[]>("/api/notes"))![0]).toMatchObject({ title: "Draft", content: "v2" });
    await o.queueWrite("DELETE", `/api/notes/${row.id}`);
    expect(o.getStatus().pending).toBe(0);
    expect(await o.readCache<Row[]>("/api/notes")).toEqual([]);
    online = true;
    await o.flush();
    expect(sent).toHaveLength(0);
  });

  it("keeps one pending edit per saved item (the later edit folds into the first), and a delete replaces it", async () => {
    await seed("/api/notes", [note("n1", "Old")]);
    const o = await lib();
    await o.queueWrite("PUT", "/api/notes/n1", { title: "A", content: "1" });
    await o.queueWrite("PUT", "/api/notes/n1", { content: "2" });
    expect(o.getStatus().pending).toBe(1);
    await o.queueWrite("DELETE", "/api/notes/n1");
    expect(o.getStatus().pending).toBe(1);
    online = true;
    await o.flush();
    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /api/notes/n1"]);
  });

  it("deleting an item removes it from the lists at once", async () => {
    await seed("/api/memories", [{ id: "m1", title: "x" }, { id: "m2", title: "y" }]);
    await seed("/api/memories/explore", { facets: { total: 2, types: {} }, items: [{ id: "m1" }, { id: "m2" }] });
    const o = await lib();
    await o.queueWrite("DELETE", "/api/memories/m1");
    expect((await o.readCache<Row[]>("/api/memories"))!.map((r) => r.id)).toEqual(["m2"]);
    expect((await o.readCache<{ items: Row[] }>("/api/memories/explore"))!.items.map((r) => r.id)).toEqual(["m2"]);
  });
});

describe("syncing", () => {
  it("sends the queue in order, with a client_id on creates so a retry cannot make a duplicate", async () => {
    await seed("/api/notes", [note("n1")]);
    const o = await lib();
    const a = (await o.queueWrite("POST", "/api/notes", { title: "First", content: "a" }))!;
    await o.queueWrite("PUT", "/api/notes/n1", { content: "edited" });
    await o.queueWrite("POST", "/api/memories", { content: "second create" });
    await o.flush();
    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/notes", "PUT /api/notes/n1", "POST /api/memories"]);
    expect(sent[0].body).toMatchObject({ title: "First", client_id: a.id });
    expect(sent[1].body).not.toHaveProperty("client_id");
    expect(o.getStatus()).toMatchObject({ pending: 0, syncing: false, error: null });
    expect(o.getStatus().syncedAt).toBeGreaterThan(0);
  });

  it("a note created offline and then edited syncs as one create carrying the final text", async () => {
    await seed("/api/notes", []);
    const o = await lib();
    const row = (await o.queueWrite("POST", "/api/notes", { title: "T", content: "first" }))!;
    await o.queueWrite("PUT", `/api/notes/${row.id}`, { content: "final" });
    await o.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ content: "final" });
  });

  it("maps the temporary id to the real one, so an open page keeps saving and its address is fixed", async () => {
    await seed("/api/notes", []);
    const o = await lib();
    const row = (await o.queueWrite("POST", "/api/notes", { title: "T", content: "c" }))!;
    location.search = `?id=${row.id}`;
    location.href = `http://app.test/notes?id=${row.id}`;
    await o.flush();
    expect(await o.resolvePath(`/api/notes/${row.id}`)).toBe("/api/notes/real-1");
    expect(await o.resolvePath("/api/notes/plain-id")).toBe("/api/notes/plain-id");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "http://app.test/notes?id=real-1");
  });

  it("an edit of a note whose create has already synced is sent to the real id", async () => {
    await seed("/api/notes", []);
    const o = await lib();
    const row = (await o.queueWrite("POST", "/api/notes", { title: "T", content: "c" }))!;
    // The create goes out; the page still holds the temporary id, and the app maps it before queueing (lib/client-api.ts).
    await o.flush();
    await o.queueWrite("PUT", await o.resolvePath(`/api/notes/${row.id}`), { content: "later edit" });
    await o.flush();
    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/notes", "PUT /api/notes/real-1"]);
  });

  it("does nothing while offline and keeps everything queued", async () => {
    await seed("/api/notes", []);
    const o = await lib();
    online = false;
    await o.queueWrite("POST", "/api/notes", { title: "T", content: "c" });
    await o.flush();
    expect(o.getStatus().pending).toBe(1);
    expect(o.getStatus().syncing).toBe(false);
  });

  it("stops at the first network error and keeps the rest for later", async () => {
    await seed("/api/notes", []);
    const o = await lib();
    await o.queueWrite("POST", "/api/notes", { title: "1", content: "a" });
    await o.queueWrite("POST", "/api/notes", { title: "2", content: "b" });
    let n = 0;
    answer = (c) => {
      if (++n === 1) { online = false; return created(c); }
      return created(c);
    };
    await o.flush();
    expect(sent).toHaveLength(1);
    expect(o.getStatus()).toMatchObject({ pending: 1, error: "Still offline" });
    online = true;
    answer = created;
    await o.flush();
    expect(o.getStatus()).toMatchObject({ pending: 0, error: null });
  });

  it("asks to unlock on a 401 and keeps the queue", async () => {
    await seed("/api/notes", []);
    const o = await lib();
    await o.queueWrite("POST", "/api/notes", { title: "T", content: "c" });
    answer = () => json(401, { error: "Locked" });
    await o.flush();
    expect(o.getStatus()).toMatchObject({ pending: 1, error: "Unlock HIVEMIND to sync" });
  });

  it("retries later after a server error or rate limit, never dropping the write", async () => {
    await seed("/api/notes", []);
    const o = await lib();
    await o.queueWrite("POST", "/api/notes", { title: "T", content: "c" });
    for (const status of [500, 502, 429]) {
      answer = () => json(status, { error: "x" });
      await o.flush();
      expect(o.getStatus(), String(status)).toMatchObject({ pending: 1 });
      expect(o.getStatus().error).toMatch(String(status));
    }
  });

  it("drops a write the server will never accept, reports it, and carries on with the rest", async () => {
    await seed("/api/notes", []);
    const o = await lib();
    await o.queueWrite("POST", "/api/notes", { title: "Bad one", content: "x" });
    await o.queueWrite("POST", "/api/notes", { title: "Good one", content: "y" });
    answer = (c) => (c.body?.title === "Bad one" ? json(400, { error: "Invalid input" }) : created(c));
    await o.flush();
    expect(sent).toHaveLength(2);
    expect(o.getStatus().pending).toBe(0);
    expect(o.getStatus().error).toMatch(/Couldn't sync "Bad one": Invalid input/);
  });

  it("a delete of something already gone (404) is simply done", async () => {
    await seed("/api/notes", [note("n1")]);
    const o = await lib();
    await o.queueWrite("DELETE", "/api/notes/n1");
    answer = () => json(404, { error: "Not found" });
    await o.flush();
    expect(o.getStatus()).toMatchObject({ pending: 0, error: null });
  });

  it("two flushes at once send each write only once", async () => {
    await seed("/api/notes", []);
    const o = await lib();
    await o.queueWrite("POST", "/api/notes", { title: "T", content: "c" });
    await Promise.all([o.flush(), o.flush(), o.flush()]);
    expect(sent).toHaveLength(1);
  });

  it("after a successful sync it refreshes the cached lists and tells the pages", async () => {
    get = { "/api/notes": [note("server-1")], "/api/memories": [], "/api/memories/explore": { facets: { total: 0, types: {} }, items: [] }, "/api/projects": [] };
    await seed("/api/notes", []);
    const o = await lib();
    let changed = 0;
    win.addEventListener("hivemind:brain-changed", () => changed++, { once: true });
    await o.queueWrite("POST", "/api/notes", { title: "T", content: "c" });
    await o.flush();
    expect((await o.readCache<Row[]>("/api/notes"))!.map((r) => r.id)).toEqual(["server-1"]);
    expect(changed).toBe(1);
  });
});

describe("refreshing the cache", () => {
  it("does not overwrite unsynced local changes", async () => {
    get = { "/api/notes": [note("server-1")] };
    await seed("/api/notes", []);
    const o = await lib();
    await o.queueWrite("POST", "/api/notes", { title: "Local", content: "c" });
    await o.warm(true);
    expect((await o.readCache<Row[]>("/api/notes"))!.map((r) => r.title)).toEqual(["Local"]);
  });

  it("is limited to once every 5 minutes unless forced, and skipped offline", async () => {
    get = { "/api/notes": [note("a")], "/api/memories": [], "/api/memories/explore": {}, "/api/projects": [] };
    const o = await lib();
    const fetches = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await o.warm();
    const first = fetches();
    expect(first).toBe(4);
    await o.warm();
    expect(fetches()).toBe(first);
    await o.warm(true);
    expect(fetches()).toBe(first * 2);
    online = false;
    await o.warm(true);
    expect(fetches()).toBe(first * 2);
  });
});

describe("reading while offline", () => {
  it("answers from the exact cached response, or builds one from the cached lists", async () => {
    const o = await lib();
    expect(await o.offlineRead("/api/notes")).toBeUndefined();
    await seed("/api/notes", [note("n1")]);
    expect(await o.offlineRead("/api/notes")).toEqual([note("n1")]);

    await seed("/api/memories/explore", {
      facets: { total: 3, types: {} },
      items: [
        { id: "a", title: "Green tea", snippet: "likes tea", memory_type: "preference", category: "food", project_id: "p1" },
        { id: "b", title: "Chess", snippet: "plays chess", memory_type: "fact", category: "hobby", project_id: null },
        { id: "c", title: "Tea shop", snippet: "near home", memory_type: "fact", category: "food", project_id: "p1" },
      ],
    });
    const ex = async (q: string) => (await o.offlineRead<{ facets: { total: number }; items: Row[] }>(`/api/memories/explore?${q}`))!;
    expect((await ex("q=tea")).items.map((i) => i.id)).toEqual(["a", "c"]);
    expect((await ex("type=fact")).items.map((i) => i.id)).toEqual(["b", "c"]);
    expect((await ex("type=fact&category=food&project=p1")).items.map((i) => i.id)).toEqual(["c"]);
    expect((await ex("q=tea")).facets.total).toBe(2);
    expect((await ex("q=zzz")).items).toEqual([]);

    await seed("/api/memories", [{ id: "a", title: "Green tea", content: "x" }, { id: "local-1", title: "Not synced", content: "y" }]);
    const d = (await o.offlineRead<{ memory: Row & { source: { label: string } }; versions: unknown[] }>("/api/memories/a/detail"))!;
    expect(d.memory.title).toBe("Green tea");
    expect(d.versions).toEqual([]);
    const local = (await o.offlineRead<{ memory: { source: { label: string } } }>("/api/memories/local-1/detail"))!;
    expect(local.memory.source.label).toMatch(/waiting to sync/);
    expect(await o.offlineRead("/api/memories/nope/detail")).toBeUndefined();
  });
});

describe("an online save", () => {
  it("puts the server's copy at the top of the cached lists (replacing an older copy), and a delete removes it", async () => {
    await seed("/api/notes", [note("n1", "old"), note("n2")]);
    await seed("/api/memories", []);
    await seed("/api/memories/explore", { facets: { total: 0, types: {} }, items: [] });
    const o = await lib();
    await o.rememberWrite("PUT", "/api/notes/n1", { ...note("n1", "new") });
    expect((await o.readCache<Row[]>("/api/notes"))!.map((r) => r.title)).toEqual(["new", "n2"]);
    await o.rememberWrite("POST", "/api/memories", { id: "m1", title: "mem", content: "c", memory_type: "fact" });
    expect((await o.readCache<{ items: Row[] }>("/api/memories/explore"))!.items.map((r) => r.id)).toEqual(["m1"]);
    await o.rememberWrite("DELETE", "/api/notes/n2");
    expect((await o.readCache<Row[]>("/api/notes"))!.map((r) => r.id)).toEqual(["n1"]);
  });
});

describe("locking the device", () => {
  it("sends waiting changes first, then wipes the offline copies, the queue and the saved pages", async () => {
    await seed("/api/notes", [note("n1")]);
    await seed("/api/projects", [{ id: "p1" }]);
    const o = await lib();
    await o.queueWrite("POST", "/api/notes", { title: "Unsynced", content: "c" });
    await o.clearOfflineCache();
    expect(sent.map((c) => c.method)).toEqual(["POST"]);
    expect(await o.readCache("/api/notes")).toBeUndefined();
    expect(await o.readCache("/api/projects")).toBeUndefined();
    expect(await o.resolvePath("/api/notes/anything")).toBe("/api/notes/anything");
    expect(pageCaches.sort()).toEqual(["hivemind-pages", "hivemind-share"]);
    // Nothing left to send afterwards.
    sent.length = 0;
    await o.flush();
    expect(sent).toHaveLength(0);
  });

  it("wipes even when the network never answers (it waits a few seconds, then clears)", async () => {
    await seed("/api/notes", [note("n1")]);
    const o = await lib();
    await o.queueWrite("POST", "/api/notes", { title: "Stuck", content: "c" });
    answer = () => new Promise<Response>(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const done = o.clearOfflineCache();
    await vi.advanceTimersByTimeAsync(4100);
    await done;
    expect(await o.readCache("/api/notes")).toBeUndefined();
    expect(o.getStatus().pending).toBeGreaterThanOrEqual(0);
    expect(pageCaches).toContain("hivemind-pages");
  });
});
