import { CustomerShell, RequireSession } from "@/components/customer/shell";
import { CartView } from "@/components/customer/cart-view";

export const metadata = { title: "Cart" };

export default function CartPage() {
  return (
    <CustomerShell>
      <RequireSession>
        <CartView />
      </RequireSession>
    </CustomerShell>
  );
}
