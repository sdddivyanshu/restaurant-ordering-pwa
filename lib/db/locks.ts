import type { Tx } from "@/lib/db/prisma";

/** Row-lock an order for the rest of the transaction (serialises concurrent staff actions). */
export async function lockOrder(tx: Tx, orderId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  return rows.length > 0;
}

export async function lockTable(tx: Tx, tableId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "RestaurantTable" WHERE id = ${tableId} FOR UPDATE`;
  return rows.length > 0;
}
