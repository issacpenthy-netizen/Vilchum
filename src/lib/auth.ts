import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { sessionSecret } from "@/lib/env";

// No built-in fallback: without SESSION_SECRET signing fails instead of using a secret anyone can read in the repo.
export function sign(id: string) { return `${id}.${createHmac("sha256", sessionSecret()).update(id).digest("hex")}`; }
export function verify(token: string | undefined) {
  if (!token) return null;
  const [id, signature] = token.split(".");
  if (!id || !signature || sign(id) !== token) return null;
  return id;
}
export async function currentUser() {
  const jar = await cookies();
  const id = verify(jar.get("vilchum_session")?.value);
  return id ? db.user.findUnique({ where: { id } }) : null;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}
