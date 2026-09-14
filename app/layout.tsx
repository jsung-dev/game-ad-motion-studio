import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6d28d9",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: {
    default: "게임 광고 영상 스튜디오",
    template: "%s | 게임 광고 영상 스튜디오",
  },
  description: "MP4에 텍스트와 PNG 카피 모션을 합성해 광고 영상을 제작합니다.",
  openGraph: {
    title: "게임 광고 영상 스튜디오",
    description: "영상 업로드부터 모션 카피 합성, MP4 출력까지 한 번에.",
    type: "website",
    locale: "ko_KR",
    siteName: "게임 광고 영상 스튜디오",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "게임 광고 영상 스튜디오" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "게임 광고 영상 스튜디오",
    description: "MP4에 텍스트와 PNG 카피 모션을 합성해 광고 영상을 제작합니다.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="/fonts/noto-sans-kr-900.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
