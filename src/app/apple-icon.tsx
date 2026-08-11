import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS applies its own squircle mask and drops any alpha to black, so this one
// fills the full square with green — no rounded corners, no transparency.
export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2f5233",
          color: "#ffffff",
          fontSize: 84,
          fontWeight: 700,
          letterSpacing: -3,
        }}
      >
        TO
      </div>
    ),
    { ...size },
  );
}
