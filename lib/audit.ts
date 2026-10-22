import type { Tx } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

export type Actor =
  | { type: "STAFF"; id: string; label?: string }
  | { type: "CUSTOMER"; id: string; label?: string }
  | { type: "SYSTEM"; id?: null; label?: string };

export const SYSTEM_ACTOR: Actor = { type: "SYSTEM", label: "system" };

const REDACT_KEYS = new Set(["password", "passwordHash", "otp", "otpHash", "token", "tokenHash", "phoneE164", "phone"]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = REDACT_KEYS.has(k) ? "[redacted]" : redact(v);
    return out;
  }
  return value;
}

export async function audit(
  tx: Tx,
  entry: {
    actor: Actor;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    meta?: unknown;
  },
) {
  await tx.auditLog.create({
    data: {
      actorType: entry.actor.type,
      actorId: entry.actor.id ?? null,
      actorLabel: entry.actor.label ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before === undefined ? undefined : (redact(entry.before) as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (redact(entry.after) as Prisma.InputJsonValue),
      meta: entry.meta === undefined ? undefined : (redact(entry.meta) as Prisma.InputJsonValue),
    },
  });
}
