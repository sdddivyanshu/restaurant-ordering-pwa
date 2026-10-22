// Time/season availability rules (pure).

export function localHHMM(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h === "24" ? "00" : h}:${m}`;
}

/** Is `now` inside [from, to)? Supports overnight windows such as 22:00–02:00. */
export function inDailyWindow(from: string | null | undefined, to: string | null | undefined, now: Date, timeZone: string): boolean {
  if (!from || !to) return true;
  const t = localHHMM(now, timeZone);
  return from <= to ? t >= from && t < to : t >= from || t < to;
}

export type UnavailableReason = "ARCHIVED" | "UNAVAILABLE" | "OUT_OF_HOURS" | "OUT_OF_SEASON" | "CATEGORY_INACTIVE";

export interface AvailabilityInput {
  isAvailable: boolean;
  archivedAt?: Date | null;
  availableFrom?: string | null;
  availableTo?: string | null;
  seasonalFrom?: Date | null;
  seasonalTo?: Date | null;
  category?: { isActive: boolean; archivedAt?: Date | null; availableFrom?: string | null; availableTo?: string | null } | null;
}

export function unavailableReason(item: AvailabilityInput, now: Date, timeZone: string): UnavailableReason | null {
  if (item.archivedAt) return "ARCHIVED";
  if (item.category && (!item.category.isActive || item.category.archivedAt)) return "CATEGORY_INACTIVE";
  if (!item.isAvailable) return "UNAVAILABLE";
  if (item.seasonalFrom && now < item.seasonalFrom) return "OUT_OF_SEASON";
  if (item.seasonalTo && now > item.seasonalTo) return "OUT_OF_SEASON";
  if (!inDailyWindow(item.availableFrom, item.availableTo, now, timeZone)) return "OUT_OF_HOURS";
  if (item.category && !inDailyWindow(item.category.availableFrom, item.category.availableTo, now, timeZone)) return "OUT_OF_HOURS";
  return null;
}
