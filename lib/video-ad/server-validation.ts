import { MAX_VIDEO_SECONDS, OUTPUT_FPS, OUTPUT_RATIOS, type AspectMode, type GraphicItem, type OutputRatio, type TextItem, type VideoMetadata } from "./types";
import { getGraphicItemErrors, getItemErrors, validateEditorPayload } from "./validation";

const positions = new Set(["top", "center", "bottom"]);
const motions = new Set(["none", "pop", "slide-up", "fade"]);
const outputRatios = new Set(Object.keys(OUTPUT_RATIOS));

export class PayloadValidationError extends Error {}

export const parseRenderSettings = (
  value: unknown,
  metadata: VideoMetadata,
  allowSequenceDuration = false,
): { items: TextItem[]; graphics: GraphicItem[]; aspectMode: AspectMode; outputRatio: OutputRatio } => {
  if (!value || typeof value !== "object") {
    throw new PayloadValidationError("렌더링 설정을 읽을 수 없습니다.");
  }
  const body = value as Record<string, unknown>;
  if (body.aspectMode !== "cover" && body.aspectMode !== "contain") {
    throw new PayloadValidationError("출력 맞춤 방식을 선택해 주세요.");
  }
  if (typeof body.outputRatio !== "string" || !outputRatios.has(body.outputRatio)) {
    throw new PayloadValidationError("영상 비율을 선택해 주세요.");
  }
  if (!Array.isArray(body.items)) {
    throw new PayloadValidationError("광고 문구 목록을 읽을 수 없습니다.");
  }

  const items = body.items.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new PayloadValidationError(`${index + 1}번 문구 설정이 잘못되었습니다.`);
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.text !== "string" ||
      typeof item.start !== "number" ||
      typeof item.end !== "number" ||
      typeof item.fontSize !== "number" ||
      typeof item.color !== "string" ||
      typeof item.strokeColor !== "string" ||
      typeof item.strokeWidth !== "number" ||
      typeof item.shadow !== "boolean" ||
      typeof item.position !== "string" ||
      !positions.has(item.position) ||
      typeof item.motion !== "string" ||
      !motions.has(item.motion)
    ) {
      throw new PayloadValidationError(`${index + 1}번 문구 설정이 잘못되었습니다.`);
    }
    return {
      id: item.id.slice(0, 80),
      text: item.text,
      start: item.start,
      end: item.end,
      position: item.position as TextItem["position"],
      fontSize: item.fontSize,
      color: item.color,
      strokeColor: item.strokeColor,
      strokeWidth: item.strokeWidth,
      shadow: item.shadow,
      motion: item.motion as TextItem["motion"],
    };
  });

  const graphicEntries = body.graphics ?? [];
  if (!Array.isArray(graphicEntries)) {
    throw new PayloadValidationError("PNG 카피 목록을 읽을 수 없습니다.");
  }
  const graphics = graphicEntries.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new PayloadValidationError(`PNG 카피 ${index + 1}번 설정이 잘못되었습니다.`);
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.graphicId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(item.graphicId) ||
      typeof item.sourceUrl !== "string" ||
      typeof item.originalName !== "string" ||
      typeof item.intrinsicWidth !== "number" ||
      typeof item.intrinsicHeight !== "number" ||
      typeof item.start !== "number" ||
      typeof item.end !== "number" ||
      typeof item.xPercent !== "number" ||
      typeof item.yPercent !== "number" ||
      typeof item.widthPercent !== "number" ||
      typeof item.shadow !== "boolean" ||
      typeof item.motion !== "string" ||
      !motions.has(item.motion)
    ) {
      throw new PayloadValidationError(`PNG 카피 ${index + 1}번 설정이 잘못되었습니다.`);
    }
    return {
      id: item.id.slice(0, 80),
      graphicId: item.graphicId,
      sourceUrl: `/api/video-ad/graphics/${item.graphicId}`,
      originalName: item.originalName.slice(0, 200),
      intrinsicWidth: item.intrinsicWidth,
      intrinsicHeight: item.intrinsicHeight,
      start: item.start,
      end: item.end,
      xPercent: item.xPercent,
      yPercent: item.yPercent,
      widthPercent: item.widthPercent,
      shadow: item.shadow,
      motion: item.motion as GraphicItem["motion"],
    };
  });

  const errors = validateEditorPayload(items, metadata, graphics, allowSequenceDuration ? null : undefined);
  if (errors.length) throw new PayloadValidationError(errors.join("\n"));
  return { items, graphics, aspectMode: body.aspectMode, outputRatio: body.outputRatio as OutputRatio };
};

