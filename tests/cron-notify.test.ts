import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// What the route did, recorded by the fakes below.
const log = {
  notify: [] as { title: string; tag?: string }[],
  released: [] as string[],
  writes: [] as Record<string, unknown>[],
  after: 0,
};
const fx = {
  push: true,
  notifyResult: 1,
  due: [] as { id: string; title: string; when: string; details?: string }[],
  state: {} as Record<string, unknown>,
  dreamEnabled: false,
  autopilotDue: false,
  stuckTasks: [] as { id: string; status: string }[],
};

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => void log.after++ }));
vi.mock("@/lib/session", () => ({ safeEqual: (a: string, b: string) => a === b }));
vi.mock("@/lib/db", () => ({ db: () => ({}) }));
vi.mock("@/lib/push", () => ({
  pushConfigured: () => fx.push,
  notify: async (_s: unknown, n: { title: string; tag?: string }) => {
    log.notify.push(n);
    return fx.push ? fx.notifyResult : 0;
  },
}));
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, _k: string, fallback: unknown) => ({ ...(fallback as object), ...fx.state }),
  writeJSON: async (_s: unknown, _k: string, v: Record<string, unknown>) => void log.writes.push(v),
}));
vi.mock("@/lib/reminders", () => ({
  HOME_TZ: "Asia/Kolkata",
  addDays: (d: string) => d,
  agenda: async () => ({ overdue: [], today: [] }),
  dueAlerts: async () => fx.due,
  releaseAlert: async (_s: unknown, id: string) => void log.released.push(id),
}));
vi.mock("@/lib/autopilot", () => ({ autopilotDue: async () => fx.autopilotDue, runAutopilot: async () => ({}) }));
vi.mock("@/lib/apps", () => ({ recoverStuckBuilds: async () => 0 }));
vi.mock("@/lib/knowledge", () => ({ reembedMissing: async () => 0 }));
vi.mock("@/lib/ai/embeddings", () => ({ getMarker: async () => null }));
vi.mock("@/lib/alerts", () => ({ alertFailure: async () => {} }));
vi.mock("@/lib/embedding-migration", () => ({ migrationStep: async () => {} }));
vi.mock("@/lib/health", () => ({ openTables: async () => [] }));
vi.mock("@/lib/birthdays", () => ({ birthdaysToday: async () => [], runBirthdayAlerts: async () => 0 }));
vi.mock("@/lib/brief", () => ({ briefHeadline: () => "", getBriefSettings: async () => ({ enabled: false, topics: [] }), makeBrief: async () => null }));
vi.mock("@/lib/dream", () => ({ dream: async () => ({}), getDream: async () => null, getDreamSettings: async () => ({ enabled: fx.dreamEnabled, hour: 3 }) }));
vi.mock("@/lib/nova-diary", () => ({ getDiaryEntry: async () => null, writeDiary: async () => {} }));
vi.mock("@/lib/external/weather", () => ({ getWeather: async () => null, HOME_CITY: "Chennai" }));
vi.mock("@/lib/habits", () => ({ runHabitAlerts: async () => 0 }));
vi.mock("@/lib/pet", () => ({ runPetNudges: async () => 0 }));
vi.mock("@/lib/checkin", () => ({ listCheckins: async () => [], nudgeDue: () => true }));
vi.mock("@/lib/kural", () => ({ todaysKural: async () => null }));
vi.mock("@/lib/wrapped", () => ({ monthWrapped: async () => null }));
vi.mock("@/lib/web-agent/store", () => ({ ACTIVE: ["queued", "running"], listTasks: async () => fx.stuckTasks }));
const resumeStalled = vi.fn(async () => 0);
vi.mock("@/lib/web-agent/runner", () => ({ resumeStalled: (...a: unknown[]) => (resumeStalled as (...x: unknown[]) => unknown)(...a) }));

const SECRET = "cron-secret-for-tests-0123456789";
const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};
const call = async (init: { authorization?: string; key?: string } = {}) => {
  const { GET } = await import("@/app/api/cron/notify/route");
  const url = `http://x/api/cron/notify${init.key !== undefined ? `?key=${init.key}` : ""}`;
  return GET(new Request(url, { headers: init.authorization ? { authorization: init.authorization } : {} }));
};
// The state file is written in more than one place (a later write holds only the daily RLS check): the run's own stamp is the one with lastRun.
const lastWrite = () => log.writes.filter((w) => "lastRun" in w).at(-1) ?? {};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("APP_URL", "http://app.test");
  Object.assign(fx, { push: true, notifyResult: 1, due: [], state: {}, dreamEnabled: false, autopilotDue: false, stuckTasks: [] });
  log.notify.length = 0;
  log.released.length = 0;
  log.writes.length = 0;
  log.after = 0;
  resumeStalled.mockClear();
  // 15:30 India time (no brief, check-in or dream window), a plain afternoon.
  at("2026-11-17T10:00:00Z");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/api/cron/notify: who may call it", () => {
  it("refuses a missing, wrong or empty secret", async () => {
    for (const init of [{}, { authorization: "Bearer wrong" }, { authorization: "Bearer " }, { authorization: "Bearer undefined" }, { key: "wrong" }, { key: "" }]) {
      expect((await call(init)).status, JSON.stringify(init)).toBe(401);
    }
    expect(log.writes).toHaveLength(0);
    expect(log.notify).toHaveLength(0);
  });

  it("refuses everyone when no CRON_SECRET is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call({ authorization: "Bearer " })).status).toBe(401);
    expect((await call({ key: "" })).status).toBe(401);
  });

  it("accepts the bearer secret, the bare secret in the header, or ?key=", async () => {
    expect((await call({ authorization: SECRET })).status).toBe(200);
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(200);
    expect((await call({ key: SECRET })).status).toBe(200);
  });
});

