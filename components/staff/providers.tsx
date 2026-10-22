"use client";

import { I18nProvider } from "@/components/shared/i18n-provider";

/** Staff dashboards default to English; the i18n structure allows more languages later. */
export function StaffProviders({ children }: { children: React.ReactNode }) {
  return <I18nProvider initialLocale="en">{children}</I18nProvider>;
}
