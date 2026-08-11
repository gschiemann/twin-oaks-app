import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import { ensureSchema } from "@/lib/ensure-schema";

export const metadata: Metadata = {
  title: "Twin Oaks OS",
  description:
    "The business operating system for Twin Oaks Farm & Tech LLC — receipts, expenses, equipment, and tax-ready records.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2f5233",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Self-heal the database schema before any page queries run (memoized;
  // never throws — pages surface a friendly diagnostic if the DB is down).
  await ensureSchema();

  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-100 text-stone-900 antialiased">
        <AppHeader />
        <main className="mx-auto max-w-2xl px-4 pt-4 pb-32 print:max-w-none print:p-0">{children}</main>
        <div className="print:hidden">
          <BottomNav />
        </div>
      </body>
    </html>
  );
}
