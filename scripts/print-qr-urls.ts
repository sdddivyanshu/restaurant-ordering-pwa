// Prints every active table's QR URL and writes print-ready PNGs to ./qr-codes/.
// Run: npm run qr:print   (set APP_BASE_URL to your LAN address so phones can reach it)
import "./load-env";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/db/prisma";
import { qrPng, qrUrlFor } from "../lib/tables/service";

async function main() {
  const tables = await prisma.restaurantTable.findMany({ where: { archivedAt: null, isActive: true, qrToken: { not: null } }, orderBy: { displayOrder: "asc" } });
  const dir = path.join(process.cwd(), "qr-codes");
  mkdirSync(dir, { recursive: true });
  for (const t of tables) {
    writeFileSync(path.join(dir, `${t.label}.png`), await qrPng(t.qrToken!, 800));
    console.log(`${t.label.padEnd(4)} ${qrUrlFor(t.qrToken!)}`);
  }
  console.log(`\nWrote ${tables.length} PNG files to ${dir}`);
}

main().finally(() => prisma.$disconnect());
