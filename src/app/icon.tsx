import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// Generated rather than a checked-in PNG so the mark can never drift from the
// one in AppHeader — same oak-700 square, same "TO", just scaled to 512.
export default async function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 96,
          background: "#2f5233",
          color: "#ffffff",
          fontSize: 240,
          fontWeight: 700,
          letterSpacing: -8,
        }}
      >
        TO
      </div>
    ),
    { ...size },
  );
}
