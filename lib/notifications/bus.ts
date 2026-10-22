import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// In-process pub/sub that feeds the SSE endpoints. Events are *hints* ("something changed,
// refetch"); the database stays the source of truth, so a missed event only delays the UI
// until the client's polling fallback refreshes. For multi-instance deployments swap this
// for Postgres LISTEN/NOTIFY or Redis (see docs/architecture.md).

export interface RealtimeEvent {
  id: string;
  type: string;
  at: string;
  data?: Record<string, unknown>;
}

const g = globalThis as unknown as { __realtimeBus?: EventEmitter };
const bus = g.__realtimeBus ?? new EventEmitter();
bus.setMaxListeners(1000);
g.__realtimeBus = bus;

export const topics = {
  staff: "staff",
  customerSession: (id: string) => `customer-session:${id}`,
  tableSession: (id: string) => `table-session:${id}`,
};

export function publish(topic: string, type: string, data?: Record<string, unknown>) {
  const event: RealtimeEvent = { id: randomUUID(), type, at: new Date().toISOString(), data };
  bus.emit(topic, event);
}

export function subscribe(topic: string, listener: (e: RealtimeEvent) => void): () => void {
  bus.on(topic, listener);
  return () => bus.off(topic, listener);
}

/** Notify staff dashboards and the owning customer that an order changed. */
export function publishOrderUpdate(order: { id: string; status: string; customerSessionId: string; tableSessionId: string }) {
  publish(topics.staff, "order.updated", { orderId: order.id, status: order.status });
  publish(topics.customerSession(order.customerSessionId), "order.updated", { orderId: order.id, status: order.status });
  publish(topics.tableSession(order.tableSessionId), "order.updated", { orderId: order.id, status: order.status });
}
