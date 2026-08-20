import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import { currentAccountId, OWNER_ACCOUNT_ID } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/business";
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
  themeColor: "#324331",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Self-heal the database schema before any page queries run (memoized;
  // never throws — pages surface a friendly diagnostic if the DB is down).
  await ensureSchema();

  // Non-owner accounts see their own business name in the header instead of
  // the Twin Oaks lockup. Never throws — chrome must render even if the
  // database is down (brandName just stays null → default logo).
  let brandName: string | null = null;
  try {
    const accountId = await currentAccountId();
    if (accountId && accountId !== OWNER_ACCOUNT_ID) {
      brandName = (await getBusinessProfile(accountId)).name;
    }
  } catch {
    brandName = null;
  }

  return (
    <html lang="en">
      <body className="min-h-screen bg-oak-50 text-[#2f2b25] antialiased">
        <AppHeader brandName={brandName} />
        <main className="mx-auto max-w-2xl px-4 pt-4 pb-32 print:max-w-none print:p-0">{children}</main>
        <div className="print:hidden">
          <BottomNav />
        </div>
      </body>
    </html>
  );
}
