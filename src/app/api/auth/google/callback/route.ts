import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sign } from "@/lib/auth";

const configSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  redirectUri: z.string().url(),
});
const callbackSchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});
const tokenSchema = z.object({ access_token: z.string().min(1) });
const profileSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean(),
});

function redirectWithError(request: NextRequest, code: "google" | "google_not_configured") {
  const configuredOrigin = z.string().url().safeParse(process.env.GOOGLE_REDIRECT_URI);
  const url = new URL("/", configuredOrigin.success ? configuredOrigin.data : request.url);
  url.searchParams.set("authError", code);
  const response = NextResponse.redirect(url);
  response.cookies.set("vilchum_google_state", "", { path: "/api/auth/google/callback", maxAge: 0 });
  response.cookies.set("vilchum_google_verifier", "", { path: "/api/auth/google/callback", maxAge: 0 });
  return response;
}

function matchesState(returned: string | undefined, expected: string | undefined) {
  if (!returned || !expected) return false;
  const left = Buffer.from(returned);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  const config = configSchema.safeParse({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });
  if (!config.success) return redirectWithError(request, "google_not_configured");

  const url = new URL(request.url);
  const params = callbackSchema.safeParse({
    code: url.searchParams.get("code") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    error: url.searchParams.get("error") ?? undefined,
  });
  if (!params.success || params.data.error || !matchesState(params.data.state, request.cookies.get("vilchum_google_state")?.value)) {
    return redirectWithError(request, "google");
  }
  const authorizationCode = params.data.code;
  const verifier = request.cookies.get("vilchum_google_verifier")?.value;
  if (!authorizationCode || !verifier) return redirectWithError(request, "google");

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: authorizationCode,
        client_id: config.data.clientId,
        client_secret: config.data.clientSecret,
        redirect_uri: config.data.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const token = tokenSchema.safeParse(await tokenResponse.json().catch(() => null));
    if (!tokenResponse.ok || !token.success) return redirectWithError(request, "google");

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.data.access_token}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const profile = profileSchema.safeParse(await profileResponse.json().catch(() => null));
    if (!profileResponse.ok || !profile.success || !profile.data.email_verified) {
      return redirectWithError(request, "google");
    }

    const { sub, email } = profile.data;
    let user = await db.user.findUnique({ where: { googleSub: sub } });
    if (user) {
      if (user.email !== email) user = await db.user.update({ where: { id: user.id }, data: { email } });
    } else {
      const emailUser = await db.user.findUnique({ where: { email } });
      if (emailUser) {
        if (emailUser.googleSub && emailUser.googleSub !== sub) return redirectWithError(request, "google");
        user = await db.user.update({ where: { id: emailUser.id }, data: { googleSub: sub } });
      } else {
        user = await db.user.create({ data: { email, googleSub: sub } });
      }
    }

    const response = NextResponse.redirect(new URL("/", config.data.redirectUri));
    response.cookies.set("vilchum_session", sign(user.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    response.cookies.set("vilchum_google_state", "", { path: "/api/auth/google/callback", maxAge: 0 });
    response.cookies.set("vilchum_google_verifier", "", { path: "/api/auth/google/callback", maxAge: 0 });
    return response;
  } catch (error) {
    console.error("Google OAuth callback failed:", error instanceof Error ? error.message : "Unknown error");
    return redirectWithError(request, "google");
  }
}
