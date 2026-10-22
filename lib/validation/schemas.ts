import { z } from "zod";

// Request schemas shared by API routes (and reusable by forms). Every API input is validated
// with one of these before reaching a service.

const id = z.string().min(1).max(40);
const shortText = (max: number) => z.string().trim().max(max);

export const cartLineSchema = z.object({
  menuItemId: id,
  quantity: z.number().int().min(1).max(20),
  selections: z
    .array(z.object({ groupId: id, optionIds: z.array(id).max(20) }))
    .max(20)
    .default([]),
  notes: shortText(200).optional(),
});
export type CartLineInput = z.infer<typeof cartLineSchema>;

export const quoteSchema = z.object({
  lines: z.array(cartLineSchema).min(1).max(50),
  rewardId: id.nullish(),
});

export const submitOrderSchema = quoteSchema.extend({
  specialInstructions: shortText(500).optional(),
  expectedTotalPaise: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8).max(100),
});

export const qrSchema = z.object({ token: z.string().min(10).max(100) });

export const registerSchema = z.object({
  qrToken: z.string().min(10).max(100),
  name: z.string().trim().min(1, "Please enter your name").max(60),
  phone: z.string().trim().min(6).max(20),
  privacyConsent: z.literal(true, { message: "Please accept the privacy notice to continue" }),
  marketingConsent: z.boolean().default(false),
  language: z.enum(["en", "hi"]).default("en"),
});

export const otpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });

export const languageSchema = z.object({ language: z.enum(["en", "hi"]) });

export const changeResponseSchema = z.object({
  changeRequestId: id,
  accept: z.boolean(),
});

export const customerCancelSchema = z.object({ reason: shortText(200).optional() });

export const serviceRequestSchema = z
  .object({
    type: z.enum(["WAITER", "WATER", "CUTLERY", "BILL", "TAKEAWAY_PACKAGING", "ASSISTANCE", "CUSTOM"]),
    message: shortText(140).optional(),
  })
  .refine((v) => v.type !== "CUSTOM" || (v.message && v.message.length >= 2), {
    message: "Please describe your request",
    path: ["message"],
  });

export const feedbackSchema = z.object({
  orderId: id,
  overall: z.number().int().min(1).max(5),
  food: z.number().int().min(1).max(5),
  service: z.number().int().min(1).max(5),
  comment: shortText(1000).optional(),
  itemRatings: z.array(z.object({ orderItemId: id, rating: z.number().int().min(1).max(5) })).max(50).default([]),
});

export const assistantSchema = z.object({
  query: shortText(300).default(""),
  lang: z.enum(["en", "hi"]).default("en"),
});

// ── Staff ──

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(1).max(200),
});

export const supervisorActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), expectedVersion: z.number().int().positive() }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3, "A rejection reason is required").max(300) }),
  z.object({ action: z.literal("flag"), note: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("resolve-flag"), note: shortText(300).optional() }),
  z.object({
    action: z.literal("propose-change"),
    expectedVersion: z.number().int().positive(),
    kind: z.enum(["SUBSTITUTION", "QUANTITY", "CUSTOMIZATION", "REMOVAL", "MIXED"]),
    reason: z.string().trim().min(3).max(300),
    lines: z.array(cartLineSchema).min(1).max(50),
  }),
  z.object({ action: z.literal("withdraw-change") }),
  z.object({ action: z.literal("note"), body: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(3).max(300) }),
]);

export const kitchenActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("ready") }),
  z.object({ action: z.literal("flag"), flag: z.enum(["DELAYED", "SHORTAGE", "ISSUE"]), note: z.string().trim().min(2).max(300) }),
  z.object({ action: z.literal("clear-flag") }),
  z.object({ action: z.literal("confirm-cancel") }),
  z.object({ action: z.literal("continue") }),
]);

export const serveSchema = z.object({ orderId: id });

export const serviceActionSchema = z.object({ action: z.enum(["acknowledge", "start", "complete", "cancel"]) });

