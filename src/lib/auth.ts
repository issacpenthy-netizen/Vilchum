import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";

const secret = process.env.SESSION_SECRET ?? "vilchum-local-session-secret-change-before-deploy";
export function sign(id: string) { return `${id}.${createHmac("sha256", secret).update(id).digest("hex")}`; }
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
