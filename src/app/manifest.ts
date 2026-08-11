import type { MetadataRoute } from "next";

// Next serves this at /manifest.webmanifest and injects the <link rel="manifest">
// itself — layout.tsx stays untouched. theme_color mirrors viewport.themeColor
// there (oak-700) so the installed app's status bar matches the header.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Twin Oaks OS",
    short_name: "Twin Oaks",
    description: "Receipts, expenses, invoices and equipment for Twin Oaks Farm & Tech LLC.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f4",
    theme_color: "#2f5233",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
