import { z } from "zod";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { listBills } from "@/lib/payments/service";
import { getRestaurantConfig } from "@/lib/settings";

export const GET = staffRoute(
  { permission: PERMISSIONS.BILL_VIEW, query: z.object({ filter: z.enum(["outstanding", "paid", "all"]).default("outstanding"), q: z.string().trim().max(40).optional() }) },
  async ({ query }) => {
    const { settings } = await getRestaurantConfig();
    return { bills: await listBills(query.filter, query.q), acceptedMethods: settings.acceptedPaymentMethods };
  },
);
