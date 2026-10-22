# Database

PostgreSQL 17, schema in [`prisma/schema.prisma`](../prisma/schema.prisma), migrations in `prisma/migrations`.

## Conventions

- Primary keys are random `cuid` strings — never sequential, never meaningful. Customer-facing references
  (`ORD-K7Q2XM`) are random codes. Table QR tokens are 144-bit random strings, stored per table and
  rotatable/revocable.
- Money is `Int` paise. Tax rates are `Int` basis points (500 = 5%).
- `createdAt` / `updatedAt` on business records; actor ids on approvals, payments, notes, adjustments,
  history and audit rows.
- Soft deletion/archival (`archivedAt`) for categories, items, customization groups/options and tables, so
  historical orders keep working.
- Integrity CHECK constraints (migration `…_integrity_checks`): non-negative loyalty balance and amounts,
  discount ≤ subtotal, positive quantities/payments, rating ranges, select bounds, tax rate range.

## Entities (grouped)

| Area | Tables |
|---|---|
| Restaurant & config | `Restaurant`, `RestaurantSettings`, `TaxConfiguration` |
| Identity & RBAC | `User`, `Role`, `Permission`, `RolePermission`, `UserPermission`, `StaffSession` |
| Customers & tables | `Customer`, `CustomerDevice`, `CustomerSession`, `RestaurantTable`, `TableSession` |
| Menu | `MenuCategory`, `MenuCategoryTranslation`, `MenuItem`, `MenuItemTranslation`, `Allergen`, `ItemAllergen`, `DietaryAttribute`, `ItemDietaryAttribute`, `CustomizationGroup`, `CustomizationOption`, `MenuItemCustomizationGroup` |
| Ordering | `Order`, `OrderItem`, `OrderItemCustomization`, `OrderStatusHistory`, `OrderApproval`, `OrderChangeRequest`, `OrderNote`, `KitchenTicket`, `KitchenTicketItem` |
| Billing | `Payment`, `PaymentAdjustment`, `Receipt` |
| Reliability & audit | `OutboxEvent`, `AuditLog`, `NotificationEvent` |
| Engagement | `LoyaltyAccount`, `LoyaltyLedgerEntry`, `Reward`, `RewardRedemption`, `ServiceRequest`, `Feedback`, `FeedbackResponse`, `NotificationPreference` |

## Snapshots and versions

`OrderItem` rows are immutable snapshots (name, translations, options, unit/line prices, tax code & rate,
allergens, prep time). An accepted change request writes a new set of rows with `version = n+1` and bumps
`Order.version`; old rows stay for audit. Current items are always `OrderItem.version = Order.version`.
`Receipt.snapshot` freezes the bill at issue time, so later menu edits never change history.

## Important unique constraints / indexes

| Constraint | Purpose |
|---|---|
| `Order(customerSessionId, idempotencyKey)` | duplicate submissions return the same order |
| `OrderApproval.orderId` | one decision per order |
| `KitchenTicket.orderId` | one ticket per order |
| `OutboxEvent.dedupeKey` | an event is enqueued once |
| `Payment(orderId, idempotencyKey)` | repeated "record payment" clicks are no-ops |
| `LoyaltyLedgerEntry.dedupeKey` | points awarded / redeemed / reversed at most once per cycle |
| `RestaurantTable.qrToken` | token → table lookup |
| indexes | `Order(status, submittedAt)`, `Order(tableSessionId)`, `Order(customerId, createdAt)`, `TableSession(tableId, status)`, `KitchenTicket(status, createdAt)`, `ServiceRequest(status, createdAt)`, `ServiceRequest(tableSessionId, type, createdAt)`, `MenuItem(categoryId, displayOrder)`, `OutboxEvent(status, nextAttemptAt)`, `AuditLog(entityType, entityId)` |

## Personal data, retention and deletion

- Stored PII: customer name, mobile number (E.164), consent timestamps/version, marketing consent.
  Staff: name, email, Argon2 hash. No payment card data is ever stored.
- `RestaurantSettings.customerDataRetentionDays` (default 730) documents the policy; `DELETE
  /api/v1/admin/customers/{id}` (permission `customer.data.manage`) **anonymises** a customer: name/phone
  replaced, marketing consent cleared, sessions revoked, feedback comments removed — orders, payments and
  receipts are retained because financial records may be legally required. Automating retention-based
  anonymisation is listed as a next step; confirm actual retention obligations (e.g. GST record-keeping,
  DPDP Act 2023) with counsel — this project does not claim regulatory compliance.
- Logs/audit entries redact `password`, `otp`, `token` and phone fields.
