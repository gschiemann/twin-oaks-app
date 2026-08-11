"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "twinoaks-install-hint";

// One-time nudge to install the app on iOS — Safari has no install prompt API,
// so the Share → Add to Home Screen path has to be taught by hand.
export default function InstallHint() {
  // Starts false and only flips in the effect: localStorage and display-mode are
  // browser-only, so reading them during render would mismatch the server pass.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "dismissed") return;
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari predates display-mode and reports standalone on navigator.
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (!installed) setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "dismissed");
    setShow(false);
  }

  return (
    <div className="mb-4 flex items-start gap-2 rounded-2xl border border-oak-200 bg-oak-50 p-3 text-sm text-oak-900">
      <p className="min-w-0 flex-1">
        Add Twin Oaks to your home screen — tap Share, then &apos;Add to Home Screen&apos;.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-base leading-none text-oak-700/60 active:bg-oak-100"
      >
        ×
      </button>
    </div>
  );
}
