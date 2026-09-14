import { MAX_VIDEO_SECONDS, OUTPUT_FPS, type GraphicItem, type TextItem, type VideoMetadata } from "./types";

const COLORS = /^#[0-9a-fA-F]{6}$/;

export const getDurationInFrames = (duration: number) =>
  Math.max(1, Math.round(duration * OUTPUT_FPS));

const getTimingErrors = (start: number, end: number, duration: number): string[] => {
  const errors: string[] = [];
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    errors.push("시작·종료 시간은 숫자로 입력해 주세요.");
  } else {
    if (start < 0) errors.push("시작 시간은 0초 이상이어야 합니다.");
    if (start >= end) errors.push("시작 시간은 종료 시간보다 앞서야 합니다.");
    if (end > duration + 0.0001) errors.push("종료 시간이 영상 길이를 벗어났습니다.");
    if (Math.round(end * OUTPUT_FPS) <= Math.round(start * OUTPUT_FPS)) {
      errors.push("표시 구간은 최소 1프레임 이상이어야 합니다.");
    }
  }
  return errors;
};

export const getItemErrors = (item: TextItem, duration: number): string[] => {
  const errors = getTimingErrors(item.start, item.end, duration);
  if (!item.text.trim()) errors.push("문구를 입력해 주세요.");
  if (item.text.length > 180) errors.push("문구는 180자 이하로 입력해 주세요.");
  if (!Number.isFinite(item.fontSize) || item.fontSize < 24 || item.fontSize > 140) {
    errors.push("글자 크기는 24~140px 사이여야 합니다.");
  }
  if (!Number.isFinite(item.strokeWidth) || item.strokeWidth < 0 || item.strokeWidth > 16) {
    errors.push("테두리 두께는 0~16px 사이여야 합니다.");
  }
  if (!COLORS.test(item.color) || !COLORS.test(item.strokeColor)) {
    errors.push("색상은 6자리 HEX 색상이어야 합니다.");
  }
  return errors;
};

export const getGraphicItemErrors = (item: GraphicItem, duration: number): string[] => {
  const errors = getTimingErrors(item.start, item.end, duration);
  if (!item.graphicId || !item.sourceUrl) errors.push("PNG 파일을 다시 업로드해 주세요.");
  if (!Number.isFinite(item.xPercent) || item.xPercent < 0 || item.xPercent > 100) {
    errors.push("가로 위치는 0~100% 사이여야 합니다.");
  }
  if (!Number.isFinite(item.yPercent) || item.yPercent < 0 || item.yPercent > 100) {
    errors.push("세로 위치는 0~100% 사이여야 합니다.");
  }
  if (!Number.isFinite(item.widthPercent) || item.widthPercent < 5 || item.widthPercent > 100) {
    errors.push("PNG 크기는 화면 너비의 5~100% 사이여야 합니다.");
  }
  return errors;
};

export const validateEditorPayload = (
  items: TextItem[],
  metadata: VideoMetadata,
  graphics: GraphicItem[] = [],
): string[] => {
  const errors: string[] = [];
  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
    errors.push("영상 길이를 읽을 수 없습니다.");
  }
  if (metadata.duration > MAX_VIDEO_SECONDS + 0.0001) {
    errors.push(`영상은 최대 ${MAX_VIDEO_SECONDS}초까지 지원합니다.`);
  }
  if (items.length > 20) errors.push("문구는 최대 20개까지 추가할 수 있습니다.");
  if (graphics.length > 10) errors.push("PNG 카피는 최대 10개까지 추가할 수 있습니다.");

  items.forEach((item, index) => {
    getItemErrors(item, metadata.duration).forEach((error) =>
      errors.push(`${index + 1}번 문구: ${error}`),
    );
  });
  graphics.forEach((item, index) => {
    getGraphicItemErrors(item, metadata.duration).forEach((error) =>
      errors.push(`PNG 카피 ${index + 1}번: ${error}`),
    );
  });
  return errors;
};
