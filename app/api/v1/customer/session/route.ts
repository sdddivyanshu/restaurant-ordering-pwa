import { NextResponse } from "next/server";
import { customerRoute, publicRoute } from "@/lib/http/route";
import { languageSchema, registerSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { getSessionInfo, registerCustomer, DEVICE_COOKIE_DAYS } from "@/lib/customers/service";
import { COOKIE_CUSTOMER, COOKIE_DEVICE, COOKIE_LANG, clearCookie, setSecureCookie } from "@/lib/auth/cookies";
import { prisma } from "@/lib/db/prisma";

/** GET — current customer session (masked phone only). */
export const GET = customerRoute({}, async ({ customer }) => getSessionInfo(customer));

/** POST — register name + mobile for this table visit (QR token re-validated server-side). */
export const POST = publicRoute({ body: registerSchema, rateLimit: RATE_LIMITS.register }, async ({ body, req }) => {
  const result = await registerCustomer(body, req.cookies.get(COOKIE_DEVICE)?.value);
  const res = NextResponse.json({ customer: result.customer, table: { label: result.table.label, name: result.table.name }, expiresAt: result.expiresAt }, { status: 201 });
  setSecureCookie(res, COOKIE_CUSTOMER, result.sessionToken, Math.max(60, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000)));
  setSecureCookie(res, COOKIE_DEVICE, result.deviceToken, DEVICE_COOKIE_DAYS * 86400);
  return res;
});

/** PATCH — persist language preference. */
export const PATCH = customerRoute({ body: languageSchema }, async ({ customer, body }) => {
  await prisma.customerSession.update({ where: { id: customer.sessionId }, data: { language: body.language } });
  const res = NextResponse.json({ language: body.language });
  res.cookies.set(COOKIE_LANG, body.language, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
  return res;
});

/** DELETE — end this customer session on this device. */
export const DELETE = customerRoute({}, async ({ customer }) => {
  await prisma.customerSession.update({ where: { id: customer.sessionId }, data: { revokedAt: new Date() } });
  const res = NextResponse.json({ ok: true });
  clearCookie(res, COOKIE_CUSTOMER);
  return res;
});
