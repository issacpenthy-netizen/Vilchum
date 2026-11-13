import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { MIN_CASHOUT, cashoutQuote } from "@/lib/money";
import { balanceOf, publicReceipt, recordTransition } from "@/lib/ledger";

// D3: the cash-out rail is stubbed in v1. A confirmed request debits the balance and issues a
// receipt; the VilChum team pays it manually and marks it PAID (or FAILED, which refunds) in /admin.
const schema = z.object({
  amount: z.number().int().min(MIN_CASHOUT, `The minimum cash-out is ${MIN_CASHOUT.toLocaleString("en-US")}៛.`).max(10000000),
  method: z.enum(["ABA", "ACLEDA", "VISA"]),
  account: z.string().trim().min(6).max(64),
  confirmed: z.literal(true, "Confirm the cash-out details first."),
});

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
  const { amount, method, account } = parsed.data;
  const quote = cashoutQuote(amount);
  const result = await db.$transaction(async (tx) => {
    if (amount > await balanceOf(tx, user.id)) return null;
    const payout = await tx.payout.create({ data: { userId: user.id, amount, method, account, status: "REQUESTED" } });
    const receipt = await recordTransition(tx, {
      userId: user.id, kind: "CASHOUT_REQUESTED", amount, delta: -amount, refId: payout.id,
      details: { method, accountLast4: account.replace(/\s/g, "").slice(-4), fee: quote.fee, receive: quote.receive, status: "REQUESTED" },
    });
    return { payout, receipt };
  });
  if (!result) return NextResponse.json({ error: "Your balance is too low for that amount. Choose a smaller amount." }, { status: 400 });
  return NextResponse.json({
    payout: { id: result.payout.id, amount: result.payout.amount, method: result.payout.method, status: result.payout.status },
    receipt: publicReceipt(result.receipt),
  });
}
