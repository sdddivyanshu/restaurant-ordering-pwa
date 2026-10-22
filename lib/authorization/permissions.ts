// Server-enforced RBAC. Roles map to permissions (seeded into Role/Permission tables);
// individual users can receive extra grants (UserPermission). UI hiding is cosmetic only.

export const PERMISSIONS = {
  ORDER_VIEW: "order.view",
  ORDER_APPROVE: "order.approve",
  ORDER_CHANGE: "order.change",
  ORDER_CANCEL: "order.cancel",
  ORDER_SERVE: "order.serve",
  KITCHEN_VIEW: "kitchen.view",
  KITCHEN_UPDATE: "kitchen.update",
  BILL_VIEW: "bill.view",
  PAYMENT_RECORD: "payment.record",
  PAYMENT_ADJUST: "payment.adjust",
  SERVICE_VIEW: "service.view",
  SERVICE_UPDATE: "service.update",
  MENU_MANAGE: "menu.manage",
  TABLE_MANAGE: "table.manage",
  USER_MANAGE: "user.manage",
  SETTINGS_MANAGE: "settings.manage",
  ANALYTICS_VIEW: "analytics.view",
  AUDIT_VIEW: "audit.view",
  FEEDBACK_VIEW: "feedback.view",
  FEEDBACK_RESOLVE: "feedback.resolve",
  OUTBOX_MANAGE: "outbox.manage",
  CUSTOMER_PII_VIEW: "customer.pii.view",
  CUSTOMER_DATA_MANAGE: "customer.data.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const ROLE_KEYS = ["ADMIN", "SUPERVISOR", "KITCHEN", "CASHIER", "SERVICE"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const P = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  SUPERVISOR: [
    P.ORDER_VIEW,
    P.ORDER_APPROVE,
    P.ORDER_CHANGE,
    P.ORDER_CANCEL,
    P.ORDER_SERVE,
    P.KITCHEN_VIEW,
    P.SERVICE_VIEW,
    P.SERVICE_UPDATE,
    P.BILL_VIEW,
    P.FEEDBACK_VIEW,
    P.CUSTOMER_PII_VIEW,
    P.OUTBOX_MANAGE,
  ],
  KITCHEN: [P.KITCHEN_VIEW, P.KITCHEN_UPDATE],
  CASHIER: [P.BILL_VIEW, P.PAYMENT_RECORD, P.PAYMENT_ADJUST, P.CUSTOMER_PII_VIEW],
  SERVICE: [P.SERVICE_VIEW, P.SERVICE_UPDATE, P.ORDER_SERVE],
};

export const ROLE_LABELS: Record<RoleKey, string> = {
  ADMIN: "Administrator",
  SUPERVISOR: "Supervisor",
  KITCHEN: "Kitchen staff",
  CASHIER: "Cashier",
  SERVICE: "Service staff",
};

export function hasPermission(granted: ReadonlySet<string> | readonly string[], permission: Permission): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return set.has(permission);
}

export function hasAnyPermission(granted: ReadonlySet<string> | readonly string[], permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(granted, p));
}

/** Where a staff member lands after login, based on what they can do. */
export function homePathFor(granted: ReadonlySet<string> | readonly string[]): string {
  if (hasPermission(granted, P.SETTINGS_MANAGE)) return "/admin";
  if (hasPermission(granted, P.ORDER_APPROVE)) return "/staff/supervisor";
  if (hasPermission(granted, P.KITCHEN_UPDATE)) return "/staff/kitchen";
  if (hasPermission(granted, P.PAYMENT_RECORD)) return "/staff/cashier";
  if (hasPermission(granted, P.SERVICE_VIEW)) return "/staff/service";
  return "/staff/login";
}
