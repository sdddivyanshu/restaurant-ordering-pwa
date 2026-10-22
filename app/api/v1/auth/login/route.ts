import { NextResponse } from "next/server";
import { publicRoute } from "@/lib/http/route";
import { loginSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { prisma } from "@/lib/db/prisma";
import { dummyVerify, verifyPassword } from "@/lib/auth/password";
import { createStaffSession, resolveStaffSession, STAFF_SESSION_HOURS } from "@/lib/auth/staff-session";
import { COOKIE_STAFF, setSecureCookie } from "@/lib/auth/cookies";
import { ApiError } from "@/lib/http/errors";
import { demoAccountsAllowed } from "@/lib/env";
import { homePathFor } from "@/lib/authorization/permissions";
import { audit } from "@/lib/audit";

const INVALID = () => new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

export const POST = publicRoute({ body: loginSchema, rateLimit: RATE_LIMITS.login }, async ({ body, req }) => {
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user) {
    await dummyVerify(body.password); // keep timing similar for unknown emails
    throw INVALID();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(423, "ACCOUNT_LOCKED", "Too many failed attempts. Try again in a few minutes.");
  }
  const ok = await verifyPassword(user.passwordHash, body.password);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: failed, lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    throw INVALID();
  }
  if (!user.isActive) throw new ApiError(403, "ACCOUNT_DISABLED", "This account is disabled.");
  if (user.isDemo && !demoAccountsAllowed()) throw new ApiError(403, "DEMO_DISABLED", "Demo accounts are disabled in production.");

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const { token } = await createStaffSession(user.id, req.headers.get("user-agent"));
  await prisma.$transaction((tx) => audit(tx, { actor: { type: "STAFF", id: user.id, label: user.name }, action: "auth.login", entityType: "User", entityId: user.id }));
  const staff = await resolveStaffSession(token);
  const res = NextResponse.json({
    user: { name: user.name, email: user.email, role: staff?.roleKey, permissions: [...(staff?.permissions ?? [])] },
    redirectTo: homePathFor(staff?.permissions ?? new Set()),
  });
  setSecureCookie(res, COOKIE_STAFF, token, STAFF_SESSION_HOURS * 3600);
  return res;
});
