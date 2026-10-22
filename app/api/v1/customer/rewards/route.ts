import { customerRoute } from "@/lib/http/route";
import { getCustomerLoyalty } from "@/lib/loyalty/service";

/** GET — rewards catalogue for everyone; balance and ledger only for phone-verified sessions. */
export const GET = customerRoute({}, async ({ customer }) => getCustomerLoyalty(customer, customer.language));
