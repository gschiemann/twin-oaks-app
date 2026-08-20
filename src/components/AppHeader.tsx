"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchIcon } from "./Icons";

// brandName: null for the owner account (Twin Oaks lockup renders), the
// business name for every other account.
export default function AppHeader({ brandName = null }: { brandName?: string | null }) {
  const pathname = usePathname();
  // No app chrome on the public screens — they stand alone.
  if (pathname === "/login" || pathname === "/signup") return null;

  return (
    <header className="sticky top-0 z-30 border-b border-oak-200 bg-oak-50/95 backdrop-blur-sm print:hidden">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          {brandName ? (
            <span className="display-serif truncate text-lg font-bold text-stone-900">
              {brandName}
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/brand/twin-oaks-logo.png"
              alt="Twin Oaks Farm & Tech"
              className="h-9 w-auto"
            />
          )}
        </Link>
        <Link
          href="/search"
          aria-label="Search"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-stone-600 active:bg-stone-100"
        >
          <SearchIcon className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}
