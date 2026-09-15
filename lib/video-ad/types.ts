export const OUTPUT_WIDTH = 720;
export const OUTPUT_HEIGHT = 1280;
export const OUTPUT_FPS = 30;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const CLOUD_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 30;
export const MAX_GRAPHIC_BYTES = 10 * 1024 * 1024;

export type TextPosition = "top" | "center" | "bottom";
export type MotionPreset = "none" | "pop" | "slide-up" | "fade";
export type AspectMode = "cover" | "contain";
export type OutputRatio = "1:1" | "21:9" | "16:9" | "4:3" | "3:4" | "9:16";

export const OUTPUT_RATIOS: Record<OutputRatio, { width: number; height: number }> = {
  "1:1": { width: 720, height: 720 },
  "21:9": { width: 1260, height: 540 },
  "16:9": { width: 1280, height: 720 },
  "4:3": { width: 960, height: 720 },
  "3:4": { width: 720, height: 960 },
  "9:16": { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
};

export const DEFAULT_OUTPUT_RATIO: OutputRatio = "9:16";
export const getOutputDimensions = (ratio: OutputRatio) => OUTPUT_RATIOS[ratio];

export type VideoMetadata = {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
};

export type TextItem = {
  id: string;
  text: string;
  start: number;
  end: number;
  position: TextPosition;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
  motion: MotionPreset;
};

export type GraphicAsset = {
  id: string;
  sourceUrl: string;
  originalName: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  createdAt: string;
};

export type GraphicItem = {
  id: string;
  graphicId: string;
  sourceUrl: string;
  originalName: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  start: number;
  end: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  shadow: boolean;
  motion: MotionPreset;
};

export type VideoAsset = {
  id: string;
  sourceUrl: string;
  originalName: string;
  metadata: VideoMetadata;
  createdAt: string;
};

export type VideoAdCompositionProps = {
  videoSrc: string;
  metadata: VideoMetadata;
  items: TextItem[];
  graphics: GraphicItem[];
  aspectMode: AspectMode;
  outputRatio: OutputRatio;
};

export type VideoAdSequenceClip = {
  id: string;
  videoSrc: string;
  metadata: VideoMetadata;
  durationInFrames: number;
  graphics: GraphicItem[];
};

export type VideoAdSequenceCompositionProps = {
  clips: VideoAdSequenceClip[];
  items: TextItem[];
  aspectMode: AspectMode;
  outputRatio: OutputRatio;
};

export type RenderJobStatus = "queued" | "rendering" | "completed" | "failed";

export type RenderJob = {
  id: string;
  status: RenderJobStatus;
  createdAt: string;
  updatedAt: string;
  assetId: string;
  origin: string;
  snapshot: {
    items: TextItem[];
    graphics?: GraphicItem[];
    aspectMode: AspectMode;
    outputRatio?: OutputRatio;
    metadata: VideoMetadata;
  };
  progress?: number;
  stage: string;
  error?: string;
  outputFile?: string;
  workerPid?: number;
};

export const createDefaultTextItem = (): TextItem => ({
  id: crypto.randomUUID(),
  text: "새 광고 문구",
  start: 0,
  end: 1,
  position: "center",
  fontSize: 68,
  color: "#FFFFFF",
  strokeColor: "#111827",
  strokeWidth: 5,
  shadow: true,
  motion: "pop",
});
