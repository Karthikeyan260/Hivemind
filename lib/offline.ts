"use client";

// Offline mode for notes and memories. Reads of /api/notes, /api/memories* and /api/projects are
// copied into IndexedDB so the pages still show them without a network. Creates, edits and deletes
// made while offline go into an outbox, show up straight away (temporary "local-…" ids), and are
// sent in order when the connection comes back; the server then adds the AI summary, tags and
// embedding as usual. Last write wins: this is a one-owner app.

const DB_NAME = "hivemind-offline";
const CACHE = "cache";
const OUTBOX = "outbox";
const META = "meta";

/** Fired whenever the offline status changes (online, pending count, syncing, last error). */
export const OFFLINE_STATUS = "hivemind:offline-status";

export type OfflineStatus = { online: boolean; pending: number; syncing: boolean; error: string | null; syncedAt: number | null };
type Op = { key?: number; method: "POST" | "PUT" | "DELETE"; path: string; body?: Record<string, unknown>; tempId?: string; at: number };
type Row = Record<string, unknown> & { id: string };

const CACHEABLE = /^\/api\/(notes|memories|projects)(\/|\?|$)/;
const LOCAL_ID = /local-[0-9a-f-]{36}/g;

/** Lists warmed into the cache while online, so offline works even for pages not opened yet. */
const WARM = ["/api/notes", "/api/memories", "/api/memories/explore", "/api/projects"];

export const isLocalId = (id: string | null | undefined) => !!id?.startsWith("local-");
export const isNetworkError = (e: unknown) => e instanceof TypeError;
export const canCache = (path: string) => CACHEABLE.test(path);
/** Writes that can wait for the network: create a note/memory, or edit/delete one. */
export const canQueue = (method: string, path: string) =>
  (method === "POST" && /^\/api\/(notes|memories)$/.test(path)) ||
  ((method === "PUT" || method === "DELETE") && /^\/api\/(notes|memories)\/[\w-]+$/.test(path));

// ---------- IndexedDB ----------

let dbPromise: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(CACHE)) d.createObjectStore(CACHE);
        if (!d.objectStoreNames.contains(OUTBOX)) d.createObjectStore(OUTBOX, { keyPath: "key", autoIncrement: true });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : (undefined as T));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const get = <T>(store: string, key: IDBValidKey) => tx<T | undefined>(store, "readonly", (s) => s.get(key));
const put = (store: string, value: unknown, key?: IDBValidKey) => tx(store, "readwrite", (s) => void s.put(value, key));
const del = (store: string, key: IDBValidKey) => tx(store, "readwrite", (s) => void s.delete(key));
const allOps = () => tx<Op[]>(OUTBOX, "readonly", (s) => s.getAll());

export async function readCache<T>(path: string): Promise<T | undefined> {
  try {
    return await get<T>(CACHE, path);
  } catch {
    return undefined;
  }
}

export async function writeCache(path: string, data: unknown) {
  try {
    await put(CACHE, data, path);
  } catch {}
}

// ---------- id map (local-… → real id after sync) ----------

let idMap: Record<string, string> = {};
let idMapLoaded = false;
async function loadIdMap() {
  if (idMapLoaded) return idMap;
  try {
    idMap = (await get<Record<string, string>>(META, "idmap")) ?? {};
  } catch {}
  idMapLoaded = true;
  return idMap;
}

/** Swaps any synced "local-…" id in a path for its real id, so an open note keeps saving. */
export async function resolvePath(path: string) {
  if (!path.includes("local-")) return path;
  const map = await loadIdMap();
  return path.replace(LOCAL_ID, (id) => map[id] ?? id);
}

// ---------- status ----------

const status: OfflineStatus = { online: true, pending: 0, syncing: false, error: null, syncedAt: null };
export const getStatus = () => ({ ...status });
function emit(patch: Partial<OfflineStatus>) {
  Object.assign(status, patch);
  window.dispatchEvent(new CustomEvent(OFFLINE_STATUS, { detail: getStatus() }));
}
async function refreshPending() {
  try {
    emit({ pending: (await allOps()).length });
  } catch {}
}

// ---------- reading while offline ----------

