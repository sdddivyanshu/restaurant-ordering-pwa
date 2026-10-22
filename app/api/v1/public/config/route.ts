import { publicRoute } from "@/lib/http/route";
import { getPublicConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = publicRoute({}, async () => getPublicConfig());
