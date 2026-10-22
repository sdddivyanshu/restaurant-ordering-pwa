import { prisma } from "@/lib/db/prisma";
import { randomToken, sha256 } from "@/lib/security/tokens";
import { demoAccountsAllowed } from "@/lib/env";
import type { RoleKey } from "@/lib/authorization/permissions";

export const STAFF_SESSION_HOURS = 12;
const TOUCH_INTERVAL_MS = 60_000;

export interface StaffContext {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
  roleKey: RoleKey;
  roleName: string;
  permissions: Set<string>;
}

export async function createStaffSession(userId: string, userAgent?: string | null) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + STAFF_SESSION_HOURS * 3600_000);
  await prisma.staffSession.create({
    data: { userId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 200) ?? null },
  });
  return { token, expiresAt };
}

export async function revokeStaffSession(token: string) {
  await prisma.staffSession.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function resolveStaffSession(token: string | undefined | null): Promise<StaffContext | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.staffSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          extraPermissions: { include: { permission: true } },
        },
      },
    },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  const user = session.user;
  if (!user.isActive) return null;
  if (user.isDemo && !demoAccountsAllowed()) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    // Sliding expiry: keep active sessions alive, idle ones expire.
    await prisma.staffSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + STAFF_SESSION_HOURS * 3600_000) },
    });
  }

  const permissions = new Set<string>([
    ...user.role.permissions.map((rp) => rp.permission.key),
    ...user.extraPermissions.map((up) => up.permission.key),
  ]);
  return {
    userId: user.id,
    sessionId: session.id,
    name: user.name,
    email: user.email,
    roleKey: user.role.key as RoleKey,
    roleName: user.role.name,
    permissions,
  };
}
