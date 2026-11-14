import { NextResponse } from "next/server";

// D2: live KHR-per-USD rate for a secondary, display-only USD line. It is never used in ledger
// arithmetic. Any failure returns { khrPerUsd: null } and the app hides the USD line.
// Only the currency pair is requested; no user data leaves the server.
const SOURCE = "https://open.er-api.com/v6/latest/USD";
const TTL_MS = 60 * 60 * 1000;
let cached: { khrPerUsd: number; fetchedAt: number } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return NextResponse.json({ khrPerUsd: cached.khrPerUsd, fetchedAt: new Date(cached.fetchedAt).toISOString() });
  try {
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!response.ok) throw new Error(`FX source returned ${response.status}`);
    const data: { result?: string; rates?: Record<string, number> } = await response.json();
    const rate = data.rates?.KHR;
    if (data.result !== "success" || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) throw new Error("FX source returned no KHR rate");
    cached = { khrPerUsd: rate, fetchedAt: Date.now() };
    return NextResponse.json({ khrPerUsd: rate, fetchedAt: new Date(cached.fetchedAt).toISOString() });
  } catch {
    return NextResponse.json({ khrPerUsd: null });
  }
}