export const recordPaymentSchema = z.object({
  orderId: id,
  amountPaise: z.number().int().positive().max(100_000_000),
  method: z.enum(["CASH", "UPI_MANUAL", "CARD_AT_COUNTER", "OTHER"]),
  externalReference: shortText(80).optional(),
  note: shortText(200).optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export const adjustmentSchema = z.object({
  type: z.enum(["DISCOUNT", "CORRECTION", "REFUND"]),
  amountPaise: z.number().int().positive().max(100_000_000),
  reason: z.string().trim().min(3).max(300),
});

export const voidPaymentSchema = z.object({ reason: z.string().trim().min(3).max(300) });

// ── Admin ──

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullish();
const i18nMap = z.record(z.string().max(5), z.string().max(200)).default({});

export const categoryUpsertSchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z.string().trim().regex(/^[a-z0-9-]{2,60}$/).optional(),
  description: shortText(300).nullish(),
  parentId: id.nullish(),
  isActive: z.boolean().default(true),
  availableFrom: hhmm,
  availableTo: hhmm,
  translations: z.array(z.object({ locale: z.string().min(2).max(5), name: z.string().trim().min(1).max(60), description: shortText(300).nullish() })).default([]),
});

export const itemUpsertSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().regex(/^[a-z0-9-]{2,80}$/).optional(),
  description: shortText(500).nullish(),
  categoryId: id,
  imageUrl: z
    .string()
    .max(300)
    .regex(/^(\/images\/[\w./-]+|\/api\/v1\/public\/images\/[\w.-]+)$/, "Image must be an uploaded or bundled image")
    .nullish(),
  basePricePaise: z.number().int().min(0).max(10_000_000),
  taxConfigId: id,
  dietType: z.enum(["VEG", "VEGAN", "EGG", "NON_VEG"]),
  spiceLevel: z.number().int().min(0).max(3).default(0),
  ingredients: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  prepMinutes: z.number().int().min(1).max(180).default(15),
  calories: z.number().int().min(0).max(5000).nullish(),
  isAvailable: z.boolean().default(true),
  isBestseller: z.boolean().default(false),
  isRecommended: z.boolean().default(false),
  allergenInfoVerified: z.boolean().default(false),
  availableFrom: hhmm,
  availableTo: hhmm,
  seasonalFrom: z.coerce.date().nullish(),
  seasonalTo: z.coerce.date().nullish(),
  allergens: z.array(z.object({ key: z.string().max(40), level: z.enum(["CONTAINS", "MAY_CONTAIN"]) })).max(20).default([]),
  dietaryAttributes: z.array(z.string().max(40)).max(20).default([]),
  customizationGroupIds: z.array(id).max(20).default([]),
  translations: z
    .array(
      z.object({
        locale: z.string().min(2).max(5),
        name: z.string().trim().min(1).max(80),
        description: shortText(500).nullish(),
        ingredients: z.array(z.string().trim().max(60)).max(40).default([]),
      }),
    )
    .default([]),
});

export const groupUpsertSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9-]{2,60}$/).optional(),
    name: z.string().trim().min(1).max(60),
    nameI18n: i18nMap,
    kind: z.enum(["VARIANT", "ADDON", "CHOICE"]),
    isRequired: z.boolean(),
    minSelect: z.number().int().min(0).max(20),
    maxSelect: z.number().int().min(1).max(20),
    options: z
      .array(
        z.object({
          id: id.optional(),
          name: z.string().trim().min(1).max(60),
          nameI18n: i18nMap,
          priceDeltaPaise: z.number().int().min(-1_000_000).max(1_000_000),
          isDefault: z.boolean().default(false),
          isAvailable: z.boolean().default(true),
          dietType: z.enum(["VEG", "VEGAN", "EGG", "NON_VEG"]).nullish(),
        }),
      )
      .min(1)
      .max(30),
  })
  .refine((g) => g.minSelect <= g.maxSelect, { message: "Minimum cannot exceed maximum", path: ["minSelect"] })
  .refine((g) => !g.isRequired || g.maxSelect >= 1, { message: "Required groups need at least one selectable option" });

