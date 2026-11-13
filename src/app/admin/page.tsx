"use client";

import { useState } from "react";
import { POINTS_PER_ITEM, verifiedPoints } from "@/lib/money";

type Person = { phone: string | null; email: string | null };
type AdminScan = { id: string; user: Person & { recipientName: string | null; contactPhone: string | null; addressLine: string | null; khan: string | null; sangkat: string | null; landmark: string | null }; cans: number; bottles: number; estimatedPoints: number; verifiedCans: number | null; verifiedBottles: number | null; verifiedPoints: number | null; status: string; reason: string | null; createdAt: string };
type AdminPayout = { id: string; user: Person; amount: number; method: string; account: string; status: string; providerRef: string | null; createdAt: string };
type AdminData = { scans: AdminScan[]; payouts: AdminPayout[] };
type Pending =
  | { action: "VERIFY"; id: string; cans: number; bottles: number; points: number; who: string }
  | { action: "REJECT"; id: string; who: string }
  | { action: "PAID"; id: string; amount: number; providerRef: string; who: string }
  | { action: "FAILED"; id: string; amount: number; who: string };

const money = (value: number) => new Intl.NumberFormat("en-US").format(value);
const who = (user: Person) => user.phone ?? user.email ?? "Google user";
const wholeCount = (text: string) => /^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : null;

