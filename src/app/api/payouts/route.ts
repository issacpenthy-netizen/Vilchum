import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { rules } from "@/config";
import { payoutProviders } from "@/lib/providers";
const schema = z.object({ amount: z.number().int().min(rules.minimumCashout).max(10000000), method: z.enum(["ABA", "ACLEDA", "VISA"]), account: z.string().trim().min(6).max(64) });
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to view payouts." }, { status: 401 });
  const payouts = await db.payout.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, amount: true, method: true, status: true, createdAt: true } });
  return NextResponse.json({ payouts });
}
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to cash out." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the payout details and try again." }, { status: 400 });
  const payout = await db.$transaction(async (tx) => {
    const total = await tx.ledgerEntry.aggregate({ where: { userId: user.id }, _sum: { delta: true } });
    const balance = total._sum.delta ?? 0;
    if (parsed.data.amount > balance) return null;
    const created = await tx.payout.create({ data: { userId: user.id, ...parsed.data, status: "PROCESSING" } });
    await tx.ledgerEntry.create({ data: { userId: user.id, delta: -parsed.data.amount, type: "CASHOUT", refId: created.id } });
    return created;
  });
  if (!payout) return NextResponse.json({ error: "Your balance is too low for that amount. Choose a smaller amount." }, { status: 400 });
  try {
    const result = await payoutProviders[parsed.data.method].pay(payout.amount, payout.account);
    const paid = await db.$transaction(async (tx) => {
      await tx.payout.update({ where: { id: payout.id }, data: { status: "PAID", providerRef: result.providerRef } });
      return tx.payout.findUniqueOrThrow({ where: { id: payout.id }, select: { id: true, amount: true, method: true, status: true, providerRef: true } });
    });
    return NextResponse.json({ payout: paid });
  } catch {
    await db.$transaction(async (tx) => {
      await tx.payout.update({ where: { id: payout.id }, data: { status: "FAILED" } });
      await tx.ledgerEntry.create({ data: { userId: user.id, delta: payout.amount, type: "REFUND", refId: payout.id } });
    });
    return NextResponse.json({ error: "The payout could not be completed. Your points were refunded. Please try again." }, { status: 502 });
  }
}
