// The single source of truth for which order status transitions exist and who may perform
// them. Every status write in lib/orders/transition.ts goes through `assertTransition`.

import { PERMISSIONS, type Permission } from "@/lib/authorization/permissions";

export const ORDER_STATUSES = [
  "PENDING_APPROVAL",
  "CHANGE_REQUESTED",
  "CUSTOMER_CONFIRMATION_REQUIRED",
  "APPROVED",
  "QUEUED",
  "PREPARING",
  "READY",
  "SERVED",
  "REJECTED",
  "CANCELLED",
  "CANCEL_REQUESTED",
] as const;

export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

/** Who may trigger a transition: the owning customer, the system (outbox), or staff holding a permission. */
export type TransitionActor = "CUSTOMER" | "SYSTEM" | Permission;

interface Rule {
  from: OrderStatusValue;
  to: OrderStatusValue;
  actors: TransitionActor[];
  description: string;
}

const P = PERMISSIONS;

export const TRANSITION_RULES: Rule[] = [
  { from: "PENDING_APPROVAL", to: "APPROVED", actors: [P.ORDER_APPROVE], description: "Supervisor approves the current order version" },
  { from: "PENDING_APPROVAL", to: "REJECTED", actors: [P.ORDER_APPROVE], description: "Supervisor rejects with a reason" },
  { from: "PENDING_APPROVAL", to: "CHANGE_REQUESTED", actors: [P.ORDER_CHANGE], description: "Supervisor flags for clarification or starts a change proposal" },
  { from: "PENDING_APPROVAL", to: "CANCELLED", actors: ["CUSTOMER", P.ORDER_CANCEL], description: "Customer withdraws, or supervisor cancels" },
  { from: "CHANGE_REQUESTED", to: "PENDING_APPROVAL", actors: [P.ORDER_CHANGE], description: "Clarification resolved without changing the order" },
  { from: "CHANGE_REQUESTED", to: "CUSTOMER_CONFIRMATION_REQUIRED", actors: [P.ORDER_CHANGE], description: "Proposed change sent to the customer" },
  { from: "CUSTOMER_CONFIRMATION_REQUIRED", to: "PENDING_APPROVAL", actors: ["CUSTOMER", P.ORDER_CHANGE], description: "Customer accepts/declines, or supervisor withdraws the proposal" },
  { from: "APPROVED", to: "QUEUED", actors: ["SYSTEM"], description: "Outbox dispatcher created the kitchen ticket" },
  { from: "APPROVED", to: "CANCELLED", actors: [P.ORDER_CANCEL], description: "Cancelled before reaching the kitchen" },
  { from: "QUEUED", to: "PREPARING", actors: [P.KITCHEN_UPDATE], description: "Kitchen starts preparation" },
  { from: "QUEUED", to: "CANCELLED", actors: [P.ORDER_CANCEL], description: "Cancelled before preparation started" },
  { from: "PREPARING", to: "READY", actors: [P.KITCHEN_UPDATE], description: "Kitchen completes preparation" },
  { from: "PREPARING", to: "CANCEL_REQUESTED", actors: [P.ORDER_CANCEL], description: "Supervisor asks the kitchen to stop" },
  // Resolution of a cancel request (needed so CANCEL_REQUESTED is not a dead end).
  { from: "CANCEL_REQUESTED", to: "CANCELLED", actors: [P.KITCHEN_UPDATE, P.ORDER_CANCEL], description: "Kitchen confirms it stopped" },
  { from: "CANCEL_REQUESTED", to: "PREPARING", actors: [P.KITCHEN_UPDATE], description: "Too late to stop — preparation continues" },
  { from: "READY", to: "SERVED", actors: [P.ORDER_SERVE], description: "Staff serves the customer" },
];

export const TERMINAL_STATUSES: OrderStatusValue[] = ["SERVED", "REJECTED", "CANCELLED"];
/** Orders the kitchen may ever see. PENDING_* states are deliberately absent. */
export const KITCHEN_VISIBLE_STATUSES: OrderStatusValue[] = ["QUEUED", "PREPARING", "READY", "CANCEL_REQUESTED"];
/** Orders that count as accepted business (for billing and sales). */
export const ACCEPTED_STATUSES: OrderStatusValue[] = ["APPROVED", "QUEUED", "PREPARING", "READY", "SERVED", "CANCEL_REQUESTED"];
export const PRE_APPROVAL_STATUSES: OrderStatusValue[] = ["PENDING_APPROVAL", "CHANGE_REQUESTED", "CUSTOMER_CONFIRMATION_REQUIRED"];

export function findRule(from: OrderStatusValue, to: OrderStatusValue): Rule | undefined {
  return TRANSITION_RULES.find((r) => r.from === from && r.to === to);
}

export function canTransition(from: OrderStatusValue, to: OrderStatusValue): boolean {
  return Boolean(findRule(from, to));
}

export function allowedNextStatuses(from: OrderStatusValue): OrderStatusValue[] {
  return TRANSITION_RULES.filter((r) => r.from === from).map((r) => r.to);
}

export class TransitionError extends Error {
  constructor(
    public readonly code: "INVALID_TRANSITION" | "TRANSITION_FORBIDDEN",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Throws unless `from -> to` exists and the actor is allowed.
 * `actor` is "CUSTOMER", "SYSTEM", or the set of permissions held by a staff member.
 */
export function assertTransition(
  from: OrderStatusValue,
  to: OrderStatusValue,
  actor: "CUSTOMER" | "SYSTEM" | ReadonlySet<string>,
): Rule {
  const rule = findRule(from, to);
  if (!rule) throw new TransitionError("INVALID_TRANSITION", `Cannot move an order from ${from} to ${to}`);
  const allowed =
    typeof actor === "string" ? rule.actors.includes(actor) : rule.actors.some((a) => a !== "CUSTOMER" && a !== "SYSTEM" && actor.has(a));
  if (!allowed) throw new TransitionError("TRANSITION_FORBIDDEN", `Not allowed to move an order from ${from} to ${to}`);
  return rule;
}
