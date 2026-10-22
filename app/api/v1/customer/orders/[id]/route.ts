import { customerRoute } from "@/lib/http/route";
import { orderVisibilityFilter } from "@/lib/auth/customer-session";
import { customerOrderView, loadFullOrder } from "@/lib/orders/views";
import { notFound } from "@/lib/http/errors";
import { getRestaurantConfig } from "@/lib/settings";
import { upiPaymentUri } from "@/lib/payments/provider";

/** GET — order status, items, bill. 404 for orders that do not belong to this customer. */
export const GET = customerRoute({}, async ({ customer, params }) => {
  const order = await loadFullOrder({ id: params.id, ...orderVisibilityFilter(customer) });
  if (!order) throw notFound("Order not found");
  const view = customerOrderView(order);
  const { restaurant, settings } = await getRestaurantConfig();
  const upi =
    settings.upiId && settings.acceptedPaymentMethods.includes("UPI_MANUAL") && view.bill.duePaise > 0 && ["SERVED", "READY", "PREPARING", "QUEUED", "APPROVED"].includes(view.status)
      ? { uri: upiPaymentUri({ upiId: settings.upiId, payeeName: settings.upiPayeeName ?? restaurant.name, amountPaise: view.bill.duePaise, note: view.reference }), upiId: settings.upiId }
      : null;
  return { order: view, upi, restaurant: { name: restaurant.name, address: restaurant.address, gstin: restaurant.gstin } };
});
