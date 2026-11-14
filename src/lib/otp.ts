import { randomInt } from "node:crypto";
import { demoOtpEnabled } from "@/lib/env";
const codes = new Map<string, { code: string; expires: number }>();
export function sendOtp(phone: string) {
  const code = demoOtpEnabled() ? "123456" : String(randomInt(100000, 1000000));
  codes.set(phone, { code, expires: Date.now() + 5 * 60_000 });
  if (process.env.NODE_ENV !== "production") console.info(`[VilChum demo OTP] ${phone}: ${code}`);
  // TODO: connect an SMS provider here when available.
}
export function verifyOtp(phone: string, code: string) {
  const saved = codes.get(phone);
  // The fixed demo code is ignored in production even if DEV_OTP is set (startup also refuses it).
  if (demoOtpEnabled() && code === "123456") return true;
  return !!saved && saved.code === code && saved.expires > Date.now();
}
