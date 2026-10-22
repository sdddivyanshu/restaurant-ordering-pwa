import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <div className="grid h-24 w-24 place-items-center rounded-[28px] bg-brand-600 text-5xl shadow-lift" aria-hidden>
        🍽️
      </div>
      <div className="space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Order from your table</h1>
        <p className="text-muted">Scan the QR code on your table to see the menu and order. No app or password needed.</p>
        <p className="text-muted" lang="hi">
          मेन्यू देखने और ऑर्डर करने के लिए अपनी टेबल का QR कोड स्कैन करें।
        </p>
      </div>
      <div className="w-full rounded-3xl border border-stone-200 bg-white p-5 text-left text-sm shadow-soft">
        <ol className="space-y-2">
          <li>1. Scan the code on your table</li>
          <li>2. Add your name and mobile number</li>
          <li>3. Order — staff confirm it before it goes to the kitchen</li>
          <li>4. Track it live until it&apos;s served</li>
        </ol>
      </div>
      <Link href="/staff/login" className="text-sm font-semibold text-brand-700 underline underline-offset-4">
        Staff sign in
      </Link>
    </main>
  );
}
