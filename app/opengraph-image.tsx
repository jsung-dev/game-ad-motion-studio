import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "게임 광고 영상 스튜디오";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 84px", color: "white", background: "linear-gradient(135deg, #18122b 0%, #5b21b6 58%, #7c3aed 100%)", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", fontSize: 27, color: "#ddd6fe", letterSpacing: 4 }}>AD MOTION LAB</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 800, letterSpacing: -4 }}>게임 광고 영상 스튜디오</div>
        <div style={{ display: "flex", fontSize: 32, color: "#ede9fe" }}>영상 위에 텍스트와 PNG 모션을 바로 합성하세요</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 24, color: "#ddd6fe" }}>MP4 · H.264 · 다양한 화면 비율</div>
        <div style={{ display: "flex", width: 78, height: 78, borderRadius: 22, alignItems: "center", justifyContent: "center", background: "#ffffff", color: "#6d28d9", fontSize: 38 }}>▶</div>
      </div>
    </div>,
    size,
  );
}
