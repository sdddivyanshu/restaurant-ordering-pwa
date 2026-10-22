// DEVELOPMENT / DEMO SEED — wipes the database and loads clearly-labelled synthetic data.
// Refuses to run in production unless ALLOW_DEMO_SEED=true is set explicitly.
import "../scripts/load-env";
import { prisma } from "../lib/db/prisma";
import type { Customer, OrderStatus, Prisma } from "../lib/generated/prisma/client";
import { hashPassword } from "../lib/auth/password";
import { ALL_PERMISSIONS, ROLE_KEYS, ROLE_LABELS, ROLE_PERMISSIONS } from "../lib/authorization/permissions";
import { newQrToken, qrUrlFor } from "../lib/tables/service";
import { quoteCart } from "../lib/pricing/quote";
import { createOrderItemsFromQuote, totalsFromQuote } from "../lib/orders/create-items";
import { ensureReceipt } from "../lib/payments/service";
import { awardPointsIfEligible } from "../lib/loyalty/service";
import { randomCode, randomToken, sha256 } from "../lib/security/tokens";
import type { CartLineInput } from "../lib/validation/schemas";
import { ALLERGENS, CATEGORIES, CUSTOMERS, DEMO_PASSWORD, DIETARY_ATTRIBUTES, GROUPS, ITEMS, STAFF } from "./seed-data";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to seed demo data in production. Set ALLOW_DEMO_SEED=true only for a disposable demo environment.");
  process.exit(1);
}

const MIN = 60_000;
const DAY = 86_400_000;

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

