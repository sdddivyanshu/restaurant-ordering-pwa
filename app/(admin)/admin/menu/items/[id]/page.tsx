import { AdminGate } from "@/components/admin/gate";
import { ItemEditor } from "@/components/admin/item-editor";

export const metadata = { title: "Edit dish" };

export default async function ItemEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminGate perms={["menu.manage"]}>{() => <ItemEditor id={id === "new" ? null : id} />}</AdminGate>;
}
