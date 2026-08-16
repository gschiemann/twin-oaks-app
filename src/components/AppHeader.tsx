"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchIcon } from "./Icons";

export default function AppHeader() {
  const pathname = usePathname();
  // No app chrome on the sign-in screen — it stands alone.
  if (pathname === "/login") return null;

  return (
    <header className="sticky top-0 z-30 border-b border-oak-200 bg-oak-50/95 backdrop-blur-sm print:hidden">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/twin-oaks-logo.png"
            alt="Twin Oaks Farm & Tech"
            className="h-9 w-auto"
          />
        </Link>
        <Link
          href="/search"
          aria-label="Search"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-600 active:bg-stone-100"
        >
          <SearchIcon className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}
