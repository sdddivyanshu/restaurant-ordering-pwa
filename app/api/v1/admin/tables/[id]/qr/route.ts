import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/http/errors";
import { qrPng } from "@/lib/tables/service";

/** GET — print-ready PNG of the table's QR code (?download=1 to save as a file). */
export const GET = staffRoute({ permission: PERMISSIONS.TABLE_MANAGE }, async ({ params, req }) => {
  const table = await prisma.restaurantTable.findUnique({ where: { id: params.id } });
  if (!table?.qrToken) throw notFound("This table has no active QR code");
  const png = await qrPng(table.qrToken, 1000);
  const download = req.nextUrl.searchParams.get("download") === "1";
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      ...(download && { "Content-Disposition": `attachment; filename="table-${table.label}-qr.png"` }),
    },
  });
});