export default function Admin() {
  const [password, setPassword] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, { cans: string; bottles: string }>>({});
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);

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

  function review(scan: AdminScan) {
    const entry = counts[scan.id] ?? { cans: "", bottles: "" };
    const cans = wholeCount(entry.cans), bottles = wholeCount(entry.bottles);
    if (cans === null || bottles === null) { setError("Enter the counted cans and bottles as whole numbers (0 if none)."); return; }
    setError(""); setNotice("");
    setPending({ action: "VERIFY", id: scan.id, cans, bottles, points: verifiedPoints(cans, bottles), who: who(scan.user) });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true); setError(""); setNotice("");
    const body = pending.action === "VERIFY" ? { action: "VERIFY", id: pending.id, cans: pending.cans, bottles: pending.bottles, confirmedPoints: pending.points }
      : pending.action === "REJECT" ? { action: "REJECT", id: pending.id }
      : pending.action === "PAID" ? { action: "PAID", id: pending.id, confirmedAmount: pending.amount, providerRef: pending.providerRef || undefined }
      : { action: "FAILED", id: pending.id, confirmedAmount: pending.amount };
    try {
      const response = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, ...body }) });
      const result: { error?: string; receipt?: { number: string } | null } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "That action could not be completed.");
      setNotice(result.receipt ? `Done. Receipt ${result.receipt.number} issued to ${pending.who}.` : "Done. No money moved, so no receipt was issued.");
      setPending(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this record. Try again."); }
    finally { setBusy(false); }
  }

  function confirmText(item: Pending) {
    if (item.action === "VERIFY") return `Credit ${money(item.points)}៛ to ${item.who}: ${item.cans} cans × ${POINTS_PER_ITEM.cans} + ${item.bottles} bottles × ${POINTS_PER_ITEM.bottles}. This becomes spendable balance and issues a receipt.`;
    if (item.action === "REJECT") return `Reject this pickup for ${item.who}. No points are credited.`;
    if (item.action === "PAID") return `Mark ${money(item.amount)}៛ as paid to ${item.who}${item.providerRef ? ` (bank ref ${item.providerRef})` : ""}. Only do this after the bank transfer has gone through. Issues a receipt.`;
    return `Mark ${money(item.amount)}៛ as failed for ${item.who} and refund it to their balance. Issues a receipt.`;
  }

  const confirmBox = (id: string) => pending?.id === id && <div className="admin-confirm" role="alertdialog" aria-label="Confirm action">
    <p>{confirmText(pending)}</p>
    <div className="admin-actions"><button disabled={busy} onClick={() => void confirm()}>{busy ? "Saving…" : "Confirm"}</button><button disabled={busy} onClick={() => setPending(null)}>Cancel</button></div>
  </div>;

  const estimated = data?.scans.filter((scan) => scan.status === "ESTIMATED") ?? [];
  const settledScans = data?.scans.filter((scan) => scan.status !== "ESTIMATED") ?? [];

  return <main className="admin-shell">
    <h1>VilChum admin</h1>
    <p>Driver verification and manual cash-outs (v1)</p>
    <form onSubmit={(event) => { event.preventDefault(); void load(); }} className="admin-login">
      <input type="password" autoComplete="current-password" placeholder="Admin password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <button type="submit" disabled={busy || !password}>{busy ? "Loading…" : "Load records"}</button>
    </form>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {notice && <p className="admin-notice" role="status">{notice}</p>}
    {data && <>
      <h2>Pickups to verify</h2>
      {estimated.length === 0 && <p>No pickups waiting for a count.</p>}
      {estimated.map((scan) => <article className="admin-record" key={scan.id}>
        <div><strong>{scan.user.recipientName ?? who(scan.user)}</strong>
          <span>Photo estimate: ≈ {scan.cans} cans · ≈ {scan.bottles} bottles · ≈ {money(scan.estimatedPoints)}៛</span>
          <span className="admin-address">{[scan.user.addressLine, scan.user.sangkat, scan.user.khan, scan.user.landmark].filter(Boolean).join(", ") || "No pickup address saved"}{scan.user.contactPhone ? ` · ${scan.user.contactPhone}` : ""}</span>
          <small>{new Date(scan.createdAt).toLocaleString()} · {who(scan.user)}</small></div>
        <div className="admin-verify">
          <input inputMode="numeric" aria-label="Counted cans" placeholder="Cans" value={counts[scan.id]?.cans ?? ""} onChange={(event) => setCounts({ ...counts, [scan.id]: { cans: event.target.value.replace(/\D/g, ""), bottles: counts[scan.id]?.bottles ?? "" } })}/>
          <input inputMode="numeric" aria-label="Counted bottles" placeholder="Bottles" value={counts[scan.id]?.bottles ?? ""} onChange={(event) => setCounts({ ...counts, [scan.id]: { cans: counts[scan.id]?.cans ?? "", bottles: event.target.value.replace(/\D/g, "") } })}/>
          <div className="admin-actions"><button disabled={busy} onClick={() => review(scan)}>Review credit</button><button disabled={busy} onClick={() => { setError(""); setNotice(""); setPending({ action: "REJECT", id: scan.id, who: who(scan.user) }); }}>Reject</button></div>
          {confirmBox(scan.id)}
        </div>
      </article>)}
      <h2>Payouts</h2>
      {data.payouts.length === 0 && <p>No payouts yet.</p>}
      {data.payouts.map((payout) => <article className="admin-record" key={payout.id}>
        <div><strong>{who(payout.user)}</strong><span>{money(payout.amount)}៛ · {payout.method} · account {payout.account} · {payout.status}</span><small>{new Date(payout.createdAt).toLocaleString()}{payout.providerRef ? ` · bank ref ${payout.providerRef}` : ""}</small></div>
        {payout.status === "REQUESTED" && <div className="admin-verify">
          <input className="admin-wide" aria-label="Bank reference" placeholder="Bank ref (optional)" value={refs[payout.id] ?? ""} onChange={(event) => setRefs({ ...refs, [payout.id]: event.target.value.slice(0, 80) })}/>
          <div className="admin-actions"><button disabled={busy} onClick={() => { setError(""); setNotice(""); setPending({ action: "PAID", id: payout.id, amount: payout.amount, providerRef: (refs[payout.id] ?? "").trim(), who: who(payout.user) }); }}>Mark paid</button><button disabled={busy} onClick={() => { setError(""); setNotice(""); setPending({ action: "FAILED", id: payout.id, amount: payout.amount, who: who(payout.user) }); }}>Mark failed &amp; refund</button></div>
          {confirmBox(payout.id)}
        </div>}
      </article>)}
      <h2>Verified and rejected</h2>
      {settledScans.length === 0 && <p>Nothing yet.</p>}
      {settledScans.map((scan) => <article className="admin-record" key={scan.id}>
        <div><strong>{who(scan.user)}</strong><span>{scan.status === "VERIFIED" ? `Counted ${scan.verifiedCans} cans · ${scan.verifiedBottles} bottles · +${money(scan.verifiedPoints ?? 0)}៛` : `Estimate ≈ ${scan.cans} cans · ≈ ${scan.bottles} bottles`}</span><small>{new Date(scan.createdAt).toLocaleString()} · {scan.status}{scan.reason ? ` · ${scan.reason}` : ""}</small></div>
      </article>)}
    </>}
  </main>;
}
