"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Core } from "@/components/core";
import { Button, ErrorText, Input } from "@/components/ui";

export default function UnlockPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.replace("/");
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? "Could not unlock");
      setBusy(false);
    }
  }

  return (
    <main className="hud-grid flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col items-center text-center">
        <Core state={busy ? "thinking" : "idle"} size={120} />
        <h1 className="mt-6 font-mono text-sm font-semibold tracking-[0.35em]">HIVEMIND</h1>
        <p className="mt-2 text-sm text-soft">Identify yourself.</p>
        <Input type="password" autoFocus required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-6 text-center" />
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
