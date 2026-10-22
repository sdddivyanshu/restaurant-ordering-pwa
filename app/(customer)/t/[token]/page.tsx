import { TableEntry } from "@/components/customer/table-entry";

export const metadata = { title: "Welcome" };

export default async function TablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TableEntry token={token} />;
}
