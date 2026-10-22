import { CustomerShell, RequireSession } from "@/components/customer/shell";
import { RewardsView } from "@/components/customer/rewards-view";

export const metadata = { title: "Rewards" };

export default function RewardsPage() {
  return (
    <CustomerShell>
      <RequireSession>
        <RewardsView />
      </RequireSession>
    </CustomerShell>
  );
}
