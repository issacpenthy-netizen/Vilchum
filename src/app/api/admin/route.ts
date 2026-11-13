import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifiedPoints } from "@/lib/money";
import { publicReceipt, recordTransition } from "@/lib/ledger";

// Every money action carries the amount the admin confirmed on screen. The server recomputes it
// and refuses a mismatch, so the credited or settled amount is exactly what was confirmed.
const count = z.number().int().min(0).max(5000);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("VERIFY"), id: z.string().min(1), cans: count, bottles: count, confirmedPoints: z.number().int().min(0) }),
  z.object({ action: z.literal("REJECT"), id: z.string().min(1), reason: z.string().trim().max(160).optional() }),
  z.object({ action: z.literal("PAID"), id: z.string().min(1), confirmedAmount: z.number().int().min(1), providerRef: z.string().trim().max(80).optional() }),
  z.object({ action: z.literal("FAILED"), id: z.string().min(1), confirmedAmount: z.number().int().min(1) }),
]);

class ActionError extends Error { constructor(message: string, readonly status: number) { super(message); } }

function authorized(password: string | null | undefined) {
  return Boolean(process.env.ADMIN_PASSWORD) && password === process.env.ADMIN_PASSWORD;
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("x-admin-password"))) return NextResponse.json({ error: "Admin password required." }, { status: 401 });
  const userFields = { select: { phone: true, email: true, recipientName: true, contactPhone: true, addressLine: true, khan: true, sangkat: true, landmark: true } };
  const [scans, payouts] = await Promise.all([
    db.scan.findMany({ include: { user: userFields }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.payout.findMany({ include: { user: { select: { phone: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return NextResponse.json({ scans, payouts });
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const password = typeof body === "object" && body && "password" in body ? String((body as { password: unknown }).password) : null;
  if (!authorized(password)) return NextResponse.json({ error: "Admin password required." }, { status: 401 });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the admin action and try again." }, { status: 400 });
  const input = parsed.data;
  try {
    const receipt = await db.$transaction(async (tx) => {
      if (input.action === "VERIFY" || input.action === "REJECT") {
        const scan = await tx.scan.findUnique({ where: { id: input.id } });
        if (!scan) throw new ActionError("That scan could not be found. Refresh the list and try again.", 404);
        if (scan.status !== "ESTIMATED") throw new ActionError(`This scan is already ${scan.status.toLowerCase()}. Refresh the list.`, 409);
        if (input.action === "REJECT") {
          await tx.scan.update({ where: { id: scan.id }, data: { status: "REJECTED", reason: input.reason || "Items not found at pickup." } });
          return null;
        }
        const points = verifiedPoints(input.cans, input.bottles);
        if (points !== input.confirmedPoints) throw new ActionError("The counted amount changed. Review the counts and confirm again.", 409);
        const claimed = await tx.scan.updateMany({ where: { id: scan.id, status: "ESTIMATED" }, data: { status: "VERIFIED", verifiedCans: input.cans, verifiedBottles: input.bottles, verifiedPoints: points, verifiedAt: new Date() } });
        if (claimed.count !== 1) throw new ActionError("This scan was just verified by someone else. Refresh the list.", 409);
        return recordTransition(tx, {
          userId: scan.userId, kind: "SCAN_VERIFIED", amount: points, delta: points, refId: scan.id,
          details: { cans: input.cans, bottles: input.bottles, estimatedCans: scan.cans, estimatedBottles: scan.bottles, estimatedPoints: scan.estimatedPoints },
        });
      }
      const payout = await tx.payout.findUnique({ where: { id: input.id } });
      if (!payout) throw new ActionError("That payout could not be found. Refresh the list and try again.", 404);
      if (payout.status !== "REQUESTED") throw new ActionError(`This payout is already ${payout.status.toLowerCase()}. Refresh the list.`, 409);
      if (payout.amount !== input.confirmedAmount) throw new ActionError("The payout amount does not match what you confirmed. Refresh the list.", 409);
      const nextStatus = input.action === "PAID" ? "PAID" : "FAILED";
      const providerRef = input.action === "PAID" ? input.providerRef || null : null;
      const claimed = await tx.payout.updateMany({ where: { id: payout.id, status: "REQUESTED" }, data: { status: nextStatus, providerRef } });
      if (claimed.count !== 1) throw new ActionError("This payout was just updated by someone else. Refresh the list.", 409);
      const accountLast4 = payout.account.replace(/\s/g, "").slice(-4);
      return input.action === "PAID"
        ? recordTransition(tx, { userId: payout.userId, kind: "CASHOUT_PAID", amount: payout.amount, delta: 0, refId: payout.id, details: { method: payout.method, accountLast4, providerRef, status: "PAID" } })
        : recordTransition(tx, { userId: payout.userId, kind: "CASHOUT_REFUNDED", amount: payout.amount, delta: payout.amount, refId: payout.id, details: { method: payout.method, accountLast4, status: "FAILED" } });
    });
    return NextResponse.json({ ok: true, receipt: receipt ? publicReceipt(receipt) : null });
  } catch (error) {
    if (error instanceof ActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof RangeError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "That action could not be completed. Try again." }, { status: 500 });
  }
}
