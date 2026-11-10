import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
const schema = z.object({ password: z.string().min(1), action: z.enum(["APPROVE", "REJECT", "PAID"]), id: z.string().min(1) });
const passwordSchema = z.string().min(1);
export async function GET(request: Request) {
  const password = passwordSchema.safeParse(request.headers.get("x-admin-password"));
  if (!password.success || !process.env.ADMIN_PASSWORD || password.data !== process.env.ADMIN_PASSWORD) return NextResponse.json({ error: "Admin password required." }, { status: 401 });
  const [scans, payouts] = await Promise.all([db.scan.findMany({ include: { user: { select: { phone: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 100 }), db.payout.findMany({ include: { user: { select: { phone: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 100 })]);
  return NextResponse.json({ scans, payouts });
}
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check the admin action and try again." }, { status: 400 });
  if (!process.env.ADMIN_PASSWORD || parsed.data.password !== process.env.ADMIN_PASSWORD) return NextResponse.json({ error: "Admin password required." }, { status: 401 });
  const { action, id } = parsed.data;
  if (action === "PAID") {
    const payout = await db.payout.findUnique({ where: { id } });
    if (!payout) return NextResponse.json({ error: "That payout could not be found. Refresh the list and try again." }, { status: 404 });
    const settled = await db.$transaction(async (tx) => {
      const current = await tx.payout.findUniqueOrThrow({ where: { id } });
      if (current.status === "PAID") return true;
      if (current.status === "FAILED") {
        const total = await tx.ledgerEntry.aggregate({ where: { userId: current.userId }, _sum: { delta: true } });
        if ((total._sum.delta ?? 0) < current.amount) return false;
        await tx.ledgerEntry.create({ data: { userId: current.userId, delta: -current.amount, type: "CASHOUT", refId: current.id } });
      }
      await tx.payout.update({ where: { id }, data: { status: "PAID" } });
      return true;
    });
    if (!settled) return NextResponse.json({ error: "The user has spent the refunded points. The payout cannot be marked paid." }, { status: 409 });
  } else {
    const found = await db.$transaction(async (tx) => {
      const scan = await tx.scan.findUnique({ where: { id } });
      if (!scan) return false;
      const nextStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
      if (scan.status === nextStatus) return true;
      await tx.scan.update({ where: { id }, data: { status: nextStatus, reason: action === "REJECT" ? "Reviewed by VilChum team." : null } });
      if (action === "APPROVE") await tx.ledgerEntry.create({ data: { userId: scan.userId, delta: scan.points, type: "SCAN", refId: scan.id } });
      else if (scan.status === "APPROVED") await tx.ledgerEntry.create({ data: { userId: scan.userId, delta: -scan.points, type: "REFUND", refId: scan.id } });
      return true;
    });
    if (!found) return NextResponse.json({ error: "That scan could not be found. Refresh the list and try again." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
