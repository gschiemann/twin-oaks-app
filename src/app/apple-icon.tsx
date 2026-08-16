import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS applies its own squircle mask and drops any alpha to black, so this one
// fills the full square with the cream ground — no rounded corners, no
// transparency — and carries the deep-green serif monogram.
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
          background: "#faf7f0",
          color: "#324331",
          fontFamily: "Georgia, serif",
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
