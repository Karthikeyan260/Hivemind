"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Runs a HIVEMIND app in a sealed box: a sandboxed iframe with no same-origin access (it can't read
 * HIVEMIND's cookies, pages or APIs) and a page policy that blocks all network access. Its only way
 * out is the window.hive bridge below: its own saved data, and voice actions the owner can call.
 */

// HIVEMIND's look inside the app, so generated apps match the rest of the app.
const THEME = `<style>
:root{color-scheme:dark;--bg:oklch(0.155 0.012 250);--panel:oklch(0.19 0.014 250);--raised:oklch(0.23 0.016 250);--line:oklch(0.32 0.02 245/.55);--text:oklch(0.94 0.008 240);--soft:oklch(0.72 0.02 240);--accent:oklch(0.8 0.14 72);--accent-ink:oklch(0.2 0.03 70);--ok:oklch(0.8 0.14 150);--alert:oklch(0.7 0.18 25)}
html,body{margin:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Tamil",sans-serif;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}input,select,textarea,button{font:inherit;color:inherit}
</style>`;

// No network, no forms leaving, nothing from outside: generated code can't send data anywhere.
const POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;

// window.hive inside the app: promise-based storage + voice actions, over postMessage to the host.
const BRIDGE = `<script>(function(){var n=0,wait={},acts={};
function call(op,a){return new Promise(function(ok,no){var id=++n;wait[id]=[ok,no];parent.postMessage(Object.assign({hive:1,id:id,op:op},a||{}),"*")})}
window.addEventListener("message",function(e){var d=e.data;if(!d||d.hive!==1||e.source!==parent)return;
if(d.op==="reply"){var w=wait[d.id];if(!w)return;delete wait[d.id];d.ok?w[0](d.value):w[1](new Error(d.error||"failed"));return}
if(d.op==="action"){var h=acts[d.name];Promise.resolve().then(function(){return h?h(d.input||""):{error:"unknown action"}}).then(function(r){parent.postMessage({hive:1,op:"actionResult",callId:d.callId,result:r==null?{done:true}:r},"*")},function(err){parent.postMessage({hive:1,op:"actionResult",callId:d.callId,result:{error:String(err&&err.message||err)}},"*")})}});
window.hive={get:function(k){return call("get",{key:String(k)})},set:function(k,v){return call("set",{key:String(k),value:v})},remove:function(k){return call("remove",{key:String(k)})},keys:function(){return call("keys")},
action:function(name,description,handler){acts[name]=handler;call("action",{name:String(name),description:String(description||"")})}};})();</script>`;

/** The app's page with the theme, the no-network policy and the bridge put in front of its own code. */
function compose(html: string) {
  const head = /<head[^>]*>/i.exec(html);
  const inject = `${POLICY}${THEME}${BRIDGE}`;
  const firstScript = html.search(/<script/i);
  // The policy must come before any of the app's own code: a script ahead of <head> gets it put first.
  if (head && (firstScript < 0 || firstScript > head.index)) return html.slice(0, head.index + head[0].length) + inject + html.slice(head.index + head[0].length);
  return inject + html.replace(/^\s*<!doctype[^>]*>/i, "");
}

/** The same no-network rule, enforced by the browser on the frame itself (Chromium). */
const FRAME_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

export type AppAction = { name: string; description: string };

export function AppRunner({
  id,
  html,
  version,
  onActions,
  callRef,
}: {
  id: string;
  html: string;
  version: number;
  onActions: (a: AppAction[]) => void;
  /** Lets the page run one of the app's voice actions. */
  callRef: React.RefObject<((name: string, input: string) => Promise<unknown>) | null>;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const data = useRef<Record<string, unknown> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(new Map<string, (r: unknown) => void>());
  const [error, setError] = useState<string | null>(null);
  const srcDoc = useMemo(() => compose(html), [html]);

  useEffect(() => {
    let alive = true;
    const actions = new Map<string, string>();
    onActions([]);
    data.current = null;
    const loaded = fetch(`/api/apps/${id}/data`)
      .then((r) => r.json())
      .then((d) => {
        data.current = d && typeof d === "object" ? d : {};
      })
      .catch(() => {
        data.current = {};
      });

    const save = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void fetch(`/api/apps/${id}/data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: data.current ?? {} }) })
          .then((r) => (r.ok ? setError(null) : r.json().then((j) => setError(j.error ?? "Couldn't save."))))
          .catch(() => setError("Couldn't save (offline?)."));
      }, 500);
    };

    const onMessage = async (e: MessageEvent) => {
      // Only this app's own frame may use the bridge.
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as { hive?: number; id?: number; op?: string; key?: string; value?: unknown; name?: string; description?: string; callId?: string; result?: unknown };
      if (!m || m.hive !== 1) return;
      const reply = (ok: boolean, value?: unknown, err?: string) => frame.current?.contentWindow?.postMessage({ hive: 1, op: "reply", id: m.id, ok, value, error: err }, "*");
      if (m.op === "actionResult") {
        pending.current.get(String(m.callId))?.(m.result);
        pending.current.delete(String(m.callId));
        return;
      }
      if (m.op === "action" && m.name) {
        actions.set(m.name.slice(0, 40), (m.description ?? "").slice(0, 300));
        onActions([...actions].map(([name, description]) => ({ name, description })));
        return reply(true);
      }
      await loaded;
      if (!alive) return;
      const store = data.current!;
      switch (m.op) {
        case "get":
          return reply(true, m.key && m.key in store ? store[m.key] : null);
        case "set":
          if (!m.key) return reply(false, null, "missing key");
          store[m.key] = m.value ?? null;
          save();
          return reply(true, true);
        case "remove":
          if (m.key) delete store[m.key];
          save();
          return reply(true, true);
        case "keys":
          return reply(true, Object.keys(store));
        default:
          return reply(false, null, "unknown operation");
      }
    };
    window.addEventListener("message", onMessage);

    callRef.current = (name, input) =>
      new Promise((resolve) => {
        const callId = crypto.randomUUID();
        const t = setTimeout(() => {
          pending.current.delete(callId);
          resolve({ error: "The app didn't answer." });
        }, 8000);
        pending.current.set(callId, (r) => {
          clearTimeout(t);
          resolve(r);
        });
        frame.current?.contentWindow?.postMessage({ hive: 1, op: "action", name, input, callId }, "*");
      });

    return () => {
      alive = false;
      window.removeEventListener("message", onMessage);
      callRef.current = null;
      // Don't lose the last change when leaving the page.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (data.current) navigator.sendBeacon?.(`/api/apps/${id}/data`, new Blob([JSON.stringify({ data: data.current })], { type: "application/json" }));
      }
    };
    // A new version reloads the frame, so the bridge restarts with it.
  }, [id, version, onActions, callRef]);

  return (
    <div className="relative h-full w-full">
      <iframe
        ref={frame}
        key={`${id}-${version}`}
        title="App"
        sandbox="allow-scripts allow-forms"
        {...{ csp: FRAME_POLICY }}
        srcDoc={srcDoc}
        className="h-full w-full rounded-xl border border-line bg-[oklch(0.155_0.012_250)]"
      />
      {error && <p className="absolute bottom-2 left-2 rounded bg-alert/15 px-2 py-1 text-xs text-alert">{error}</p>}
    </div>
  );
}
