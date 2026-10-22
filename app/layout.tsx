import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SwRegister } from "@/components/shared/sw-register";

export const metadata: Metadata = {
  title: { default: "Table Ordering", template: "%s · Table Ordering" },
  description: "Scan, order and track your food from your table.",
  applicationName: "Table Ordering",
  appleWebApp: { capable: true, title: "Table Ordering", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192" }], apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#b4532a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