async function main() {
  console.log("Seeding demo data (synthetic, isDemo=true)…");
  await wipe();

  // ── Restaurant & configuration ──
  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Saffron Table (Demo)",
      legalName: "Saffron Table Hospitality Pvt Ltd (sample)",
      address: "12 Demo Street, Bengaluru 560001",
      phone: "+91 80 0000 0000",
      gstin: "29AAAAA0000A1Z5",
      isDemo: true,
      settings: {
        create: {
          upiId: "saffrontable@demoupi",
          upiPayeeName: "Saffron Table",
          receiptFooter: "Thank you for dining with us! (Demo receipt — not a tax invoice)",
        },
      },
    },
  });
  const gst5 = await prisma.taxConfiguration.create({
    data: { restaurantId: restaurant.id, code: "GST5", name: "GST 5% (restaurant service)", rateBps: 500, components: [{ name: "CGST", rateBps: 250 }, { name: "SGST", rateBps: 250 }], isDefault: true },
  });
  const gst18 = await prisma.taxConfiguration.create({
    data: { restaurantId: restaurant.id, code: "GST18", name: "GST 18% (packaged goods)", rateBps: 1800, components: [{ name: "CGST", rateBps: 900 }, { name: "SGST", rateBps: 900 }] },
  });

  // ── RBAC ──
  const perms = new Map<string, string>();
  for (const key of ALL_PERMISSIONS) perms.set(key, (await prisma.permission.create({ data: { key } })).id);
  const roles = new Map<string, string>();
  for (const key of ROLE_KEYS) {
    const role = await prisma.role.create({
      data: { key, name: ROLE_LABELS[key], permissions: { create: ROLE_PERMISSIONS[key].map((p) => ({ permissionId: perms.get(p)! })) } },
    });
    roles.set(key, role.id);
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const staff: Record<string, string> = {};
  for (const s of STAFF) {
    const u = await prisma.user.create({ data: { email: s.email, name: s.name, roleId: roles.get(s.role)!, passwordHash, isDemo: true } });
    staff[s.role] = u.id;
  }

  // ── Menu ──
  const allergenIds = new Map<string, string>();
  for (const a of ALLERGENS) allergenIds.set(a.key, (await prisma.allergen.create({ data: { key: a.key, name: a.name, nameI18n: { hi: a.hi } } })).id);
  const attrIds = new Map<string, string>();
  for (const d of DIETARY_ATTRIBUTES) attrIds.set(d.key, (await prisma.dietaryAttribute.create({ data: { key: d.key, name: d.name, nameI18n: { hi: d.hi } } })).id);
  const catIds = new Map<string, string>();
  for (const [idx, c] of CATEGORIES.entries()) {
    const cat = await prisma.menuCategory.create({
      data: { slug: c.slug, name: c.name, description: c.description, displayOrder: idx + 1, translations: { create: [{ locale: "hi", name: c.hi, description: c.hiDesc }] } },
    });
    catIds.set(c.slug, cat.id);
  }
  const groupIds = new Map<string, string>();
  for (const [idx, g] of GROUPS.entries()) {
    const group = await prisma.customizationGroup.create({
      data: {
        key: g.key,
        name: g.name,
        nameI18n: { hi: g.hi },
        kind: g.kind,
        isRequired: g.isRequired,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        displayOrder: idx,
        options: {
          create: g.options.map((o, i) => ({
            name: o.name,
            nameI18n: { hi: o.hi },
            priceDeltaPaise: o.price,
            isDefault: o.isDefault ?? false,
            dietType: o.dietType ?? null,
            allergenKeys: o.allergenKeys ?? [],
            displayOrder: i,
          })),
        },
      },
    });
    groupIds.set(g.key, group.id);
  }
  const itemIds = new Map<string, string>();
  const now = Date.now();
  for (const [idx, i] of ITEMS.entries()) {
    const item = await prisma.menuItem.create({
      data: {
        slug: i.slug,
        categoryId: catIds.get(i.category)!,
        name: i.name,
        description: i.description,
        imageUrl: `/images/menu/${i.slug}.svg`,
        basePricePaise: i.price,
        taxConfigId: i.tax === "GST18" ? gst18.id : gst5.id,
        dietType: i.diet,
        spiceLevel: i.spice,
        ingredients: i.ingredients,
        prepMinutes: i.prep,
        isAvailable: !i.unavailable,
        isBestseller: i.bestseller ?? false,
        isRecommended: i.recommended ?? false,
        allergenInfoVerified: !i.unverified,
        seasonalFrom: i.seasonalFuture ? new Date(now + 60 * DAY) : null,
        seasonalTo: i.seasonalFuture ? new Date(now + 150 * DAY) : null,
        displayOrder: idx + 1,
        translations: { create: [{ locale: "hi", name: i.hi, description: i.hiDesc, ingredients: i.hiIngredients }] },
        allergens: { create: i.allergens.map((a) => ({ allergenId: allergenIds.get(a.key)!, level: a.level ?? "CONTAINS" })) },
        dietaryAttributes: { create: (i.dietary ?? []).map((k) => ({ attributeId: attrIds.get(k)! })) },
        customizationGroups: { create: (i.groups ?? []).map((k, gi) => ({ groupId: groupIds.get(k)!, displayOrder: gi })) },
      },
    });
    itemIds.set(i.slug, item.id);
  }

  // ── Tables ──
  const tables: { id: string; label: string; qrToken: string }[] = [];
  for (let n = 1; n <= 12; n++) {
    const qrToken = newQrToken();
    const t = await prisma.restaurantTable.create({
      data: { label: `T${n}`, name: `Table ${n}`, seats: n <= 4 ? 2 : n <= 10 ? 4 : 6, area: n <= 6 ? "Main hall" : "Garden", qrToken, displayOrder: n },
    });
    tables.push({ id: t.id, label: t.label, qrToken });
  }

  // ── Rewards ──
  await prisma.reward.createMany({
    data: [
      { name: "Free Masala Chai", nameI18n: { hi: "मुफ़्त मसाला चाय" }, description: "One masala chai on us (add it to your cart).", descriptionI18n: { hi: "एक मसाला चाय मुफ़्त (कार्ट में जोड़ें)।" }, type: "FREE_ITEM", pointsCost: 60, freeMenuItemId: itemIds.get("masala-chai"), displayOrder: 1 },
      { name: "Free Gulab Jamun", nameI18n: { hi: "मुफ़्त गुलाब जामुन" }, description: "A free dessert (add it to your cart).", descriptionI18n: { hi: "एक मुफ़्त मिठाई (कार्ट में जोड़ें)।" }, type: "FREE_ITEM", pointsCost: 80, freeMenuItemId: itemIds.get("gulab-jamun"), displayOrder: 2 },
      { name: "₹100 off", nameI18n: { hi: "₹100 की छूट" }, description: "On orders of ₹500 or more.", descriptionI18n: { hi: "₹500 या अधिक के ऑर्डर पर।" }, type: "FIXED_OFF", pointsCost: 100, valuePaise: 10000, minOrderPaise: 50000, displayOrder: 3 },
      { name: "10% off (up to ₹150)", nameI18n: { hi: "10% छूट (₹150 तक)" }, description: "On any order.", descriptionI18n: { hi: "किसी भी ऑर्डर पर।" }, type: "PERCENT_OFF", pointsCost: 150, percentBps: 1000, maxDiscountPaise: 15000, displayOrder: 4 },
    ],
  });

  // ── Customers ──
  const customers: Customer[] = [];
  for (const c of CUSTOMERS) {
    customers.push(
      await prisma.customer.create({
        data: { name: c.name, phoneE164: c.phone, privacyConsentAt: new Date(), privacyConsentVersion: "2026-01", verifiedAt: c.verified ? new Date() : null, isDemo: true },
      }),
    );
  }
  const device = await prisma.customerDevice.create({ data: { tokenHash: sha256(randomToken()) } });

  // ── Demo orders across states ──
  const at = (offsetMs: number) => new Date(now - offsetMs);
  const line = (slug: string, quantity = 1, sel: Record<string, string[]> = {}): CartLineInput => ({
    menuItemId: itemIds.get(slug)!,
    quantity,
    selections: Object.entries(sel).map(([groupKey, names]) => ({ groupId: groupIds.get(groupKey)!, optionIds: names })),
  });
  // Resolve option names to ids
  const options = await prisma.customizationOption.findMany();
  const opt = (groupKey: string, name: string) => options.find((o) => o.groupId === groupIds.get(groupKey) && o.name === name)!.id;
  const defaults = (slug: string): Record<string, string[]> => {
    const def = ITEMS.find((i) => i.slug === slug)!;
    const out: Record<string, string[]> = {};
    for (const gk of def.groups ?? []) {
      const g = GROUPS.find((x) => x.key === gk)!;
      const d = g.options.find((o) => o.isDefault);
      if (g.isRequired && d) out[gk] = [opt(gk, d.name)];
    }
    return out;
  };
  const L = (slug: string, qty = 1, extra: Record<string, string[]> = {}) => line(slug, qty, { ...defaults(slug), ...extra });

  const PATHS: Record<string, OrderStatus[]> = {
    PENDING_APPROVAL: ["PENDING_APPROVAL"],
    CHANGE_REQUESTED: ["PENDING_APPROVAL", "CHANGE_REQUESTED"],
    QUEUED: ["PENDING_APPROVAL", "APPROVED", "QUEUED"],
    PREPARING: ["PENDING_APPROVAL", "APPROVED", "QUEUED", "PREPARING"],
    READY: ["PENDING_APPROVAL", "APPROVED", "QUEUED", "PREPARING", "READY"],
    SERVED: ["PENDING_APPROVAL", "APPROVED", "QUEUED", "PREPARING", "READY", "SERVED"],
    REJECTED: ["PENDING_APPROVAL", "REJECTED"],
    CANCELLED: ["PENDING_APPROVAL", "CANCELLED"],
  };

  async function demoOrder(o: {
    table: (typeof tables)[number];
    customerIdx: number;
    lines: CartLineInput[];
    status: keyof typeof PATHS;
    submittedAt: Date;
    open?: boolean;
    paid?: boolean;
    feedback?: { overall: number; food: number; service: number; comment?: string };
    note?: string;
  }) {
    const customer = customers[o.customerIdx];
    const visit = await prisma.tableSession.create({
      data: {
        tableId: o.table.id,
        status: o.open ? "OPEN" : "CLOSED",
        openedAt: new Date(o.submittedAt.getTime() - 5 * MIN),
        expiresAt: o.open ? new Date(now + 4 * 3600_000) : new Date(o.submittedAt.getTime() + 2 * 3600_000),
        closedAt: o.open ? null : new Date(o.submittedAt.getTime() + 90 * MIN),
      },
    });
    const cs = await prisma.customerSession.create({
      data: {
        tokenHash: sha256(randomToken()),
        customerId: customer.id,
        tableSessionId: visit.id,
        deviceId: device.id,
        expiresAt: visit.expiresAt,
        verifiedAt: customer.verifiedAt,
        createdAt: visit.openedAt,
      },
    });
    const quote = await quoteCart(prisma, o.lines);
    if (quote.issues.length) throw new Error(`Seed order invalid: ${JSON.stringify(quote.issues)}`);
    const path = PATHS[o.status];
    const t0 = o.submittedAt.getTime();
    const stamps: Partial<Record<OrderStatus, Date>> = {
      PENDING_APPROVAL: new Date(t0),
      APPROVED: new Date(t0 + 3 * MIN),
      QUEUED: new Date(t0 + 3 * MIN + 2000),
      PREPARING: new Date(t0 + 6 * MIN),
      READY: new Date(t0 + 20 * MIN),
      SERVED: new Date(t0 + 24 * MIN),
      REJECTED: new Date(t0 + 4 * MIN),
      CANCELLED: new Date(t0 + 2 * MIN),
      CHANGE_REQUESTED: new Date(t0 + 2 * MIN),
    };
    const reached = (s: OrderStatus) => path.includes(s);
    const order = await prisma.order.create({
      data: {
        reference: `ORD-${randomCode(6)}`,
        customerId: customer.id,
        customerSessionId: cs.id,
        deviceId: device.id,
        tableSessionId: visit.id,
        tableId: o.table.id,
        customerName: customer.name,
        status: path[path.length - 1],
        ...totalsFromQuote(quote),
        idempotencyKey: `seed-${randomToken(8)}`,
        submittedAt: o.submittedAt,
        createdAt: o.submittedAt,
        approvedAt: reached("APPROVED") ? stamps.APPROVED : null,
        approvedById: reached("APPROVED") ? staff.SUPERVISOR : null,
        approvedVersion: reached("APPROVED") ? 1 : null,
        queuedAt: reached("QUEUED") ? stamps.QUEUED : null,
        preparingAt: reached("PREPARING") ? stamps.PREPARING : null,
        readyAt: reached("READY") ? stamps.READY : null,
        servedAt: reached("SERVED") ? stamps.SERVED : null,
        servedById: reached("SERVED") ? staff.SERVICE : null,
        rejectedAt: reached("REJECTED") ? stamps.REJECTED : null,
        rejectionReason: reached("REJECTED") ? "Kitchen closing for the night (demo)" : null,
        cancelledAt: reached("CANCELLED") ? stamps.CANCELLED : null,
        cancelReason: reached("CANCELLED") ? "Customer changed their mind (demo)" : null,
        needsClarification: o.status === "CHANGE_REQUESTED",
        clarificationNote: o.status === "CHANGE_REQUESTED" ? o.note ?? "Please confirm the spice level for the biryani." : null,
        paymentStatus: reached("REJECTED") || reached("CANCELLED") ? "VOIDED" : "UNPAID",
        specialInstructions: o.note && o.status !== "CHANGE_REQUESTED" ? o.note : null,
        isDemo: true,
      },
    });
    await createOrderItemsFromQuote(prisma, order.id, 1, quote);
    let prev: OrderStatus | null = null;
    for (const s of path) {
      await prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: prev,
          toStatus: s,
          actorType: s === "PENDING_APPROVAL" ? "CUSTOMER" : s === "QUEUED" ? "SYSTEM" : "STAFF",
          actorId: s === "PENDING_APPROVAL" ? customer.id : s === "QUEUED" ? null : s === "PREPARING" || s === "READY" ? staff.KITCHEN : staff.SUPERVISOR,
          createdAt: stamps[s],
        },
      });
      prev = s;
    }
    if (reached("APPROVED")) {
      await prisma.orderApproval.create({ data: { orderId: order.id, decision: "APPROVED", orderVersion: 1, actorId: staff.SUPERVISOR, createdAt: stamps.APPROVED } });
      await prisma.outboxEvent.create({
        data: { type: "KITCHEN_DISPATCH", aggregateId: order.id, dedupeKey: `kitchen-dispatch:${order.id}:v1`, payload: { orderId: order.id, version: 1 }, status: "DONE", attempts: 1, processedAt: stamps.QUEUED, createdAt: stamps.APPROVED },
      });
      const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, include: { customizations: true } });
      const tStatus = reached("SERVED") ? "COMPLETED" : reached("READY") ? "READY" : reached("PREPARING") ? "PREPARING" : "QUEUED";
      await prisma.kitchenTicket.create({
        data: {
          orderId: order.id,
          orderVersion: 1,
          orderRef: order.reference,
          tableLabel: o.table.label,
          status: tStatus,
          targetMinutes: Math.max(15, ...items.map((i) => i.prepMinutes)),
          notes: order.specialInstructions,
          startedAt: order.preparingAt,
          readyAt: order.readyAt,
          completedAt: order.servedAt,
          createdAt: stamps.QUEUED,
          items: {
            create: items.map((i) => ({
              orderItemId: i.id,
              name: i.nameSnapshot,
              quantity: i.quantity,
              modifiers: i.customizations.map((c) => `${c.groupName}: ${c.optionName}`),
              allergens: i.allergenSnapshot,
              dietType: i.dietType,
              prepMinutes: i.prepMinutes,
            })),
          },
        },
      });
    }
    if (reached("REJECTED")) {
      await prisma.orderApproval.create({ data: { orderId: order.id, decision: "REJECTED", orderVersion: 1, actorId: staff.SUPERVISOR, reason: order.rejectionReason } });
    }
    if (o.paid) {
      await prisma.payment.create({
        data: {
          orderId: order.id,
          amountPaise: order.totalPaise,
          method: o.customerIdx % 2 === 0 ? "UPI_MANUAL" : "CASH",
          idempotencyKey: `seed-${randomToken(8)}`,
          recordedById: staff.CASHIER,
          createdAt: new Date(t0 + 40 * MIN),
        },
      });
      await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID", paidAt: new Date(t0 + 40 * MIN) } });
      await prisma.$transaction(async (tx) => {
        await ensureReceipt(tx, order.id, staff.CASHIER);
        await awardPointsIfEligible(tx, order.id);
      });
    }
    if (o.feedback) {
      await prisma.feedback.create({
        data: {
          orderId: order.id,
          customerId: customer.id,
          ...o.feedback,
          isComplaint: Math.min(o.feedback.overall, o.feedback.food, o.feedback.service) <= 2,
          isDemo: true,
          createdAt: new Date(t0 + 50 * MIN),
        },
      });
    }
    return { order, visit, cs };
  }

  const T = (label: string) => tables.find((t) => t.label === label)!;
  const veg = ["paneer-butter-masala", "dal-makhani", "veg-biryani", "chana-masala", "palak-paneer", "paneer-tikka"];
  const nonVeg = ["butter-chicken", "chicken-dum-biryani", "mutton-rogan-josh", "chicken-65", "egg-curry"];
  const sides = ["naan", "tandoori-roti", "jeera-rice", "lachha-paratha"];
  const drinks = ["masala-chai", "sweet-lassi", "fresh-lime-soda", "cold-coffee", "soft-drink"];
  const desserts = ["gulab-jamun", "rasmalai", "chocolate-brownie"];
  const comments = ["Lovely food, quick service!", "Butter chicken was excellent.", "Naan was a bit cold.", "Great biryani, will come back.", undefined, "Friendly staff."];

  // Historic paid orders over the last 14 days (for analytics, history and loyalty).
  for (let d = 14; d >= 1; d--) {
    const perDay = 1 + (d % 3);
    for (let k = 0; k < perDay; k++) {
      const idx = (d + k) % customers.length;
      const lines = [
        L(veg[(d + k) % veg.length], 1),
        L(sides[(d * 2 + k) % sides.length], 2),
        ...(k % 2 === 0 ? [L(nonVeg[(d + k) % nonVeg.length], 1)] : []),
        L(drinks[(d + k) % drinks.length], 1 + (k % 2)),
        ...(d % 4 === 0 ? [L(desserts[d % desserts.length], 1)] : []),
      ];
      const rating = d === 9 && k === 0 ? 2 : 3 + ((d + k) % 3);
      await demoOrder({
        table: tables[(d + k) % 12],
        customerIdx: idx,
        lines,
        status: "SERVED",
        submittedAt: at(d * DAY - (12 + k * 2) * 3600_000),
        paid: true,
        feedback: (d + k) % 2 === 0 ? { overall: rating, food: Math.min(5, rating + 1), service: rating, comment: d === 9 && k === 0 ? "Waited too long for our mains (demo complaint)." : comments[(d + k) % comments.length] } : undefined,
      });
    }
  }
  await demoOrder({ table: T("T11"), customerIdx: 2, lines: [L("butter-chicken")], status: "REJECTED", submittedAt: at(3 * DAY) });
  await demoOrder({ table: T("T12"), customerIdx: 4, lines: [L("cold-coffee", 2)], status: "CANCELLED", submittedAt: at(2 * DAY) });

  // Live orders (today) in different operational states.
  await demoOrder({ table: T("T3"), customerIdx: 2, lines: [L("paneer-tikka", 1), L("dal-makhani", 1, { "curry-addons": [opt("curry-addons", "Extra butter")] }), L("naan", 2, { "naan-style": [opt("naan-style", "Garlic")] })], status: "PENDING_APPROVAL", submittedAt: at(4 * MIN), open: true, note: "Less oil please" });
  await demoOrder({ table: T("T8"), customerIdx: 4, lines: [L("veg-biryani", 1), L("sweet-lassi", 1)], status: "CHANGE_REQUESTED", submittedAt: at(9 * MIN), open: true, note: "Customer asked for 'no spice' on a biryani — please confirm whether mild is OK." });
  await demoOrder({ table: T("T4"), customerIdx: 1, lines: [L("butter-chicken"), L("naan", 2), L("masala-chai", 2)], status: "QUEUED", submittedAt: at(7 * MIN), open: true });
  await demoOrder({ table: T("T5"), customerIdx: 3, lines: [L("chicken-dum-biryani", 1, { "biryani-extras": [opt("biryani-extras", "Boiled egg")] }), L("chicken-65"), L("fresh-lime-soda", 2)], status: "PREPARING", submittedAt: at(18 * MIN), open: true, note: "Birthday table — bring the dessert later" });
  await demoOrder({ table: T("T6"), customerIdx: 0, lines: [L("palak-paneer"), L("tandoori-roti", 3)], status: "READY", submittedAt: at(28 * MIN), open: true });
  await demoOrder({ table: T("T7"), customerIdx: 0, lines: [L("mutton-rogan-josh"), L("jeera-rice"), L("gulab-jamun", 2)], status: "SERVED", submittedAt: at(55 * MIN), open: true });

  for (const label of ["T3", "T4", "T5", "T6", "T7", "T8"]) {
    await prisma.restaurantTable.update({ where: { id: T(label).id }, data: { status: "OCCUPIED" } });
  }
  await prisma.restaurantTable.update({ where: { id: T("T9").id }, data: { status: "NEEDS_CLEANING" } });

  // Service requests: two open, plus historic completed ones.
  const openVisits = await prisma.tableSession.findMany({ where: { status: "OPEN" }, include: { table: true } });
  const visitFor = (label: string) => openVisits.find((v) => v.table.label === label)!;
  await prisma.serviceRequest.create({ data: { tableId: T("T3").id, tableSessionId: visitFor("T3").id, type: "WATER", priority: "LOW", isDemo: true, createdAt: at(2 * MIN) } });
  await prisma.serviceRequest.create({ data: { tableId: T("T7").id, tableSessionId: visitFor("T7").id, type: "BILL", priority: "NORMAL", isDemo: true, createdAt: at(1 * MIN) } });
  const closedVisits = await prisma.tableSession.findMany({ where: { status: "CLOSED" }, take: 12 });
  const types = ["WAITER", "WATER", "CUTLERY", "BILL", "ASSISTANCE", "TAKEAWAY_PACKAGING"] as const;
  for (const [i, v] of closedVisits.entries()) {
    const created = new Date(v.openedAt.getTime() + 20 * MIN);
    await prisma.serviceRequest.create({
      data: { tableId: v.tableId, tableSessionId: v.id, type: types[i % types.length], status: "COMPLETED", priority: "NORMAL", assignedToId: staff.SERVICE, createdAt: created, acknowledgedAt: new Date(created.getTime() + MIN), completedAt: new Date(created.getTime() + (2 + (i % 5)) * MIN), isDemo: true },
    });
  }

  // Opening loyalty balance for a verified demo customer so redemption can be tried immediately.
  const priya = customers[0];
  const acct = await prisma.loyaltyAccount.upsert({ where: { customerId: priya.id }, create: { customerId: priya.id }, update: {} });
  const bonus = 200;
  const updated = await prisma.loyaltyAccount.update({ where: { id: acct.id }, data: { balance: { increment: bonus }, lastEarnedAt: new Date() } });
  await prisma.loyaltyLedgerEntry.create({ data: { accountId: acct.id, type: "ADJUST", points: bonus, balanceAfter: updated.balance, reason: "Demo opening balance", dedupeKey: "seed-opening-balance" } });

  console.log("\nDemo staff accounts (password for all: %s):", DEMO_PASSWORD);
  for (const s of STAFF) console.log(`  ${s.role.padEnd(10)} ${s.email}`);
  console.log("\nTable QR URLs (APP_BASE_URL=%s):", process.env.APP_BASE_URL ?? "http://localhost:3000");
  for (const t of tables.slice(0, 3)) console.log(`  ${t.label}: ${qrUrlFor(t.qrToken)}`);
  console.log("  … run `npm run qr:print` for all tables and PNG files.\n");
  const counts = await Promise.all([prisma.menuItem.count(), prisma.order.count(), prisma.restaurantTable.count()]);
  console.log(`Seeded ${counts[0]} menu items, ${counts[2]} tables, ${counts[1]} demo orders.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

export type { Prisma };
