import { AdminGate } from "@/components/admin/gate";
import { FeedbackAdmin } from "@/components/admin/lists-admin";

export const metadata = { title: "Feedback" };

export default function FeedbackPage() {
  return <AdminGate perms={["feedback.view"]}>{(p) => <FeedbackAdmin canResolve={p.includes("feedback.resolve")} />}</AdminGate>;
}
