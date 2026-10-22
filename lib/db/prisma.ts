import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // Keep the pool modest; a managed Postgres or PgBouncer should front production traffic.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.__prisma ?? createClient();
// Reuse a single client across hot reloads and across route bundles in one process.
globalForPrisma.__prisma = prisma;

export type Tx = Prisma.TransactionClient;

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Run a transaction, retrying on serialization failures / deadlocks. */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, opts?: { retries?: number }): Promise<T> {
  const retries = opts?.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { maxWait: 10_000, timeout: 20_000 });
    } catch (err) {
      const retryable =
        err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2034" || err.code === "40001");
      if (!retryable || attempt >= retries) throw err;
    }
  }
}
