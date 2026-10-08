import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f2f0e8",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: {
    default: "ODD PLAY | 심리테스트와 미니게임",
    template: "%s | ODD PLAY",
  },
  description: "심리테스트, 연애, 밸런스 게임, 퀴즈와 미니게임을 한곳에서 즐겨보세요.",
  openGraph: {
    title: "ODD PLAY | 심리테스트와 미니게임",
    description: "짧지만 확실한 재미를 골라 즐기는 플레이 컬렉션.",
    type: "website",
    locale: "ko_KR",
    siteName: "ODD PLAY",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "ODD PLAY" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ODD PLAY | 심리테스트와 미니게임",
    description: "짧지만 확실한 재미를 골라 즐기는 플레이 컬렉션.",
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
