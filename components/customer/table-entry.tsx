"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { normalizePhone } from "@/lib/security/phone";
import { useI18n } from "@/components/shared/i18n-provider";
import { useCustomerSession } from "@/components/customer/session-provider";
import { LanguageSwitch, OfflineBanner } from "@/components/customer/shell";
import { Button, ErrorNotice, Skeleton, Spinner } from "@/components/shared/ui";

interface QrResult {
  table: { label: string; name: string };
  restaurant: { name: string; phoneCountryCode: string; isDemo: boolean };
}

export function TableEntry({ token }: { token: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { session, status, refresh } = useCustomerSession();
  const [qr, setQr] = useState<QrResult | null>(null);
  const [qrError, setQrError] = useState<ApiClientError | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string; privacy?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<QrResult>("/api/v1/public/qr", { body: { token } })
      .then(setQr)
      .catch((e) => setQrError(e instanceof ApiClientError ? e : new ApiClientError(0, "UNKNOWN", String(e))));
  }, [token]);

  // Already registered at this same table during this visit → straight to the menu.
  useEffect(() => {
    if (qr && status === "ok" && session?.table.label === qr.table.label) router.replace("/menu");
  }, [qr, status, session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof fieldErrors = {};
    if (!name.trim()) errs.name = t("register.name");
    const p = normalizePhone(phone, qr?.restaurant.phoneCountryCode ?? "91");
    if (!p.ok) errs.phone = p.error;
    if (!privacy) errs.privacy = t("register.privacyRequired");
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api("/api/v1/customer/session", {
        body: { qrToken: token, name: name.trim(), phone, privacyConsent: true, marketingConsent: marketing, language: locale },
      });
      await refresh();
      router.replace("/menu");
    } catch (err) {
      setSubmitError(err instanceof ApiClientError ? (err.isNetwork ? t("common.offline") : err.message) : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-cream">
      <OfflineBanner />
      <div className="flex justify-end p-4">
        <LanguageSwitch />
      </div>
      <div className="flex-1 px-5 pb-10">
        {!qr && !qrError && (
          <div className="flex flex-col items-center gap-4 py-20 text-center" role="status">
            <Spinner className="h-8 w-8 text-brand-600" />
            <p className="text-muted">{t("qr.checking")}</p>
          </div>
        )}

        {qrError && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="grid h-20 w-20 place-items-center rounded-3xl bg-red-50 text-4xl" aria-hidden>
              🔒
            </div>
            <h1 className="font-display text-2xl font-semibold">{t("qr.invalidTitle")}</h1>
            <p className="text-sm text-muted">{qrError.isNetwork ? t("common.offline") : qrError.message}</p>
            <p className="text-sm text-muted">{t("qr.help")}</p>
          </div>
        )}

        {qr && (
          <>
            <div className="mb-6 overflow-hidden rounded-3xl bg-brand-700 p-6 text-white shadow-lift">
              <p className="text-sm text-brand-100">{t("qr.welcome", { restaurant: qr.restaurant.name })}</p>
              <h1 className="mt-1 font-display text-3xl font-semibold">{t("qr.table", { table: qr.table.name })}</h1>
              {qr.restaurant.isDemo && <p className="mt-3 inline-block rounded-full bg-white/15 px-2 py-0.5 text-xs">{t("common.demo")}</p>}
            </div>
            {status === "loading" ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <form onSubmit={submit} noValidate className="space-y-5 rounded-3xl bg-white p-5 shadow-soft">
                <div>
                  <h2 className="font-display text-xl font-semibold">{t("register.title")}</h2>
                  <p className="mt-1 text-sm text-muted">{t("register.subtitle")}</p>
                </div>
                <label className="block">
                  <span className="text-sm font-semibold">{t("register.name")}</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="given-name"
                    maxLength={60}
                    aria-invalid={!!fieldErrors.name}
                    className="mt-1 h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                  />
                  {fieldErrors.name && <span className="mt-1 block text-xs text-red-700">{fieldErrors.name}</span>}
                </label>
                <label className="block">
                  <span className="text-sm font-semibold">{t("register.phone")}</span>
                  <div className="mt-1 flex h-12 items-stretch overflow-hidden rounded-xl border border-stone-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-200">
                    <span className="grid place-items-center bg-sand px-3 text-sm font-semibold text-muted">+{qr.restaurant.phoneCountryCode}</span>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="tel"
                      autoComplete="tel-national"
                      maxLength={16}
                      aria-invalid={!!fieldErrors.phone}
                      aria-describedby="phone-hint"
                      className="w-full px-3 text-base tracking-wide outline-none"
                    />
                  </div>
                  <span id="phone-hint" className="mt-1 block text-xs text-muted">
                    {t("register.phoneHint")}
                  </span>
                  {fieldErrors.phone && <span className="mt-1 block text-xs text-red-700">{fieldErrors.phone}</span>}
                </label>
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 h-5 w-5 accent-brand-600" aria-invalid={!!fieldErrors.privacy} />
                  <span>{t("register.privacy")}</span>
                </label>
                {fieldErrors.privacy && <span className="-mt-3 block text-xs text-red-700">{fieldErrors.privacy}</span>}
                <label className="flex items-start gap-3 text-sm text-muted">
                  <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="mt-0.5 h-5 w-5 accent-brand-600" />
                  <span>{t("register.marketing")}</span>
                </label>
                {submitError && <ErrorNotice message={submitError} />}
                <Button type="submit" size="lg" className="w-full" loading={submitting}>
                  {t("register.submit")}
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