describe("/api/cron/notify: what a run does", () => {
  it("stamps lastRun and reports what happened", async () => {
    const res = await call({ authorization: `Bearer ${SECRET}` });
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, push: true, reminders: 0 });
    expect(new Date(lastWrite().lastRun as string).toISOString()).toBe("2026-11-17T10:00:00.000Z");
  });

  it("without VAPID keys it still runs every job and stamps lastRun (no 503), but sends nothing", async () => {
    fx.push = false;
    fx.due = [{ id: "r1", title: "Call amma", when: "Today, 3:30 pm" }];
    fx.autopilotDue = true;
    fx.stuckTasks = [{ id: "t1", status: "running" }];
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect((await res.json()).push).toBe(false);
    expect(lastWrite().lastRun).toBeTruthy();
    // The other jobs ran: Autopilot was scheduled and the stalled web task was looked at.
    expect(log.after).toBeGreaterThan(0);
    expect(resumeStalled).toHaveBeenCalledTimes(1);
    // The reminder was not lost: nobody took it, so it is handed back for the next run or an open tab.
    expect(log.released).toEqual(["r1"]);
  });

  it("a due reminder is pushed; if no device took it, it is released for another try", async () => {
    fx.due = [{ id: "r1", title: "Pay rent", when: "Today, 3:30 pm", details: "UPI" }];
    fx.notifyResult = 1;
    await call({ authorization: `Bearer ${SECRET}` });
    expect(log.notify.map((n) => n.tag)).toContain("reminder-r1");
    expect(log.released).toEqual([]);

    log.notify.length = 0;
    fx.notifyResult = 0;
    await call({ authorization: `Bearer ${SECRET}` });
    expect(log.released).toEqual(["r1"]);
  });
});

describe("/api/cron/notify: the morning brief", () => {
  // 08:30 in India.
  const morning = "2026-11-17T03:00:00Z";

  it("is sent once a day in the morning window, and counts as done only once a device got it", async () => {
    at(morning);
    await call({ authorization: `Bearer ${SECRET}` });
    expect(log.notify.map((n) => n.tag)).toContain("brief");
    expect(lastWrite().brief).toBe("2026-11-17");
  });

  it("is not marked done when no device received it, so a later run can try again", async () => {
    at(morning);
    fx.notifyResult = 0;
    await call({ authorization: `Bearer ${SECRET}` });
    expect(lastWrite().brief).toBeUndefined();
  });

  it("is not sent twice on the same day", async () => {
    at(morning);
    fx.state = { brief: "2026-11-17" };
    await call({ authorization: `Bearer ${SECRET}` });
    expect(log.notify.map((n) => n.tag)).not.toContain("brief");
  });

  it("is not sent in the afternoon (turning it on late must not say 'good morning')", async () => {
    await call({ authorization: `Bearer ${SECRET}` });
    expect(log.notify.map((n) => n.tag)).not.toContain("brief");
  });

  it("is not attempted at all without push keys", async () => {
    at(morning);
    fx.push = false;
    await call({ authorization: `Bearer ${SECRET}` });
    expect(log.notify).toHaveLength(0);
    expect(lastWrite().brief).toBeUndefined();
  });
});

describe("/api/cron/notify: the other jobs", () => {
  it("Dream mode runs only in its night window, once a night, and only if enabled", async () => {
    fx.dreamEnabled = true;
    at("2026-11-16T22:00:00Z"); // 03:30 India time
    await call({ authorization: `Bearer ${SECRET}` });
    expect(lastWrite().dream).toBe("2026-11-17");
    expect(log.after).toBeGreaterThan(0);

    log.after = 0;
    fx.state = { dream: "2026-11-17" };
    await call({ authorization: `Bearer ${SECRET}` });
    expect(lastWrite().dream).toBe("2026-11-17");

    fx.state = {};
    fx.dreamEnabled = false;
    log.writes.length = 0;
    await call({ authorization: `Bearer ${SECRET}` });
    expect(lastWrite().dream).toBeUndefined();
  });

  it("the night check-in nudge goes out at 9 pm and is marked done", async () => {
    at("2026-11-17T15:45:00Z"); // 21:15 India time
    await call({ authorization: `Bearer ${SECRET}` });
    expect(log.notify.map((n) => n.tag)).toContain("checkin");
    expect(lastWrite().checkin).toBe("2026-11-17");
  });

  it("a stalled web task is picked up again", async () => {
    fx.stuckTasks = [{ id: "t1", status: "running" }];
    await call({ authorization: `Bearer ${SECRET}` });
    expect(resumeStalled).toHaveBeenCalledTimes(1);
  });

  it("a run that finds nothing to do still succeeds", async () => {
    const res = await call({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(log.notify).toHaveLength(0);
    expect(resumeStalled).not.toHaveBeenCalled();
  });
});
