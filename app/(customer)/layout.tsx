import { cookies } from "next/headers";
import { I18nProvider } from "@/components/shared/i18n-provider";
import { CartProvider } from "@/components/customer/cart-provider";
import { CustomerSessionProvider } from "@/components/customer/session-provider";
import { isLocale } from "@/lib/i18n";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const lang = (await cookies()).get("rs_lang")?.value;
  return (
    <I18nProvider initialLocale={isLocale(lang) ? lang : "en"}>
      <CustomerSessionProvider>
        <CartProvider>{children}</CartProvider>
      </CustomerSessionProvider>
    </I18nProvider>
  );
}
