import { prisma, type Tx } from "@/lib/db/prisma";
import { otpMode } from "@/lib/env";

export async function getRestaurantConfig(db: Tx | typeof prisma = prisma) {
  const restaurant = await db.restaurant.findFirst({ include: { settings: true }, orderBy: { createdAt: "asc" } });
  if (!restaurant || !restaurant.settings) {
    throw new Error("Restaurant is not configured. Run `npm run db:seed` (development) or create the restaurant record.");
  }
  return { restaurant, settings: restaurant.settings };
}

export type RestaurantConfig = Awaited<ReturnType<typeof getRestaurantConfig>>;

/** Public, non-sensitive configuration the customer app needs. */
export async function getPublicConfig() {
  const { restaurant, settings } = await getRestaurantConfig();
  return {
    name: restaurant.name,
    currency: restaurant.currency,
    currencySymbol: restaurant.currencySymbol,
    defaultLanguage: restaurant.defaultLanguage,
    supportedLanguages: restaurant.supportedLanguages,
    brandColor: restaurant.brandColor,
    pricesIncludeTax: settings.pricesIncludeTax,
    phoneCountryCode: settings.phoneCountryCode,
    privacyNoticeVersion: settings.privacyNoticeVersion,
    loyaltyEnabled: settings.loyaltyEnabled,
    otpMode: otpMode(),
    isDemo: restaurant.isDemo,
  };
}