type Explore = { facets: { total: number; types: Record<string, number> } & Record<string, unknown>; items: Row[] };

/** Best offline answer for a GET: the exact cached response, else one built from cached lists. */
export async function offlineRead<T>(path: string): Promise<T | undefined> {
  const exact = await readCache<T>(path);
  if (exact !== undefined) return exact;
  const url = new URL(path, location.origin);

  // A search or filter not cached yet: filter the full explore list here.
  if (url.pathname === "/api/memories/explore") {
    const base = await readCache<Explore>("/api/memories/explore");
    if (!base) return undefined;
    const p = url.searchParams;
    const q = (p.get("q") ?? "").toLowerCase();
    const items = base.items.filter(
      (m) =>
        (!q || `${m.title} ${m.snippet}`.toLowerCase().includes(q)) &&
        (!p.get("type") || m.memory_type === p.get("type")) &&
        (!p.get("category") || m.category === p.get("category")) &&
        (!p.get("project") || m.project_id === p.get("project")),
    );
    return { ...base, facets: { ...base.facets, total: items.length }, items } as T;
  }

  // A memory never opened while online: show what the full list knows, without history or links.
  const detail = url.pathname.match(/^\/api\/memories\/([^/]+)\/detail$/);
  if (detail) {
    const list = (await readCache<Row[]>("/api/memories")) ?? [];
    const m = list.find((x) => x.id === detail[1]);
    if (!m) return undefined;
    return {
      memory: { ...m, metadata: m.metadata ?? {}, source: { key: "offline", label: isLocalId(m.id) ? "Saved offline, waiting to sync" : "Saved in HIVEMIND" }, has_embedding: !isLocalId(m.id) },
      project: null,
      versions: [],
      current_version: 1,
      timeline: [],
      related: { items: [], projects: [], skills: [] },
    } as T;
  }

  if (url.search) return readCache<T>(url.pathname);
  return undefined;
}

// ---------- writing while offline ----------

const now = () => new Date().toISOString();

async function patchList(path: string, fn: (rows: Row[]) => Row[]) {
  const rows = await readCache<Row[]>(path);
  if (rows) await writeCache(path, fn(rows));
}
async function patchExplore(fn: (items: Row[]) => Row[]) {
  const ex = await readCache<Explore>("/api/memories/explore");
  if (!ex) return;
  const items = fn(ex.items);
  await writeCache("/api/memories/explore", { ...ex, facets: { ...ex.facets, total: items.length }, items });
}
const exploreItem = (m: Row): Row => ({
  id: m.id,
  title: m.title,
  snippet: String(m.content ?? "").slice(0, 180),
  memory_type: m.memory_type,
  category: m.category ?? null,
  importance: m.importance ?? 5,
  confidence: m.confidence ?? 1,
  project_id: m.project_id ?? null,
  source: "hivemind",
  updated_at: m.updated_at,
});

/** Applies a write to the cached lists so it shows immediately, and returns what the API would. */
async function applyLocally(op: Op): Promise<Row | undefined> {
  const kind = op.path.startsWith("/api/notes") ? "notes" : "memories";
  const listPath = `/api/${kind}`;
  const id = op.tempId ?? op.path.split("/")[3];
  const body = op.body ?? {};
  const content = String(body.content ?? "");

  if (op.method === "DELETE") {
    await patchList(listPath, (rows) => rows.filter((r) => r.id !== id));
    if (kind === "memories") {
      await patchExplore((items) => items.filter((r) => r.id !== id));
      await del(CACHE, `/api/memories/${id}/detail`).catch(() => {});
    }
    return undefined;
  }

  if (op.method === "POST") {
    const title = String(body.title || content.split("\n")[0].slice(0, 60) || "Untitled");
    const row: Row =
      kind === "notes"
        ? { id, project_id: body.project_id ?? null, title, content, summary: null, category: null, tags: body.tags ?? [], created_at: now(), updated_at: now() }
        : {
            id,
            project_id: body.project_id ?? null,
            title,
            content,
            memory_type: body.memory_type ?? "fact",
            category: body.category ?? null,
            importance: body.importance ?? 5,
            confidence: body.confidence ?? 1,
            tags: body.tags ?? [],
            metadata: { offline: true },
            created_at: now(),
            updated_at: now(),
          };
    await writeCache(listPath, [row, ...((await readCache<Row[]>(listPath)) ?? [])]);
    if (kind === "memories") await patchExplore((items) => [exploreItem(row), ...items]);
    return row;
  }

  // PUT: merge the changed fields into every cached copy.
  const fields = Object.fromEntries(Object.entries(body).filter(([k, v]) => k !== "change_reason" && v !== undefined));
  let updated: Row | undefined;
  await patchList(listPath, (rows) =>
    rows.map((r) => {
      if (r.id !== id) return r;
      updated = { ...r, ...fields, title: fields.title || r.title, updated_at: now() };
      return updated;
    }),
  );
  if (kind === "memories" && updated) {
    const u = updated;
    await patchExplore((items) => items.map((r) => (r.id === id ? exploreItem(u) : r)));
    await del(CACHE, `/api/memories/${id}/detail`).catch(() => {});
  }
  return updated ?? { id, ...fields };
}