export const reorderSchema = z.object({
  entity: z.enum(["category", "item"]),
  ids: z.array(id).min(1).max(500),
});

export const tableUpsertSchema = z.object({
  label: z.string().trim().regex(/^[A-Za-z0-9-]{1,10}$/, "Use letters, numbers and dashes"),
  name: z.string().trim().min(1).max(40),
  seats: z.number().int().min(1).max(30).default(4),
  area: shortText(40).nullish(),
  isActive: z.boolean().default(true),
});

export const tableActionSchema = z.object({
  action: z.enum(["regenerate-qr", "revoke-qr", "close-visit", "mark-clean", "archive"]),
});

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  name: z.string().trim().min(1).max(60),
  roleKey: z.enum(["ADMIN", "SUPERVISOR", "KITCHEN", "CASHIER", "SERVICE"]),
  password: z.string().min(12).max(200),
  extraPermissions: z.array(z.string().max(60)).max(30).default([]),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  roleKey: z.enum(["ADMIN", "SUPERVISOR", "KITCHEN", "CASHIER", "SERVICE"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(12).max(200).optional(),
  extraPermissions: z.array(z.string().max(60)).max(30).optional(),
});

export const settingsUpdateSchema = z.object({
  restaurant: z
    .object({
      name: z.string().trim().min(1).max(80),
      legalName: shortText(120).nullish(),
      address: shortText(300).nullish(),
      phone: shortText(30).nullish(),
      gstin: shortText(20).nullish(),
      brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .partial()
    .optional(),
  settings: z
    .object({
      pricesIncludeTax: z.boolean(),
      roundingMode: z.enum(["NONE", "NEAREST_RUPEE"]),
      phoneCountryCode: z.string().regex(/^\d{1,4}$/),
      tableSessionHours: z.number().int().min(1).max(24),
      customerSessionHours: z.number().int().min(1).max(24),
      kitchenTargetMinutes: z.number().int().min(1).max(180),
      approvalTargetMinutes: z.number().int().min(1).max(60),
      serviceDupWindowSeconds: z.number().int().min(0).max(3600),
      loyaltyEnabled: z.boolean(),
      loyaltyPaisePerPoint: z.number().int().min(100).max(1_000_000),
      loyaltyMinRedeemPoints: z.number().int().min(0).max(1_000_000),
      loyaltyExpiryDays: z.number().int().min(0).max(3650),
      acceptedPaymentMethods: z.array(z.enum(["CASH", "UPI_MANUAL", "CARD_AT_COUNTER", "OTHER"])).min(1),
      upiId: shortText(80).nullish(),
      upiPayeeName: shortText(80).nullish(),
      receiptFooter: shortText(300).nullish(),
      customerDataRetentionDays: z.number().int().min(30).max(3650),
    })
    .partial()
    .optional(),
});

export const taxUpsertSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]{2,20}$/),
  name: z.string().trim().min(1).max(60),
  rateBps: z.number().int().min(0).max(10_000),
  components: z.array(z.object({ name: z.string().trim().min(1).max(20), rateBps: z.number().int().min(0).max(10_000) })).max(4).default([]),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const rewardUpsertSchema = z.object({
  name: z.string().trim().min(1).max(60),
  nameI18n: i18nMap,
  description: shortText(200).nullish(),
  descriptionI18n: i18nMap,
  type: z.enum(["PERCENT_OFF", "FIXED_OFF", "FREE_ITEM"]),
  pointsCost: z.number().int().min(1).max(1_000_000),
  valuePaise: z.number().int().min(0).nullish(),
  percentBps: z.number().int().min(0).max(10_000).nullish(),
  maxDiscountPaise: z.number().int().min(0).nullish(),
  freeMenuItemId: id.nullish(),
  minOrderPaise: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  validFrom: z.coerce.date().nullish(),
  validTo: z.coerce.date().nullish(),
});

export const feedbackResolveSchema = z.object({ note: z.string().trim().min(2).max(1000) });

export const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeDemo: z.enum(["true", "false"]).default("true"),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  status: z.string().max(40).optional(),
});
