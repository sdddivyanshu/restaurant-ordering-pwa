# Order state machine

Source of truth: [`lib/orders/state-machine.ts`](../lib/orders/state-machine.ts). The only writer of
`Order.status` is `transitionOrder()` in [`lib/orders/transition.ts`](../lib/orders/transition.ts), which:

1. checks the transition exists **and** the actor is allowed (customer / system / staff permission);
2. performs a compare-and-set `UPDATE … WHERE id = ? AND status = ? AND lockVersion = ?` — a concurrent
   actor gets `409 CONCURRENT_UPDATE` instead of a conflicting state;
3. appends `OrderStatusHistory`, a customer `NotificationEvent` and an `AuditLog` row in the same transaction.

```
                      customer submits
                             │
                             ▼
   ┌──────────────── PENDING_APPROVAL ◄──────────────┐
   │   flag / propose │      │ approve      ▲        │ customer accepts/declines,
   │                  ▼      │              │        │ or staff withdraws
   │          CHANGE_REQUESTED ───────► CUSTOMER_CONFIRMATION_REQUIRED
   │           (clarification)  propose
   │ reject / cancel         ▼
   ▼                     APPROVED ──(outbox dispatcher, SYSTEM only)──► QUEUED
REJECTED / CANCELLED        │ cancel                                       │ cancel → CANCELLED
                            ▼                                     start    ▼
                        CANCELLED                                     PREPARING ──cancel──► CANCEL_REQUESTED
                                                                          │ ready              │ confirm → CANCELLED
                                                                          ▼                    │ continue → PREPARING
                                                                        READY ──serve──► SERVED
```

| From | To | Who |
|---|---|---|
| PENDING_APPROVAL | APPROVED | `order.approve` (supervisor, admin, or an explicitly granted user) |
| PENDING_APPROVAL | REJECTED | `order.approve` — reason required |
| PENDING_APPROVAL | CHANGE_REQUESTED | `order.change` |
| PENDING_APPROVAL | CANCELLED | the owning customer, or `order.cancel` |
| CHANGE_REQUESTED | PENDING_APPROVAL | `order.change` (clarification resolved) |
| CHANGE_REQUESTED | CUSTOMER_CONFIRMATION_REQUIRED | `order.change` (proposal sent) |
| CUSTOMER_CONFIRMATION_REQUIRED | PENDING_APPROVAL | the customer (accept/decline) or `order.change` (withdraw) |
| APPROVED | QUEUED | **SYSTEM only** — the outbox dispatcher, after creating the kitchen ticket |
| APPROVED | CANCELLED | `order.cancel` |
| QUEUED | PREPARING | `kitchen.update` |
| QUEUED | CANCELLED | `order.cancel` (ticket cancelled) |
| PREPARING | READY | `kitchen.update` |
| PREPARING | CANCEL_REQUESTED | `order.cancel` |
| CANCEL_REQUESTED | CANCELLED | `kitchen.update` or `order.cancel` *(resolution added so the state is not a dead end)* |
| CANCEL_REQUESTED | PREPARING | `kitchen.update` *(too late to stop)* |
| READY | SERVED | `order.serve` |

`CART` is intentionally **not** persisted: a cart is a client-side draft that the server re-prices on every
quote and on submission.

## Separate status fields

| Field | Values | Written by |
|---|---|---|
| `Order.status` | operational lifecycle above | `transitionOrder()` only |
| `KitchenTicket.status` | QUEUED, PREPARING, READY, COMPLETED, CANCEL_REQUESTED, CANCELLED | kitchen service / serve / cancel |
| `Order.paymentStatus` | UNPAID, PARTIALLY_PAID, PAID, REFUNDED, VOIDED | `syncPaymentStatus()` only, derived from payments + adjustments |
| `KitchenTicket.flag` | NONE, DELAYED, SHORTAGE, ISSUE | kitchen |

`PAID` never replaces `SERVED`: an order is `SERVED` + `PAID` (or `SERVED` + `UNPAID` awaiting payment).

## Approval safeguards (all enforced on the server, covered by tests)

1. Submission always creates `PENDING_APPROVAL` (`lib/orders/submit.ts`).
2. The KDS is built only from `KitchenTicket` rows; tickets are only created by the dispatcher for `APPROVED` orders.
3. Approval requires `order.approve` at the route **and** in the state machine.
4. Approval runs in a transaction with an `Order` row lock (`SELECT … FOR UPDATE`).
5. Approval pins `approvedVersion`; the dispatcher refuses any other version. Stale approvals (`expectedVersion` ≠ current) fail with `STALE_VERSION`.
6. Rejected/cancelled orders are skipped by the dispatcher.
7. Repeat approvals are idempotent (`OrderApproval.orderId` unique, `alreadyApproved: true`, no new outbox event).
8. Approvals, rejections, proposals, price changes, payments and cancellations are audit-logged.
9. Dispatch is retried with backoff; `KitchenTicket.orderId` is unique so retries never duplicate tickets.
10. Concurrent supervisors are serialised by the row lock + compare-and-set.
