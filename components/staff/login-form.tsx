"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Button, ErrorNotice } from "@/components/shared/ui";

const DEMO = [
  ["Administrator", "admin@demo.restaurant.local"],
  ["Supervisor", "supervisor@demo.restaurant.local"],
  ["Kitchen", "kitchen@demo.restaurant.local"],
  ["Cashier", "cashier@demo.restaurant.local"],
  ["Service", "service@demo.restaurant.local"],
] as const;

export function LoginForm({ showDemoHint }: { showDemoHint: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ redirectTo: string }>("/api/v1/auth/login", { body: { email, password } });
      router.replace(res.redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 p-4">
      <div className="w-full max-w-sm space-y-4">
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow">
          <div>
            <h1 className="text-xl font-bold">Staff sign in</h1>
            <p className="text-sm text-slate-500">Supervisors, kitchen, cashier, service and admin.</p>
          </div>
          <label className="block text-sm font-semibold">
            Email
            <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 font-normal" />
          </label>
          <label className="block text-sm font-semibold">
            Password
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 font-normal" />
          </label>
          {error && <ErrorNotice message={error} />}
          <Button type="submit" variant="dark" className="w-full" loading={busy}>
            Sign in
          </Button>
        </form>
        {showDemoHint && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
            <p className="font-bold">Development demo accounts</p>
            <p className="mt-1">Password for all: <code className="font-mono">DemoPass2026!</code> (disabled in production)</p>
            <ul className="mt-2 space-y-1">
              {DEMO.map(([role, mail]) => (
                <li key={mail}>
                  <button type="button" className="underline" onClick={() => setEmail(mail)}>
                    {role}: {mail}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