/** An online save went through: put the server's copy into the cached lists too. */
export async function rememberWrite(method: string, path: string, saved?: Row) {
  try {
    const kind = path.startsWith("/api/notes") ? "notes" : "memories";
    const id = saved?.id ?? path.split("/")[3];
    if (method === "DELETE") return void (await applyLocally({ method: "DELETE", path: `/api/${kind}/${id}`, at: 0 }));
    if (!saved?.id) return;
    const upsert = (rows: Row[]) => [saved, ...rows.filter((r) => r.id !== id)];
    await patchList(`/api/${kind}`, upsert);
    if (kind === "memories") {
      await patchExplore((items) => [exploreItem(saved), ...items.filter((r) => r.id !== id)]);
      await del(CACHE, `/api/memories/${id}/detail`);
    }
  } catch {}
}

/** Queues a write for later and applies it locally. Edits to an unsynced item fold into its create. */
export async function queueWrite(method: Op["method"], path: string, body?: Record<string, unknown>): Promise<Row | undefined> {
  const ops = await allOps();
  const id = path.split("/")[3];
  let op: Op = { method, path, body, at: Date.now() };

  if (method === "POST") {
    op.tempId = `local-${crypto.randomUUID()}`;
    await put(OUTBOX, op);
  } else if (isLocalId(id)) {
    const create = ops.find((o) => o.tempId === id);
    if (create) {
      if (method === "DELETE") await del(OUTBOX, create.key!);
      else await put(OUTBOX, { ...create, body: { ...create.body, ...body, change_reason: undefined } });
    }
  } else {
    // One pending edit per item is enough; a delete replaces any pending edit.
    for (const o of ops) if (o.path === path && o.method === "PUT") await del(OUTBOX, o.key!);
    const prev = ops.find((o) => o.path === path && o.method === "PUT");
    if (method === "PUT" && prev) op = { ...op, body: { ...prev.body, ...body } };
    await put(OUTBOX, op);
  }

  const result = await applyLocally(method === "POST" ? op : { ...op, path });
  await refreshPending();
  return result;
}

// ---------- sync ----------

let flushing: Promise<void> | null = null;

/** Sends queued writes in order. Stops on network or server errors and tries again later. */
export function flush(): Promise<void> {
  if (!flushing) flushing = doFlush().finally(() => (flushing = null));
  return flushing;
}

