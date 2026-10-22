import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/http/route";
import { COOKIE_STAFF, clearCookie } from "@/lib/auth/cookies";
import { revokeStaffSession } from "@/lib/auth/staff-session";

export const POST = publicRoute({}, async ({ req }) => {
  const token = req.cookies.get(COOKIE_STAFF)?.value;
  if (token) await revokeStaffSession(token);
  const res = NextResponse.json({ ok: true });
  clearCookie(res, COOKIE_STAFF);
  return res;
});
