import { CustomerShell, RequireSession } from "@/components/customer/shell";
import { ServiceView } from "@/components/customer/service-view";

export const metadata = { title: "Service" };

export default function ServicePage() {
  return (
    <CustomerShell>
      <RequireSession>
        <ServiceView />
      </RequireSession>
    </CustomerShell>
  );
}
