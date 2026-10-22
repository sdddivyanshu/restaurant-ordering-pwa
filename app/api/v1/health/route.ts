import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { outboxHealth } from "@/lib/kitchen/outbox";

export const dynamic = "force-dynamic";

/** Liveness + readiness: checks DB connectivity and reports outbox backlog (no sensitive data). */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const outbox = await outboxHealth();
    return NextResponse.json({ status: "ok", db: "ok", outbox, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
