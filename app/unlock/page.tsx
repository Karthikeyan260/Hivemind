"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Core } from "@/components/core";
import { Button, ErrorText, Input } from "@/components/ui";

export default function UnlockPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // see what you typed; Caps Lock on; a wrong try shakes the box (the counter replays the shake each time)
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [shake, setShake] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setError((await res.json().catch(() => ({}))).error ?? "Could not unlock");
    } catch {
      setError("Can't reach HIVEMIND right now. Check the connection and try again.");
    }
    setShake((n) => n + 1);
    setBusy(false);
  }

  const capsCheck = (e: React.KeyboardEvent) => setCaps(e.getModifierState?.("CapsLock") ?? false);

  return (
    <main className="hud-grid flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col items-center text-center">
        <Core state={busy ? "thinking" : "idle"} size={120} />
        <h1 className="mt-6 font-mono text-sm font-semibold tracking-[0.35em]">HIVEMIND</h1>
        <p className="mt-2 text-sm text-soft">Identify yourself.</p>
        <div key={shake} className={`relative mt-6 w-full ${shake ? "unlock-shake" : ""}`}>
          <Input
            type={show ? "text" : "password"}
            autoFocus
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={capsCheck}
            onKeyUp={capsCheck}
            autoComplete="current-password"
            className={`px-10 text-center ${error ? "border-alert/60" : ""}`}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide what you typed" : "Show what you typed"}
            title={show ? "Hide" : "Show"}
            className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded text-faint transition hover:text-fg"
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {caps && <p className="mt-2 font-mono text-[10.5px] tracking-wider text-core uppercase">Caps Lock is on</p>}
        <div className="mt-3 w-full">
          <ErrorText error={error} />
        </div>
        <Button type="submit" disabled={busy} className="mt-3 w-full">
          {busy ? "Verifying…" : "Unlock"}
        </Button>
      </form>
    </main>
  );
}
