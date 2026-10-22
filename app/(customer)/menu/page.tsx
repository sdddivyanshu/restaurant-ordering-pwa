import { CustomerShell, RequireSession } from "@/components/customer/shell";
import { MenuView } from "@/components/customer/menu-view";

export const metadata = { title: "Menu" };

export default function MenuPage() {
  return (
    <CustomerShell>
      <RequireSession>
        <MenuView />
      </RequireSession>
    </CustomerShell>
  );
}
