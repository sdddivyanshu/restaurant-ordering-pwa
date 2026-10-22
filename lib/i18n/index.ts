import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof en;

const catalogs: Record<Locale, Record<string, string>> = { en, hi };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** Translate with {placeholder} interpolation; falls back to English, then to the key. */
export function translate(locale: Locale, key: MessageKey | string, vars?: Record<string, string | number>): string {
  const template = catalogs[locale]?.[key] ?? catalogs.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

/** Pick a translated value from a {locale: text} map with English fallback. */
export function pickI18n(map: unknown, locale: Locale, fallback: string): string {
  const m = (map ?? {}) as Record<string, string>;
  return m[locale]?.trim() || fallback;
}
