import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Only meaningful in local dev. On Vercel the platform caps a
      // serverless request body at ~4.5 MB no matter what is set here —
      // which is why receipt files go BROWSER → BLOB directly (see
      // src/components/ReceiptUploader.tsx) instead of through an action.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
