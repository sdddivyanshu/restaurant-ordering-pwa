// Production bootstrap (idempotent, non-destructive): roles & permissions, restaurant record with
// default settings + GST 5%, and the first administrator.
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long-unique-password' RESTAURANT_NAME='My Restaurant' npm run bootstrap
import "./load-env";
import { prisma } from "../lib/db/prisma";
import { hashPassword, validatePasswordStrength } from "../lib/auth/password";
import { ALL_PERMISSIONS, ROLE_KEYS, ROLE_LABELS, ROLE_PERMISSIONS } from "../lib/authorization/permissions";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD");
  const weak = validatePasswordStrength(password);
  if (weak) throw new Error(weak);

  for (const key of ALL_PERMISSIONS) await prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
  for (const key of ROLE_KEYS) {
    const role = await prisma.role.upsert({ where: { key }, create: { key, name: ROLE_LABELS[key] }, update: { name: ROLE_LABELS[key] } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ROLE_PERMISSIONS[key] } } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })), skipDuplicates: true });
  }

  let restaurant = await prisma.restaurant.findFirst();
  if (!restaurant) {
    restaurant = await prisma.restaurant.create({ data: { name: process.env.RESTAURANT_NAME ?? "My Restaurant", settings: { create: {} } } });
    await prisma.taxConfiguration.create({
      data: { restaurantId: restaurant.id, code: "GST5", name: "GST 5%", rateBps: 500, components: [{ name: "CGST", rateBps: 250 }, { name: "SGST", rateBps: 250 }], isDefault: true },
    });
    console.log(`Created restaurant "${restaurant.name}" — review tax settings in Admin → Settings & tax.`);
  }

  const admin = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
  if (await prisma.user.findUnique({ where: { email } })) console.log(`User ${email} already exists — unchanged.`);
  else {
    await prisma.user.create({ data: { email, name: "Administrator", roleId: admin.id, passwordHash: await hashPassword(password) } });
    console.log(`Created administrator ${email}.`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
