import { NextResponse } from "next/server";
import { z } from "zod";
import { sendOtp } from "@/lib/otp";
const schema = z.object({ phone: z.string().regex(/^\+855[0-9]{8,9}$/, "Enter a valid Cambodian phone number.") });
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the phone number and try again." }, { status: 400 });
  sendOtp(parsed.data.phone);
  return NextResponse.json({ ok: true });
}
