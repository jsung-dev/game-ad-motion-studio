import type { Metadata } from "next";
import { VideoAdEditor } from "@/components/video-ad/VideoAdEditor";

export const metadata: Metadata = {
  title: "게임 광고 영상 스튜디오",
  description: "MP4 위에 광고 문구와 모션을 합성해 다운로드합니다.",
};

export default function VideoAdPage() {
  return <VideoAdEditor />;
}
