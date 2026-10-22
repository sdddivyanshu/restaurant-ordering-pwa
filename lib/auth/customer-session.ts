import { prisma } from "@/lib/db/prisma";
import { sha256 } from "@/lib/security/tokens";

export interface CustomerContext {
  sessionId: string;
  customerId: string;
  customerName: string;
  tableSessionId: string;
  tableId: string;
  tableLabel: string;
  tableName: string;
  deviceId: string | null;
  verified: boolean;
  language: string;
  expiresAt: Date;
}

export type CustomerSessionProblem = "NO_SESSION" | "SESSION_EXPIRED" | "TABLE_CLOSED";

export async function resolveCustomerSession(
  token: string | undefined | null,
): Promise<{ ok: true; ctx: CustomerContext } | { ok: false; problem: CustomerSessionProblem }> {
  if (!token || token.length > 200) return { ok: false, problem: "NO_SESSION" };
  const session = await prisma.customerSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { customer: true, tableSession: { include: { table: true } } },
  });
  if (!session || session.revokedAt) return { ok: false, problem: "NO_SESSION" };
  const now = new Date();
  if (session.expiresAt <= now || session.customer.anonymizedAt) return { ok: false, problem: "SESSION_EXPIRED" };
  const ts = session.tableSession;
  if (ts.status !== "OPEN" || ts.expiresAt <= now || !ts.table.isActive || ts.table.archivedAt) {
    return { ok: false, problem: "TABLE_CLOSED" };
  }
  return {
    ok: true,
    ctx: {
      sessionId: session.id,
      customerId: session.customerId,
      customerName: session.customer.name,
      tableSessionId: ts.id,
      tableId: ts.tableId,
      tableLabel: ts.table.label,
      tableName: ts.table.name,
      deviceId: session.deviceId,
      verified: Boolean(session.verifiedAt),
      language: session.language,
      expiresAt: session.expiresAt,
    },
  };
}

/**
 * Orders this session may see: everything the customer placed if the phone number is verified,
 * otherwise only orders placed from this device. Typing someone else's number never reveals
 * their history.
 */
export function orderVisibilityFilter(ctx: CustomerContext) {
  if (ctx.verified) return { customerId: ctx.customerId };
  if (ctx.deviceId) return { customerId: ctx.customerId, deviceId: ctx.deviceId };
  return { customerId: ctx.customerId, customerSessionId: ctx.sessionId };
}
