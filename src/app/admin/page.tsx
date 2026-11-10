"use client";

import { useState } from "react";

type AdminData = {
  scans: { id: string; user: { phone: string | null; email: string | null }; cans: number; bottles: number; points: number; status: string; reason: string | null; createdAt: string }[];
  payouts: { id: string; user: { phone: string | null; email: string | null }; amount: number; method: string; status: string; providerRef: string | null }[];
};

export default function Admin() {
  const [password, setPassword] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin", { headers: { "x-admin-password": password } });
      const result: AdminData | { error: string } = await response.json();
      if (!response.ok || "error" in result) throw new Error("error" in result ? result.error : "Could not load admin records.");
      setData(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load records. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function act(action: "APPROVE" | "REJECT" | "PAID", id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, action, id }) });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "That action could not be completed.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this record. Try again."); }
    finally { setBusy(false); }
  }

  return <main className="admin-shell">
    <h1>VilChum admin</h1>
    <p>Local demo review queue</p>
    <form onSubmit={(event) => { event.preventDefault(); void load(); }} className="admin-login">
      <input type="password" autoComplete="current-password" placeholder="Admin password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <button type="submit" disabled={busy || !password}>{busy ? "Loading…" : "Load records"}</button>
    </form>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {data && <>
      <h2>Scans</h2>
      {data.scans.length === 0 && <p>No scans yet.</p>}
      {data.scans.map((scan) => <article className="admin-record" key={scan.id}>
        <div><strong>{scan.user.phone ?? scan.user.email ?? "Google user"}</strong><span>{scan.cans} cans · {scan.bottles} bottles · {scan.points}៛</span><small>{new Date(scan.createdAt).toLocaleString()} · {scan.status}{scan.reason ? ` · ${scan.reason}` : ""}</small></div>
        <div className="admin-actions">{scan.status !== "APPROVED" && <button disabled={busy} onClick={() => void act("APPROVE", scan.id)}>Approve</button>}{scan.status !== "REJECTED" && <button disabled={busy} onClick={() => void act("REJECT", scan.id)}>Reject</button>}</div>
      </article>)}
      <h2>Payouts</h2>
      {data.payouts.length === 0 && <p>No payouts yet.</p>}
      {data.payouts.map((payout) => <article className="admin-record" key={payout.id}>
        <div><strong>{payout.user.phone ?? payout.user.email ?? "Google user"}</strong><span>{payout.amount}៛ · {payout.method} · {payout.status}</span><small>{payout.providerRef ?? "No provider reference yet"}</small></div>
        {payout.status !== "PAID" && <button disabled={busy} onClick={() => void act("PAID", payout.id)}>Mark paid</button>}
      </article>)}
    </>}
  </main>;
}