export type SequenceRenderClip = {
  id: string;
  assetId: string;
  metadata: VideoMetadata;
};

const parseMetadata = (value: unknown, index: number): VideoMetadata => {
  if (!value || typeof value !== "object") {
    throw new PayloadValidationError(`${index + 1}번 컷의 영상 정보를 읽을 수 없습니다.`);
  }
  const metadata = value as Record<string, unknown>;
  if (
    typeof metadata.duration !== "number" || !Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > MAX_VIDEO_SECONDS + 0.0001 ||
    typeof metadata.width !== "number" || !Number.isFinite(metadata.width) || metadata.width <= 0 ||
    typeof metadata.height !== "number" || !Number.isFinite(metadata.height) || metadata.height <= 0 ||
    typeof metadata.fps !== "number" || !Number.isFinite(metadata.fps) || metadata.fps <= 0 ||
    typeof metadata.hasAudio !== "boolean"
  ) {
    throw new PayloadValidationError(`${index + 1}번 컷의 영상 정보가 올바르지 않습니다.`);
  }
  return {
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    hasAudio: metadata.hasAudio,
  };
};

export const parseSequenceRenderSettings = (value: unknown) => {
  if (!value || typeof value !== "object") {
    throw new PayloadValidationError("렌더링 설정을 읽을 수 없습니다.");
  }
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.clips) || body.clips.length === 0) {
    throw new PayloadValidationError("렌더링할 영상 컷을 한 개 이상 추가해 주세요.");
  }
  if (body.clips.length > 20) {
    throw new PayloadValidationError("영상 컷은 최대 20개까지 렌더링할 수 있습니다.");
  }
  const clips: SequenceRenderClip[] = body.clips.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new PayloadValidationError(`${index + 1}번 컷 설정이 잘못되었습니다.`);
    }
    const clip = entry as Record<string, unknown>;
    if (
      typeof clip.id !== "string" ||
      typeof clip.assetId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(clip.assetId)
    ) {
      throw new PayloadValidationError(`${index + 1}번 컷 설정이 잘못되었습니다.`);
    }
    return {
      id: clip.id.slice(0, 80),
      assetId: clip.assetId,
      metadata: parseMetadata(clip.metadata, index),
    };
  });
  const totalFrames = clips.reduce(
    (sum, clip) => sum + Math.max(1, Math.round(clip.metadata.duration * OUTPUT_FPS)),
    0,
  );
  const totalDuration = totalFrames / OUTPUT_FPS;
  const syntheticMetadata: VideoMetadata = {
    duration: totalDuration,
    width: clips[0].metadata.width,
    height: clips[0].metadata.height,
    fps: OUTPUT_FPS,
    hasAudio: clips.some((clip) => clip.metadata.hasAudio),
  };
  const parsed = parseRenderSettings(body, syntheticMetadata, true);
  const items = parsed.items.map((item) => ({ ...item, end: Math.min(item.end, totalDuration) }));
  const graphics = parsed.graphics.map((item) => ({ ...item, end: Math.min(item.end, totalDuration) }));
  const errors: string[] = [];
  items.forEach((item, index) => getItemErrors(item, totalDuration).forEach((error) => errors.push(`${index + 1}번 문구: ${error}`)));
  graphics.forEach((item, index) => getGraphicItemErrors(item, totalDuration).forEach((error) => errors.push(`PNG 카피 ${index + 1}번: ${error}`)));
  if (errors.length) throw new PayloadValidationError(errors.join("\n"));
  return { ...parsed, clips, items, graphics, totalDuration };
};