async function doFlush() {
  if (!navigator.onLine) return;
  let ops: Op[];
  try {
    ops = await allOps();
  } catch {
    return;
  }
  if (!ops.length) return;
  emit({ syncing: true, error: null });
  const map = await loadIdMap();
  let synced = 0;
  let error: string | null = null;

  try {
    for (const op of ops.sort((a, b) => a.key! - b.key!)) {
      const path = op.path.replace(LOCAL_ID, (id) => map[id] ?? id);
      if (isLocalId(path.split("/")[3])) {
        // Its create failed for good; nothing to edit on the server.
        await del(OUTBOX, op.key!);
        continue;
      }
      let res: Response;
      try {
        res = await fetch(path, {
          method: op.method,
          headers: op.body ? { "Content-Type": "application/json" } : undefined,
          body: op.body ? JSON.stringify(op.body) : undefined,
        });
      } catch {
        error = "Still offline";
        break;
      }
      if (res.status === 401) {
        error = "Unlock HIVEMIND to sync";
        break;
      }
      if (res.status >= 500 || res.status === 429) {
        error = `Server error (${res.status}), will retry`;
        break;
      }
      if (res.ok && op.tempId) {
        const saved = await res.json().catch(() => null);
        if (saved?.id) {
          map[op.tempId] = saved.id;
          await put(META, map, "idmap");
          // The page may still show the temporary id in its address.
          if (location.search.includes(op.tempId)) history.replaceState(history.state, "", location.href.replace(op.tempId, saved.id));
        }
      } else if (!res.ok && res.status !== 404) {
        // A bad request will never succeed; drop it rather than block everything after it.
        const data = await res.json().catch(() => ({}));
        error = `Couldn't sync "${String(op.body?.title ?? op.body?.content ?? "").slice(0, 40)}": ${data.error ?? res.status}`;
      }
      await del(OUTBOX, op.key!);
      synced++;
    }
  } finally {
    await refreshPending();
    emit({ syncing: false, error, syncedAt: synced ? Date.now() : status.syncedAt });
  }

  if (synced) {
    await warm(true);
    window.dispatchEvent(new Event("hivemind:brain-changed"));
  }
}

// Kept for the tab (not just the page), so moving between pages doesn't refetch everything each time.
const WARMED_KEY = "hm-warmed-at";
const warmedAt = () => {
  try {
    return Number(sessionStorage.getItem(WARMED_KEY)) || 0;
  } catch {
    return 0;
  }
};
/** Refreshes the cached lists (at most every 5 minutes unless forced). */
export async function warm(force = false) {
  if (!navigator.onLine || (!force && Date.now() - warmedAt() < 5 * 60_000)) return;
  if ((await allOps().catch(() => [])).length) return; // don't overwrite unsynced local changes
  try {
    sessionStorage.setItem(WARMED_KEY, String(Date.now()));
  } catch {}
  await Promise.all(
    WARM.map(async (path) => {
      try {
        const res = await fetch(path);
        if (res.ok) await writeCache(path, await res.json());
      } catch {}
    }),
  );
}

let started = false;
/** Starts syncing: on load, whenever the connection returns, and every minute while items wait. */
export function startOfflineSync() {
  if (started || typeof indexedDB === "undefined") return;
  started = true;
  const online = () => {
    emit({ online: true });
    void flush().then(() => warm());
  };
  // The first sync waits until the page is idle, so it never competes with the page itself.
  const idle = (fn: () => void) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 4000 });
    else setTimeout(fn, 1500);
  };
  window.addEventListener("online", online);
  window.addEventListener("offline", () => emit({ online: false }));
  emit({ online: navigator.onLine });
  idle(() => void refreshPending().then(() => (navigator.onLine ? online() : undefined)));
  setInterval(() => {
    if (status.pending && navigator.onLine) void flush();
  }, 60_000);
  // Keep the app pages themselves cached by the service worker.
  if (navigator.onLine && !warmedAt()) navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: "warm", urls: ["/", "/notes", "/memories"] })).catch(() => {});
}

/** On lock: forget cached notes and memories on this device. Unsynced writes are kept. */
/**
 * Locking / logging out: nothing private stays readable on this device. Unsynced changes are sent
 * first (a few seconds at most), then the offline copies, the queue, saved pages and a pending share
 * are deleted. Build files and the push service worker stay (they hold no personal data).
 */
export async function clearOfflineCache() {
  try {
    await Promise.race([flush(), new Promise((r) => setTimeout(r, 4000))]);
  } catch {}
  for (const store of [CACHE, OUTBOX, META]) {
    try {
      await tx(store, "readwrite", (s) => void s.clear());
    } catch {}
  }
  for (const name of ["hivemind-pages", "hivemind-share"]) {
    try {
      await caches.delete(name);
    } catch {}
  }
}
