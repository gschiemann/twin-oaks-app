import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// Generated rather than a checked-in PNG. ImageResponse cannot read the local
// brand PNG, so this renders the brand's monogram instead: cream ground, deep
// forest-green serif "TO".
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
          background: "#faf7f0",
          color: "#324331",
          fontFamily: "Georgia, serif",
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
