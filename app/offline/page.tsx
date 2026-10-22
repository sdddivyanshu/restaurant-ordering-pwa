export const metadata = { title: "Offline" };
export const dynamic = "force-static";

/** Pre-cached by the service worker and shown when a navigation fails offline. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-5xl" aria-hidden>
        📶
      </div>
      <h1 className="font-display text-2xl font-semibold">You&apos;re offline</h1>
      <p className="text-sm text-muted">Check your connection. Your order status will refresh when you&apos;re back online. Orders are never placed while offline.</p>
      <p className="text-sm text-muted" lang="hi">
        आप ऑफ़लाइन हैं। ऑनलाइन होने पर ऑर्डर की स्थिति अपडेट होगी। ऑफ़लाइन रहते हुए कभी ऑर्डर नहीं होता।
      </p>
      {/* A full navigation (not client routing) is intended: it re-checks connectivity via the network. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/orders" className="mt-2 rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white">
        Retry
      </a>
    </main>
  );
}
