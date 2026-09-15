import type { Metadata } from "next";
import { LocalCutEditor } from "@/components/cut-editor/LocalCutEditor";

export const metadata: Metadata = {
  title: "로컬 컷 조립 테스트",
  description: "여러 로컬 MP4 컷과 PNG 오버레이를 조립하는 브라우저 테스트 편집기",
};

export default function CutEditorTestPage() {
  return <LocalCutEditor />;
}
