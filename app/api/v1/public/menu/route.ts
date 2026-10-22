import { NextResponse } from "next/server";
import { z } from "zod";
import { publicRoute } from "@/lib/http/route";
import { getPublicMenu } from "@/lib/menu/service";

export const dynamic = "force-dynamic";

/** GET /api/v1/public/menu?lang=en|hi — public menu (no personal data; safe for the SW cache). */
export const GET = publicRoute({ query: z.object({ lang: z.enum(["en", "hi"]).default("en") }) }, async ({ query }) => {
  const menu = await getPublicMenu(query.lang);
  return NextResponse.json(menu, { headers: { "Cache-Control": "public, max-age=0, must-revalidate", "X-Public-Content": "menu" } });
});
