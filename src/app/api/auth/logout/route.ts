import { NextResponse } from "next/server";
export const POST = () => { const response = NextResponse.json({ ok: true }); response.cookies.delete("vilchum_session"); return response; };
