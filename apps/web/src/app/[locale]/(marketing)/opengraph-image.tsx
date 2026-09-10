import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "Heyloo — an AI receptionist that answers every call and books real appointments";

/**
 * Code-generated OG image for the marketing route group (DESIGN BRIEF:
 * "favicon/og image generated in code or SVG only" — no committed binary,
 * rendered at request time via `next/og`'s `ImageResponse`). Per-page
 * routes may override this with their own `opengraph-image` file; this is
 * the shared default (home, pricing, demo, legal, blog, verticals unless
 * they add a more specific one).
 */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        backgroundColor: "#0f0d0b",
        color: "#f6f1ec",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "#DD5A2C",
            display: "flex",
          }}
        />
        <span style={{ fontSize: 34, fontWeight: 700 }}>Heyloo</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 920 }}>
        <span style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1 }}>
          Every call answered. Every booking captured.
        </span>
        <span style={{ fontSize: 28, color: "#c9c0b8" }}>
          An AI receptionist for real businesses — disclosed AI, disclosed recording, every time.
        </span>
      </div>
    </div>,
    { ...size },
  );
}
