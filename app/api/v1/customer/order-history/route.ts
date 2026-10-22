import { z } from "zod";
import { customerRoute } from "@/lib/http/route";
import { listOrderHistory } from "@/lib/orders/history";

export const GET = customerRoute({ query: z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) }) }, async ({ customer, query }) =>
  listOrderHistory(customer, query.page),
);
