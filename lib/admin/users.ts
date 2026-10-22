import { prisma, withTx } from "@/lib/db/prisma";
import { badRequest, conflict, notFound } from "@/lib/http/errors";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { audit, type Actor } from "@/lib/audit";
import { ALL_PERMISSIONS, ROLE_LABELS, type RoleKey } from "@/lib/authorization/permissions";

export async function listUsers() {
  const users = await prisma.user.findMany({
    include: { role: true, extraPermissions: { include: { permission: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  // Never return password hashes.
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    roleKey: u.role.key,
    roleName: u.role.name,
    isActive: u.isActive,
    isDemo: u.isDemo,
    lastLoginAt: u.lastLoginAt,
    extraPermissions: u.extraPermissions.map((p) => p.permission.key),
  }));
}

export function roleOptions() {
  return Object.entries(ROLE_LABELS).map(([key, label]) => ({ key, label }));
}

export function permissionOptions() {
  return ALL_PERMISSIONS;
}

async function setExtraPermissions(tx: Parameters<Parameters<typeof withTx>[0]>[0], userId: string, keys: string[], grantedById: string) {
  const perms = await tx.permission.findMany({ where: { key: { in: keys } } });
  if (perms.length !== new Set(keys).size) throw badRequest("Unknown permission in extra grants");
  await tx.userPermission.deleteMany({ where: { userId } });
  for (const p of perms) await tx.userPermission.create({ data: { userId, permissionId: p.id, grantedById } });
}

export async function createUser(input: { email: string; name: string; roleKey: RoleKey; password: string; extraPermissions: string[] }, actor: Actor) {
  const weak = validatePasswordStrength(input.password);
  if (weak) throw badRequest(weak);
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw conflict("EMAIL_TAKEN", "A staff account with this email already exists.");
  const passwordHash = await hashPassword(input.password);
  return withTx(async (tx) => {
    const role = await tx.role.findUniqueOrThrow({ where: { key: input.roleKey } });
    const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, roleId: role.id } });
    if (input.extraPermissions.length) await setExtraPermissions(tx, user.id, input.extraPermissions, actor.id!);
    await audit(tx, { actor, action: "user.created", entityType: "User", entityId: user.id, after: { email: input.email, role: input.roleKey, extraPermissions: input.extraPermissions } });
    return { id: user.id };
  });
}

export async function updateUser(
  id: string,
  input: { name?: string; roleKey?: RoleKey; isActive?: boolean; password?: string; extraPermissions?: string[] },
  actor: Actor,
) {
  if (id === actor.id && (input.isActive === false || (input.roleKey && input.roleKey !== "ADMIN"))) {
    throw badRequest("You cannot deactivate or demote your own account.");
  }
  if (input.password) {
    const weak = validatePasswordStrength(input.password);
    if (weak) throw badRequest(weak);
  }
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  return withTx(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, include: { role: true } });
    if (!before) throw notFound("User not found");
    const role = input.roleKey ? await tx.role.findUniqueOrThrow({ where: { key: input.roleKey } }) : null;
    await tx.user.update({
      where: { id },
      data: {
        name: input.name,
        isActive: input.isActive,
        roleId: role?.id,
        ...(passwordHash && { passwordHash, failedLoginCount: 0, lockedUntil: null }),
      },
    });
    if (input.extraPermissions) await setExtraPermissions(tx, id, input.extraPermissions, actor.id!);
    // Role, status or password changes end existing sessions so new permissions apply immediately.
    if (input.isActive === false || passwordHash || role) {
      await tx.staffSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(tx, {
      actor,
      action: "user.updated",
      entityType: "User",
      entityId: id,
      before: { role: before.role.key, isActive: before.isActive },
      after: { role: input.roleKey, isActive: input.isActive, passwordReset: Boolean(passwordHash), extraPermissions: input.extraPermissions },
    });
  });
}
