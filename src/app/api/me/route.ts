import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { pickup, rules } from "@/config";
import { z } from "zod";

const addressSchema = z.object({
  city: z.literal(pickup.city),
  recipientName: z.string().trim().min(2).max(80),
  contactPhone: z.string().regex(/^\+855[0-9]{8,9}$/, "Enter a valid Cambodian contact number."),
  addressLine: z.string().trim().min(5).max(180),
  khan: z.enum(pickup.khans),
  sangkat: z.string().trim().min(2).max(90),
  landmark: z.string().trim().max(160),
});
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const entries = await db.ledgerEntry.aggregate({ where: { userId: user.id }, _sum: { delta: true } });
  const balance = entries._sum.delta ?? 0;
  return NextResponse.json({
    user: { id: user.id, phone: user.phone, email: user.email },
    pickupAddress: {
      city: pickup.city,
      recipientName: user.recipientName ?? "",
      contactPhone: user.contactPhone ?? user.phone ?? "",
      addressLine: user.addressLine ?? "",
      khan: user.khan ?? "",
      sangkat: user.sangkat ?? "",
      landmark: user.landmark ?? "",
    },
    balance,
    minimum: rules.minimumCashout,
    progress: Math.min(100, balance / rules.minimumCashout * 100),
  });
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to save your pickup address." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) {
    const cityError = parsed.error.issues.some((issue) => issue.path[0] === "city");
    return NextResponse.json({ error: cityError ? "Pickup service is currently available only in Phnom Penh." : parsed.error.issues[0]?.message ?? "Check the pickup details and try again." }, { status: 400 });
  }
  const address = await db.user.update({
    where: { id: user.id },
    data: {
      recipientName: parsed.data.recipientName,
      contactPhone: parsed.data.contactPhone,
      addressLine: parsed.data.addressLine,
      khan: parsed.data.khan,
      sangkat: parsed.data.sangkat,
      landmark: parsed.data.landmark || null,
    },
    select: { recipientName: true, contactPhone: true, addressLine: true, khan: true, sangkat: true, landmark: true },
  });
  return NextResponse.json({ pickupAddress: { ...address, city: pickup.city } });
}
