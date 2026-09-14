import { OUTPUT_RATIOS, type AspectMode, type GraphicItem, type OutputRatio, type TextItem, type VideoMetadata } from "./types";
import { validateEditorPayload } from "./validation";

const positions = new Set(["top", "center", "bottom"]);
const motions = new Set(["none", "pop", "slide-up", "fade"]);
const outputRatios = new Set(Object.keys(OUTPUT_RATIOS));

export class PayloadValidationError extends Error {}

export const parseRenderSettings = (
  value: unknown,
  metadata: VideoMetadata,
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

  const errors = validateEditorPayload(items, metadata, graphics);
  if (errors.length) throw new PayloadValidationError(errors.join("\n"));
  return { items, graphics, aspectMode: body.aspectMode, outputRatio: body.outputRatio as OutputRatio };
};
