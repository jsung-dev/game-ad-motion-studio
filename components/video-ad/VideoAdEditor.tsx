"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { createClient } from "@supabase/supabase-js";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Download, Film, ImageIcon,
  Layers3, LoaderCircle, Maximize2, MonitorPlay, Pause, Play, Settings2,
  Plus, RefreshCw, SkipBack, SkipForward, Sparkles, Trash2, Type,
  UploadCloud, Volume2, VolumeX,
} from "lucide-react";
import {
  CLOUD_MAX_UPLOAD_BYTES, createDefaultTextItem, MAX_GRAPHIC_BYTES, MAX_UPLOAD_BYTES, OUTPUT_FPS, OUTPUT_RATIOS,
  type AspectMode, type GraphicAsset, type GraphicItem, type MotionPreset, type OutputRatio,
  type RenderJobStatus, type SeedanceModel, type TextItem, type TextPosition, type VideoAdSequenceClip, type VideoAsset,
} from "@/lib/video-ad/types";
import type { SeedanceAspectRatio, SeedanceResolution } from "@/lib/video-ad/magnific";
import { getDurationInFrames, getGraphicItemErrors, getItemErrors, validateEditorPayload } from "@/lib/video-ad/validation";
import { VideoAdSequenceComposition } from "@/remotion/AdComposition";
import styles from "./VideoAdStudio.module.css";

type JobView = {
  id: string;
  status: RenderJobStatus;
  stage: string;
  progress: number | null;
  error: string | null;
  downloadUrl: string | null;
};

type EditorClip = {
  id: string;
  asset: VideoAsset;
  fileSize: number;
  prompt: string;
  version: number;
  generationCardId?: string;
};

type ReferenceMedia =
  | { id: string; kind: "image"; asset: GraphicAsset }
  | { id: string; kind: "video"; asset: VideoAsset };

type GenerationView = {
  id: string;
  targetClipId: string | null;
  prompt: string;
  status: "generating" | "importing" | "completed" | "failed";
  stage: string;
  error: string | null;
  asset: VideoAsset | null;
  fileSize: number | null;
};

type GenerationCard = {
  id: string;
  prompt: string;
  model: SeedanceModel;
  aspectRatio: SeedanceAspectRatio;
  duration: number;
  resolution: SeedanceResolution;
  soundEffects: boolean;
  referenceImage: GraphicAsset | null;
  referenceMedia: ReferenceMedia[];
  job: GenerationView | null;
  error: string | null;
  referenceImageError: string | null;
  referenceMediaError: string | null;
  referenceImageUploading: boolean;
  referenceMediaUploading: boolean;
  isSubmitting: boolean;
  expanded: boolean;
};

type EditableTimelineTrack = "text" | "image";
type TimelineDragMode = "move" | "resize-start" | "resize-end";
type TimelineDrag = {
  pointerId: number;
  track: EditableTimelineTrack;
  id: string;
  mode: TimelineDragMode;
  originX: number;
  laneWidth: number;
  start: number;
  end: number;
};

type EditorMode = "video" | "captions" | "generate";
type WorkspaceView = "work" | "edit";

const LAST_JOB_KEY = "video-ad:last-job";
const LAST_GENERATION_KEY = "video-ad:last-generation";
const GENERATION_CARDS_KEY = "video-ad:generation-cards";
const GENERATION_CARD_LIMIT = 8;
const CLOUD_UPLOADS_ENABLED = process.env.NEXT_PUBLIC_VIDEO_STORAGE_MODE === "supabase";
const motions: Array<{ value: MotionPreset; label: string }> = [
  { value: "none", label: "모션 없음" },
  { value: "pop", label: "팝업" },
  { value: "slide-up", label: "슬라이드 업" },
  { value: "fade", label: "페이드" },
];
const positions: Array<{ value: TextPosition; label: string }> = [
  { value: "top", label: "상단" },
  { value: "center", label: "중앙" },
  { value: "bottom", label: "하단" },
];
const outputRatios: OutputRatio[] = ["1:1", "21:9", "16:9", "4:3", "3:4", "9:16"];
const seedanceAspectRatioOptions: Array<{
  value: SeedanceAspectRatio;
  label: string;
  visualRatio: string;
}> = [
  { value: "film_horizontal_21_9", label: "21:9", visualRatio: "21 / 9" },
  { value: "widescreen_16_9", label: "16:9", visualRatio: "16 / 9" },
  { value: "classic_4_3", label: "4:3", visualRatio: "4 / 3" },
  { value: "square_1_1", label: "1:1", visualRatio: "1 / 1" },
  { value: "traditional_3_4", label: "3:4", visualRatio: "3 / 4" },
  { value: "social_story_9_16", label: "9:16", visualRatio: "9 / 16" },
  { value: "film_vertical_9_21", label: "9:21", visualRatio: "9 / 21" },
];
const seedanceModelOptions: Record<SeedanceModel, {
  label: string;
  maxDuration: number;
  supportsReferenceMedia: boolean;
}> = {
  "seedance-2-pro": {
    label: "Seedance 2.0 Pro",
    maxDuration: 15,
    supportsReferenceMedia: false,
  },
  "seedance-2-5-pro": {
    label: "Seedance 2.5 Pro",
    maxDuration: 30,
    supportsReferenceMedia: true,
  },
};
const decodeUnicodeEscapes = (value: string) => value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

const createGenerationCard = (id: string, expanded = false): GenerationCard => ({
  id,
  prompt: "",
  model: "seedance-2-5-pro",
  aspectRatio: "social_story_9_16",
  duration: 5,
  resolution: "720p",
  soundEffects: true,
  referenceImage: null,
  referenceMedia: [],
  job: null,
  error: null,
  referenceImageError: null,
  referenceMediaError: null,
  referenceImageUploading: false,
  referenceMediaUploading: false,
  isSubmitting: false,
  expanded,
});

const isGenerationCardBusy = (card: GenerationCard) => (
  card.isSubmitting || card.job?.status === "generating" || card.job?.status === "importing"
);

const getGenerationCardReferenceError = (card: GenerationCard) => {
  const config = seedanceModelOptions[card.model];
  const imageCount = card.referenceMedia.filter((media) => media.kind === "image").length;
  const videoCount = card.referenceMedia.filter((media) => media.kind === "video").length;
  const videoDuration = card.referenceMedia.reduce(
    (total, media) => total + (media.kind === "video" ? media.asset.metadata.duration : 0),
    0,
  );
  if (card.duration > config.maxDuration) {
    return "\uD604\uC7AC \uBAA8\uB378\uC740 \uCD5C\uB300 " + config.maxDuration + "\uCD08\uAE4C\uC9C0 \uC0DD\uC131\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.";
  }
  if (card.referenceImage && card.referenceMedia.length) {
    return "\uC2DC\uC791 \uC774\uBBF8\uC9C0\uC640 \uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB294 \uD568\uAED8 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uD558\uB098\uB9CC \uB0A8\uACA8 \uC8FC\uC138\uC694.";
  }
  if (card.model === "seedance-2-pro" && card.referenceMedia.length) {
    return "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB294 Seedance 2.5 Pro\uC5D0\uC11C\uB9CC \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.";
  }
  if (imageCount > 30 || videoCount > 10) {
    return "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4 \uAC1C\uC218\uAC00 \uC81C\uD55C\uC744 \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4.";
  }
  if (videoDuration > 30.001) {
    return "\uB808\uD37C\uB7F0\uC2A4 \uC601\uC0C1\uC758 \uCD1D \uAE38\uC774\uB294 30\uCD08 \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.";
  }
  return null;
};

const generationStatusLabel = (card: GenerationCard) => {
  if (card.isSubmitting) return "\uC694\uCCAD \uC911";
  if (card.job?.status === "generating") return "\uC0DD\uC131 \uC911";
  if (card.job?.status === "importing") return "\uAC00\uC838\uC624\uB294 \uC911";
  if (card.job?.status === "completed") return "\uC644\uB8CC";
  if (card.job?.status === "failed") return "\uC2E4\uD328";
  return "\uC791\uC131 \uC911";
};

const timelineTracks = [
  { key: "video", label: "영상", icon: Film },
  { key: "image", label: "이미지", icon: ImageIcon },
  { key: "text", label: "텍스트", icon: Type },
  { key: "effect", label: "효과", icon: Sparkles },
] as const;

const formatTime = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
};

const responseJson = async <T,>(response: Response): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 413) {
      throw new Error("배포 서버의 업로드 한도를 넘었습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.");
    }
    throw new Error(body.error || "요청을 처리하지 못했습니다.");
  }
  return body;
};

const uploadToCloud = async <T,>(kind: "video" | "graphic", file: File): Promise<T> => {
  const signResponse = await fetch("/api/video-ad/cloud-uploads/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, fileName: file.name, size: file.size }),
  });
  const signed = await responseJson<{ id: string; bucket: string; path: string; token: string }>(signResponse);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("클라우드 업로드 설정을 확인해 주세요.");
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const contentType = kind === "video" ? "video/mp4" : "image/png";
  const { error } = await client.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType });
  if (error) throw new Error(`파일 전송에 실패했습니다: ${error.message}`);

  const finalizeResponse = await fetch("/api/video-ad/cloud-uploads/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, id: signed.id, originalName: file.name }),
  });
  return responseJson<T>(finalizeResponse);
};

const estimateOverflow = (item: TextItem) => {
  const charactersPerLine = Math.max(5, Math.floor(560 / (item.fontSize * 0.72)));
  const lines = item.text.split("\n").reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)),
    0,
  );
  return lines * item.fontSize * 1.17 > 400;
};

type GraphicPlacementPreviewProps = {
  item: GraphicItem;
  videoSrc: string;
  playbackActive: boolean;
  aspectMode: AspectMode;
  width: number;
  height: number;
  onPositionChange: (xPercent: number, yPercent: number) => void;
  onWidthChange: (widthPercent: number) => void;
};

function GraphicPlacementPreview({
  item,
  videoSrc,
  playbackActive,
  aspectMode,
  width,
  height,
  onPositionChange,
  onWidthChange,
}: GraphicPlacementPreviewProps) {
  const resizeRef = useRef<{ pointerId: number; startX: number; width: number } | null>(null);
  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const resize = resizeRef.current;
    if (resize?.pointerId === event.pointerId) {
      const nextWidth = resize.width + (event.clientX - resize.startX) / bounds.width * 100;
      onWidthChange(Math.round(Math.max(5, Math.min(100, nextWidth))));
      return;
    }
    const x = Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100));
    onPositionChange(Math.round(x), Math.round(y));
  };

  return (
    <div className={styles.placementPreviewBlock}>
      <div className={styles.placementPreviewHeader}>
        <strong>배치 미리보기</strong>
        <span>PNG를 드래그해서 위치 조정 · {width}×{height}</span>
      </div>
      <div className={styles.placementPreviewStageWrap}>
        <div
          className={styles.placementPreviewStage}
          style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, ${Math.round(250 * width / height)}px)` }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            updateFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
          }}
          onPointerUp={(event) => {
            resizeRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        >
          {playbackActive ? (
            <span className={styles.decoderPausedPlaceholder}><Film size={18} /></span>
          ) : (
            <video src={videoSrc} muted playsInline preload="metadata" onLoadedData={(event) => { event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration || 0.1); }} style={{ objectFit: aspectMode === "cover" ? "cover" : "contain" }} />
          )}
          <div
            className={styles.placementPreviewGraphic}
            style={{
              left: `${item.xPercent}%`,
              top: `${item.yPercent}%`,
              width: `${item.widthPercent}%`,
              filter: item.shadow ? "drop-shadow(0 4px 7px rgba(0,0,0,.65))" : "none",
            }}
          >
            <img src={item.sourceUrl} alt="배치할 PNG 카피" draggable={false} />
            <button
              type="button"
              className={styles.placementResizeHandle}
              aria-label="PNG 비율 유지 크기 조절"
              title="드래그해서 비율을 유지하며 크기 조절"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const stage = event.currentTarget.closest(`.${styles.placementPreviewStage}`) as HTMLDivElement | null;
                if (!stage) return;
                stage.setPointerCapture(event.pointerId);
                resizeRef.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  width: item.widthPercent,
                };
              }}
            ><Maximize2 size={10} /></button>
          </div>
          <span className={styles.placementCrosshair} style={{ left: `${item.xPercent}%`, top: `${item.yPercent}%` }} />
        </div>
      </div>
    </div>
  );
}

export function VideoAdEditor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  const graphicInputRef = useRef<HTMLInputElement>(null);
  const referenceImageInputRef = useRef<HTMLInputElement>(null);
  const referenceMediaInputRef = useRef<HTMLInputElement>(null);
  const generationUploadTargetRef = useRef<{ cardId: string; kind: "image" | "media" } | null>(null);
  const generationPollInFlightRef = useRef(new Set<string>());
  const appliedGenerationJobIdsRef = useRef(new Set<string>());
  const playerRef = useRef<PlayerRef>(null);
  const currentFrameRef = useRef(0);
  const previewSectionRef = useRef<HTMLElement>(null);
  const timelineDragRef = useRef<TimelineDrag | null>(null);
  const draggedClipIdRef = useRef<string | null>(null);
  const [clips, setClips] = useState<EditorClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [items, setItems] = useState<TextItem[]>([]);
  const [graphics, setGraphics] = useState<GraphicItem[]>([]);
  const [activeEditorMode, setActiveEditorMode] = useState<EditorMode>("generate");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("work");
  const [aspectMode, setAspectMode] = useState<AspectMode>("cover");
  const [outputRatio, setOutputRatio] = useState<OutputRatio>("9:16");
  const [uploading, setUploading] = useState(false);
  const [graphicUploading, setGraphicUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [graphicError, setGraphicError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  const [generationCards, setGenerationCards] = useState<GenerationCard[]>([]);
  const [generationCardsReady, setGenerationCardsReady] = useState(false);
  const [generationBatchSubmitting, setGenerationBatchSubmitting] = useState(false);

  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;
  const asset = selectedClip?.asset ?? null;
  const assetFileSize = selectedClip?.fileSize ?? null;
  const selectedClipIndex = selectedClip
    ? clips.findIndex((clip) => clip.id === selectedClip.id)
    : -1;
  const previewFps = useMemo(() => {
    const sourceRates = clips
      .map((clip) => clip.asset.metadata.fps)
      .filter((fps) => Number.isFinite(fps) && fps > 0);
    if (!sourceRates.length) return OUTPUT_FPS;
    return Math.max(12, Math.min(60, Math.round(Math.min(...sourceRates))));
  }, [clips]);
  const clipFrameCounts = useMemo(
    () => clips.map((clip) => Math.max(1, Math.round(clip.asset.metadata.duration * previewFps))),
    [clips, previewFps],
  );
  const clipStartFrames = useMemo(() => {
    let cursor = 0;
    return clipFrameCounts.map((frameCount) => {
      const start = cursor;
      cursor += frameCount;
      return start;
    });
  }, [clipFrameCounts]);
  const sequenceDurationInFrames = Math.max(1, clipFrameCounts.reduce((sum, frames) => sum + frames, 0));
  const totalClipDuration = clips.length ? sequenceDurationInFrames / previewFps : 0;
  const hasSequenceAudio = clips.some((clip) => clip.asset.metadata.hasAudio);
  const selectedClipStartFrame = selectedClipIndex >= 0 ? clipStartFrames[selectedClipIndex] ?? 0 : 0;
  const sequenceCurrentTime = currentFrame / previewFps;
  const previewClips = useMemo<VideoAdSequenceClip[]>(() => clips.map((clip, index) => ({
    id: clip.id,
    videoSrc: clip.asset.sourceUrl,
    metadata: clip.asset.metadata,
    durationInFrames: clipFrameCounts[index],
    graphics: [],
  })), [clipFrameCounts, clips]);
  const previewInputProps = useMemo(() => ({
    clips: previewClips,
    items,
    graphics,
    aspectMode,
    outputRatio,
  }), [aspectMode, graphics, items, outputRatio, previewClips]);
  const sequencePlayerKey = useMemo(
    () => `${outputRatio}:${previewFps}:${clips.map((clip) => `${clip.id}:${clip.asset.id}`).join("|")}`,
    [clips, outputRatio, previewFps],
  );

  const duration = asset?.metadata.duration ?? 0;
  const selectedClipStartTime = selectedClipStartFrame / previewFps;
  const selectedClipEndTime = selectedClipStartTime + duration;
  const outputDimensions = OUTPUT_RATIOS[outputRatio];
  const editorErrors = useMemo(() => {
    if (!asset) return [];
    const errors = validateEditorPayload([], asset.metadata, []);
    if (items.length > 20) errors.push("문구는 최대 20개까지 추가할 수 있습니다.");
    if (graphics.length > 10) errors.push("PNG 카피는 최대 10개까지 추가할 수 있습니다.");
    items.forEach((item, index) => {
      getItemErrors(item, totalClipDuration).forEach((error) => {
        errors.push(`${index + 1}번 문구: ${error}`);
      });
    });
    graphics.forEach((item, index) => {
      getGraphicItemErrors(item, totalClipDuration).forEach((error) => {
        errors.push(`PNG 카피 ${index + 1}번: ${error}`);
      });
    });
    return errors;
  }, [asset, graphics, items, totalClipDuration]);
  const activeJob = job?.status === "queued" || job?.status === "rendering";
  const activeGenerationCount = generationCards.filter(isGenerationCardBusy).length;
  const completedGenerationCount = generationCards.filter((card) => card.job?.status === "completed").length;
  const generationPollKey = generationCards
    .filter(isGenerationCardBusy)
    .map((card) => `${card.id}:${card.job?.id ?? "submitting"}:${card.job?.status ?? "submitting"}`)
    .join("|");


  const timelineSegments = useMemo(() => {
    const video: Array<{ id: string; start: number; end: number }> = [];
    clips.forEach((clip, clipIndex) => {
      const clipStart = (clipStartFrames[clipIndex] ?? 0) / previewFps;
      const clipEnd = clipStart + (clipFrameCounts[clipIndex] ?? 1) / previewFps;
      video.push({ id: clip.id, start: clipStart, end: clipEnd });
    });
    return {
      video,
      image: graphics.map((item) => ({ id: item.id, start: item.start, end: item.end })),
      text: items.map((item) => ({ id: item.id, start: item.start, end: item.end })),
      effect: [
        ...items.filter((item) => item.motion !== "none")
          .map((item) => ({ id: `effect-${item.id}`, start: item.start, end: item.end })),
        ...graphics.filter((item) => item.motion !== "none")
          .map((item) => ({ id: `effect-${item.id}`, start: item.start, end: item.end })),
      ],
    };
  }, [clipFrameCounts, clipStartFrames, clips, graphics, items, previewFps]);

  const readJob = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/video-ad/renders/${jobId}`, { cache: "no-store" });
    if (response.status === 404) {
      localStorage.removeItem(LAST_JOB_KEY);
      return null;
    }
    return responseJson<JobView>(response);
  }, []);

  useEffect(() => {
    const lastJob = localStorage.getItem(LAST_JOB_KEY);
    if (!lastJob) return;
    void readJob(lastJob)
      .then((result) => result && setJob(result))
      .catch(() => localStorage.removeItem(LAST_JOB_KEY));
  }, [readJob]);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "rendering")) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await readJob(job.id);
        if (!cancelled && next) setJob(next);
      } catch (error) {
        if (!cancelled) {
          setRenderError(error instanceof Error ? error.message : "작업 상태를 확인하지 못했습니다.");
        }
      }
    };
    void poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status, readJob]);


  const readGeneration = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/video-ad/generations/${jobId}`, { cache: "no-store" });
    if (response.status === 404) return null;
    return responseJson<GenerationView>(response);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const stored = localStorage.getItem(GENERATION_CARDS_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as unknown;
          if (Array.isArray(parsed)) {
            const restored = parsed
              .filter((card): card is Partial<GenerationCard> & { id: string } => Boolean(card) && typeof card === "object" && typeof (card as { id?: unknown }).id === "string")
              .slice(0, GENERATION_CARD_LIMIT)
              .map((card) => {
                const base = createGenerationCard(card.id, Boolean(card.expanded));
                return {
                  ...base,
                  ...card,
                  prompt: typeof card.prompt === "string" ? decodeUnicodeEscapes(card.prompt) : base.prompt,
                  model: card.model === "seedance-2-pro" || card.model === "seedance-2-5-pro" ? card.model : base.model,
                  aspectRatio: card.aspectRatio ?? base.aspectRatio,
                  duration: typeof card.duration === "number" ? card.duration : base.duration,
                  resolution: card.resolution ?? base.resolution,
                  soundEffects: typeof card.soundEffects === "boolean" ? card.soundEffects : base.soundEffects,
                  referenceImage: card.referenceImage ?? null,
                  referenceMedia: Array.isArray(card.referenceMedia) ? card.referenceMedia : [],
                  job: card.job ?? null,
                  error: typeof card.error === "string" ? card.error : null,
                  referenceImageError: typeof card.referenceImageError === "string" ? card.referenceImageError : null,
                  referenceMediaError: typeof card.referenceMediaError === "string" ? card.referenceMediaError : null,
                  isSubmitting: false,
                  referenceImageUploading: false,
                  referenceMediaUploading: false,
                } satisfies GenerationCard;
              });
            if (restored.length) {
              if (!cancelled) setGenerationCards(restored);
              if (!cancelled) setGenerationCardsReady(true);
              return;
            }
          }
        } catch {
          localStorage.removeItem(GENERATION_CARDS_KEY);
        }
      }

      const legacyJobId = localStorage.getItem(LAST_GENERATION_KEY);
      if (legacyJobId) {
        try {
          const legacyJob = await readGeneration(legacyJobId);
          if (legacyJob && !cancelled) {
            const card = createGenerationCard(crypto.randomUUID(), true);
            card.prompt = legacyJob.prompt;
            card.job = legacyJob;
            setGenerationCards([card]);
            localStorage.removeItem(LAST_GENERATION_KEY);
            setGenerationCardsReady(true);
            return;
          }
        } catch {
          localStorage.removeItem(LAST_GENERATION_KEY);
        }
      }

      if (!cancelled) {
        setGenerationCards([
          createGenerationCard(crypto.randomUUID(), true),
          createGenerationCard(crypto.randomUUID()),
          createGenerationCard(crypto.randomUUID()),
        ]);
        setGenerationCardsReady(true);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [readGeneration]);

  useEffect(() => {
    if (!generationCardsReady) return;
    const persistable = generationCards.map((card) => ({
      ...card,
      isSubmitting: false,
      referenceImageUploading: false,
      referenceMediaUploading: false,
    }));
    localStorage.setItem(GENERATION_CARDS_KEY, JSON.stringify(persistable));
  }, [generationCards, generationCardsReady]);

  useEffect(() => {
    if (!generationPollKey) return;
    const activeJobs = generationCards
      .filter((card) => card.job && isGenerationCardBusy(card))
      .map((card) => ({ cardId: card.id, jobId: card.job!.id }));
    if (!activeJobs.length) return;
    let cancelled = false;
    const poll = async () => {
      await Promise.all(activeJobs.slice(0, 3).map(async ({ cardId, jobId }) => {
        if (generationPollInFlightRef.current.has(jobId)) return;
        generationPollInFlightRef.current.add(jobId);
        try {
          const next = await readGeneration(jobId);
          if (cancelled) return;
          setGenerationCards((current) => current.map((card) => {
            if (card.id !== cardId || card.job?.id !== jobId) return card;
            if (!next) {
              return {
                ...card,
                job: {
                  ...card.job,
                  status: "failed",
                  stage: "\uC791\uC5C5\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
                  error: "\uC0DD\uC131 \uC791\uC5C5 \uC815\uBCF4\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC0DD\uC131\uD574 \uC8FC\uC138\uC694.",
                },
                error: "\uC0DD\uC131 \uC791\uC5C5 \uC815\uBCF4\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC0DD\uC131\uD574 \uC8FC\uC138\uC694.",
              };
            }
            return { ...card, job: next, isSubmitting: false, error: next.error ?? null };
          }));
        } catch (error) {
          if (!cancelled) {
            const message = error instanceof Error ? error.message : "\uC0DD\uC131 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
            setGenerationCards((current) => current.map((card) => (
              card.id === cardId && card.job?.id === jobId ? { ...card, error: message } : card
            )));
          }
        } finally {
          generationPollInFlightRef.current.delete(jobId);
        }
      }));
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [generationPollKey, readGeneration]);

  useEffect(() => {
    const completedCards = generationCards.filter((card) => (
      card.job?.status === "completed" && card.job.asset && !appliedGenerationJobIdsRef.current.has(card.job.id)
    ));
    if (!completedCards.length) return;
    completedCards.forEach((card) => appliedGenerationJobIdsRef.current.add(card.job!.id));

    setClips((current) => {
      let next = [...current];
      completedCards.forEach((card) => {
        const completedJob = card.job!;
        const matchIndex = next.findIndex((clip) => (
          clip.generationCardId === card.id || (completedJob.targetClipId !== null && clip.id === completedJob.targetClipId)
        ));
        const resolved = {
          asset: completedJob.asset!,
          fileSize: completedJob.fileSize ?? 0,
          prompt: completedJob.prompt,
          generationCardId: card.id,
        };
        if (matchIndex >= 0) {
          next[matchIndex] = { ...next[matchIndex], ...resolved, version: next[matchIndex].version + 1 };
        } else {
          next.push({ id: crypto.randomUUID(), ...resolved, version: 1 });
        }
      });

      const cardOrder = new Map(generationCards.map((card, index) => [card.id, index]));
      const manualClips = next.filter((clip) => !clip.generationCardId);
      const generatedClips = next
        .filter((clip) => clip.generationCardId)
        .sort((left, right) => (cardOrder.get(left.generationCardId!) ?? Number.MAX_SAFE_INTEGER) - (cardOrder.get(right.generationCardId!) ?? Number.MAX_SAFE_INTEGER));
      return [...manualClips, ...generatedClips];
    });
  }, [generationCards]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !clips.length) return;
    const onFrameUpdate = (event: { detail: { frame: number } }) => {
      const frame = event.detail.frame;
      currentFrameRef.current = frame;
      const isBoundary = frame === 0 ||
        frame === sequenceDurationInFrames - 1 ||
        clipStartFrames.includes(frame);
      if (isBoundary || frame % 3 === 0) {
        setCurrentFrame(frame);
      }
      let activeIndex = 0;
      for (let index = clipStartFrames.length - 1; index >= 0; index -= 1) {
        if (frame >= clipStartFrames[index]) {
          activeIndex = index;
          break;
        }
      }
      const activeClipId = clips[activeIndex]?.id;
      if (activeClipId) {
        setSelectedClipId((current) => current === activeClipId ? current : activeClipId);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      const frame = player.getCurrentFrame();
      currentFrameRef.current = frame;
      setCurrentFrame(frame);
      setIsPlaying(false);
    };
    const onEnded = () => {
      const frame = player.getCurrentFrame();
      currentFrameRef.current = frame;
      setCurrentFrame(frame);
      setIsPlaying(false);
    };
    const onMuteChange = (event: { detail: { isMuted: boolean } }) => setIsMuted(event.detail.isMuted);
    player.addEventListener("frameupdate", onFrameUpdate);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    player.addEventListener("mutechange", onMuteChange);
    setCurrentFrame(player.getCurrentFrame());
    currentFrameRef.current = player.getCurrentFrame();
    setIsPlaying(player.isPlaying());
    setIsMuted(player.isMuted());
    return () => {
      player.removeEventListener("frameupdate", onFrameUpdate);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
      player.removeEventListener("mutechange", onMuteChange);
    };
  }, [clipStartFrames, clips, outputRatio, sequenceDurationInFrames, sequencePlayerKey]);

  const uploadAsset = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".mp4")) {
      throw new Error("현재는 MP4 파일만 지원합니다.");
    }
    const uploadLimit = CLOUD_UPLOADS_ENABLED ? CLOUD_MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
    if (file.size > uploadLimit) {
      throw new Error(CLOUD_UPLOADS_ENABLED
        ? "현재 웹 버전에서는 영상을 최대 50MB까지 업로드할 수 있습니다."
        : "파일 크기는 최대 100MB까지 업로드할 수 있습니다.");
    }

    const result = CLOUD_UPLOADS_ENABLED
      ? await uploadToCloud<{ asset: VideoAsset }>("video", file)
      : await (async () => {
          const form = new FormData();
          form.append("file", file);
          const response = await fetch("/api/video-ad/uploads", { method: "POST", body: form });
          return responseJson<{ asset: VideoAsset }>(response);
        })();
    return result.asset;
  };

  const addClipFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploadError(null);
    setUploading(true);
    const added: EditorClip[] = [];
    try {
      for (const file of files) {
        const uploaded = await uploadAsset(file);
        added.push({
          id: crypto.randomUUID(),
          asset: uploaded,
          fileSize: file.size,
          prompt: "",
          version: 1,
        });
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "업로드에 실패했습니다.");
    } finally {
      if (added.length) {
        setClips((current) => [...current, ...added]);
        if (!selectedClipId) setSelectedClipId(added[0].id);
        setCurrentFrame(0);
      }
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const replaceClipFile = async (clipId: string, file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await uploadAsset(file);
      setClips((current) => current.map((clip) => clip.id === clipId ? {
        ...clip,
        asset: uploaded,
        fileSize: file.size,
        version: clip.version + 1,
      } : clip));
      setSelectedClipId(clipId);
      const clipIndex = clips.findIndex((clip) => clip.id === clipId);
      const startFrame = clipIndex >= 0 ? clipStartFrames[clipIndex] ?? 0 : 0;
      setCurrentFrame(startFrame);
      requestAnimationFrame(() => playerRef.current?.seekTo(startFrame));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "컷을 교체하지 못했습니다.");
    } finally {
      setUploading(false);
      replaceTargetRef.current = null;
      if (replaceInputRef.current) replaceInputRef.current.value = "";
    }
  };

  const selectClip = (clipId: string) => {
    const clipIndex = clips.findIndex((clip) => clip.id === clipId);
    if (clipIndex < 0) return;
    const startFrame = clipStartFrames[clipIndex] ?? 0;
    setSelectedClipId(clipId);
    setCurrentFrame(startFrame);
    playerRef.current?.seekTo(startFrame);
  };

  const moveClip = (clipId: string, direction: -1 | 1) => {
    const index = clips.findIndex((clip) => clip.id === clipId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= clips.length) return;
    const next = [...clips];
    [next[index], next[target]] = [next[target], next[index]];
    setClips(next);
    const selectedIndex = next.findIndex((clip) => clip.id === selectedClipId);
    const startFrame = next.slice(0, Math.max(0, selectedIndex))
      .reduce((sum, clip) => sum + Math.max(1, Math.round(clip.asset.metadata.duration * previewFps)), 0);
    setCurrentFrame(startFrame);
    requestAnimationFrame(() => playerRef.current?.seekTo(startFrame));
  };

  const reorderClip = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setClips((current) => {
      const sourceIndex = current.findIndex((clip) => clip.id === sourceId);
      const targetIndex = current.findIndex((clip) => clip.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setSelectedClipId(sourceId);
    currentFrameRef.current = 0;
    setCurrentFrame(0);
    requestAnimationFrame(() => playerRef.current?.seekTo(0));
  };

  const getTimelineSnapTargets = (track: EditableTimelineTrack, id: string) => {
    const clipBoundaries = [0, totalClipDuration];
    clipStartFrames.forEach((frame, index) => {
      clipBoundaries.push(frame / previewFps);
      clipBoundaries.push((frame + (clipFrameCounts[index] ?? 0)) / previewFps);
    });
    const otherRanges: Array<TextItem | GraphicItem> = [...items, ...graphics];
    otherRanges.forEach((item) => {
      if (item.id === id) return;
      clipBoundaries.push(item.start, item.end);
    });
    return [...new Set(clipBoundaries.map((time) => Number(time.toFixed(6))))];
  };

  const beginTimelineDrag = (
    event: React.PointerEvent<HTMLElement>,
    track: EditableTimelineTrack,
    id: string,
    mode: TimelineDragMode,
    start: number,
    end: number,
  ) => {
    const lane = event.currentTarget.closest(`.${styles.trackLane}`) as HTMLElement | null;
    if (!lane) return;
    event.preventDefault();
    event.stopPropagation();
    playerRef.current?.pause();
    event.currentTarget.setPointerCapture(event.pointerId);
    timelineDragRef.current = {
      pointerId: event.pointerId,
      track,
      id,
      mode,
      originX: event.clientX,
      laneWidth: lane.getBoundingClientRect().width,
      start,
      end,
    };
  };

  const moveTimelineDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = timelineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || totalClipDuration <= 0) return;
    const minimumDuration = 1 / previewFps;
    const delta = (event.clientX - drag.originX) / Math.max(1, drag.laneWidth) * totalClipDuration;
    const targets = getTimelineSnapTargets(drag.track, drag.id);
    const snapThreshold = Math.max(minimumDuration, totalClipDuration * 7 / Math.max(1, drag.laneWidth));
    let start = drag.start;
    let end = drag.end;
    let guide: number | null = null;

    const closestSnap = (value: number) => targets
      .map((target) => ({ target, distance: Math.abs(target - value) }))
      .sort((a, b) => a.distance - b.distance)[0];

    if (drag.mode === "move") {
      const span = drag.end - drag.start;
      start = Math.max(0, Math.min(drag.start + delta, totalClipDuration - span));
      end = start + span;
      const startSnap = closestSnap(start);
      const endSnap = closestSnap(end);
      const snap = startSnap.distance <= endSnap.distance ? startSnap : endSnap;
      if (snap.distance <= snapThreshold) {
        const anchor = snap === startSnap ? start : end;
        const shift = snap.target - anchor;
        start += shift;
        end += shift;
        guide = snap.target;
      }
    } else if (drag.mode === "resize-start") {
      start = Math.max(0, Math.min(drag.start + delta, end - minimumDuration));
      const snap = closestSnap(start);
      if (snap.distance <= snapThreshold && snap.target <= end - minimumDuration) {
        start = snap.target;
        guide = snap.target;
      }
    } else {
      end = Math.min(totalClipDuration, Math.max(drag.end + delta, start + minimumDuration));
      const snap = closestSnap(end);
      if (snap.distance <= snapThreshold && snap.target >= start + minimumDuration) {
        end = snap.target;
        guide = snap.target;
      }
    }

    const updateRange = <T extends TextItem | GraphicItem>(item: T): T => (
      item.id === drag.id ? { ...item, start, end } : item
    );
    if (drag.track === "text") setItems((current) => current.map(updateRange));
    else setGraphics((current) => current.map(updateRange));
    setSnapGuide(guide);
    seekToTextPreview(start, end);
  };

  const endTimelineDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = timelineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    timelineDragRef.current = null;
    setSnapGuide(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const removeClip = (clipId: string) => {
    const index = clips.findIndex((clip) => clip.id === clipId);
    const next = clips.filter((clip) => clip.id !== clipId);
    const nextSelectedId = selectedClipId === clipId
      ? next[Math.min(index, next.length - 1)]?.id ?? null
      : selectedClipId;
    setClips(next);
    setSelectedClipId(nextSelectedId);
    const nextSelectedIndex = next.findIndex((clip) => clip.id === nextSelectedId);
    const startFrame = next.slice(0, Math.max(0, nextSelectedIndex))
      .reduce((sum, clip) => sum + Math.max(1, Math.round(clip.asset.metadata.duration * previewFps)), 0);
    setCurrentFrame(startFrame);
    requestAnimationFrame(() => playerRef.current?.seekTo(startFrame));
  };

  const updateGenerationCard = (cardId: string, update: (card: GenerationCard) => GenerationCard) => {
    setGenerationCards((current) => current.map((card) => card.id === cardId ? update(card) : card));
  };

  const addGenerationCard = () => {
    setGenerationCards((current) => {
      if (current.length >= GENERATION_CARD_LIMIT) return current;
      return [...current.map((card) => ({ ...card, expanded: false })), createGenerationCard(crypto.randomUUID(), true)];
    });
  };

  const removeGenerationCard = (cardId: string) => {
    setGenerationCards((current) => current.filter((card) => card.id !== cardId));
    setClips((current) => current.filter((clip) => clip.generationCardId !== cardId));
  };

  const startGenerationForCard = async (cardId: string) => {
    const card = generationCards.find((entry) => entry.id === cardId);
    if (!card || isGenerationCardBusy(card)) return false;
    const prompt = card.prompt.trim();
    if (!prompt) {
      updateGenerationCard(cardId, (current) => ({ ...current, error: "\uC601\uC0C1 \uC124\uBA85\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694." }));
      return false;
    }
    const referenceError = getGenerationCardReferenceError(card);
    if (referenceError) {
      updateGenerationCard(cardId, (current) => ({ ...current, error: referenceError }));
      return false;
    }

    updateGenerationCard(cardId, (current) => ({ ...current, error: null, isSubmitting: true }));
    try {
      const response = await fetch("/api/video-ad/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetClipId: card.id,
          model: card.model,
          prompt,
          duration: card.duration,
          resolution: card.resolution,
          aspectRatio: card.aspectRatio,
          soundEffects: card.soundEffects,
          imageAssetId: card.referenceImage?.id ?? null,
          referenceMedia: card.referenceMedia.map((media) => ({ kind: media.kind, assetId: media.asset.id })),
        }),
      });
      const created = await responseJson<GenerationView>(response);
      updateGenerationCard(cardId, (current) => ({
        ...current,
        job: created,
        isSubmitting: false,
        error: null,
        expanded: true,
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI \uC601\uC0C1 \uC0DD\uC131\uC744 \uC2DC\uC791\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
      updateGenerationCard(cardId, (current) => ({ ...current, isSubmitting: false, error: message }));
      return false;
    }
  };

  const startAllGeneration = async () => {
    const cardIds = generationCards
      .filter((card) => !isGenerationCardBusy(card) && card.job?.status !== "completed" && Boolean(card.prompt.trim()))
      .map((card) => card.id);
    if (!cardIds.length) return;
    setGenerationBatchSubmitting(true);
    try {
      let cursor = 0;
      const requestWorker = async () => {
        while (cursor < cardIds.length) {
          const cardId = cardIds[cursor];
          cursor += 1;
          await startGenerationForCard(cardId);
        }
      };
      await Promise.all([requestWorker(), requestWorker()]);
    } finally {
      setGenerationBatchSubmitting(false);
    }
  };

  const startSequencePlayback = () => {
    if (!clips.length) return;
    setSelectedClipId(clips[0].id);
    setCurrentFrame(0);
    playerRef.current?.seekTo(0);
    requestAnimationFrame(() => playerRef.current?.play());
  };

  const uploadGraphic = async (file: File) => {
    setGraphicError(null);
    if (!asset) {
      setGraphicError("먼저 영상을 업로드해 주세요.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".png")) {
      setGraphicError("PNG 파일만 지원합니다.");
      return;
    }
    if (file.size > MAX_GRAPHIC_BYTES) {
      setGraphicError("PNG는 최대 10MB까지 업로드할 수 있습니다.");
      return;
    }
    if (graphics.length >= 10) {
      setGraphicError("PNG 카피는 최대 10개까지 추가할 수 있습니다.");
      return;
    }
    setGraphicUploading(true);
    try {
      const result = CLOUD_UPLOADS_ENABLED
        ? await uploadToCloud<{ asset: GraphicAsset }>("graphic", file)
        : await (async () => {
            const form = new FormData();
            form.append("file", file);
            const response = await fetch("/api/video-ad/graphics", { method: "POST", body: form });
            return responseJson<{ asset: GraphicAsset }>(response);
          })();
      const graphic: GraphicItem = {
        id: crypto.randomUUID(),
        graphicId: result.asset.id,
        sourceUrl: result.asset.sourceUrl,
        originalName: result.asset.originalName,
        intrinsicWidth: result.asset.width,
        intrinsicHeight: result.asset.height,
        start: selectedClipStartTime,
        end: Math.min(totalClipDuration, selectedClipStartTime + 2.5),
        xPercent: 50,
        yPercent: 50,
        widthPercent: 60,
        shadow: true,
        motion: "pop",
      };
      setGraphics((current) => [...current, graphic]);
    } catch (error) {
      setGraphicError(error instanceof Error ? error.message : "PNG 업로드에 실패했습니다.");
    } finally {
      setGraphicUploading(false);
      if (graphicInputRef.current) graphicInputRef.current.value = "";
    }
  };
  const uploadGenerationReferenceImage = async (cardId: string, file: File) => {
    const card = generationCards.find((entry) => entry.id === cardId);
    if (!card) return;
    if (card.referenceMedia.length) {
      updateGenerationCard(cardId, (current) => ({ ...current, referenceImageError: "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB97C \uBAA8\uB450 \uC81C\uAC70\uD55C \uD6C4 \uC2DC\uC791 \uC774\uBBF8\uC9C0\uB97C \uCD94\uAC00\uD574 \uC8FC\uC138\uC694." }));
      return;
    }
    if (!CLOUD_UPLOADS_ENABLED) {
      updateGenerationCard(cardId, (current) => ({ ...current, referenceImageError: "\uC2DC\uC791 \uC774\uBBF8\uC9C0 \uAE30\uB2A5\uC740 Supabase \uC800\uC7A5\uC18C\uAC00 \uC5F0\uACB0\uB41C \uBC30\uD3EC \uD658\uACBD\uC5D0\uC11C \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }));
      return;
    }
    if (!file.name.toLowerCase().endsWith(".png")) {
      updateGenerationCard(cardId, (current) => ({ ...current, referenceImageError: "PNG \uD30C\uC77C\uB9CC \uC2DC\uC791 \uC774\uBBF8\uC9C0\uB85C \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }));
      return;
    }
    if (file.size > MAX_GRAPHIC_BYTES) {
      updateGenerationCard(cardId, (current) => ({ ...current, referenceImageError: "\uC2DC\uC791 PNG\uB294 \uCD5C\uB300 10MB\uAE4C\uC9C0 \uC5C5\uB85C\uB4DC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }));
      return;
    }

    updateGenerationCard(cardId, (current) => ({ ...current, referenceImageError: null, referenceImageUploading: true }));
    try {
      const result = await uploadToCloud<{ asset: GraphicAsset }>("graphic", file);
      updateGenerationCard(cardId, (current) => ({ ...current, referenceImage: result.asset, referenceImageUploading: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "\uC2DC\uC791 \uC774\uBBF8\uC9C0 \uC5C5\uB85C\uB4DC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.";
      updateGenerationCard(cardId, (current) => ({ ...current, referenceImageUploading: false, referenceImageError: message }));
    } finally {
      if (referenceImageInputRef.current) referenceImageInputRef.current.value = "";
    }
  };

  const uploadGenerationReferenceMedia = async (cardId: string, files: File[]) => {
    const card = generationCards.find((entry) => entry.id === cardId);
    if (!card || !files.length) return;
    if (!CLOUD_UPLOADS_ENABLED) {
      updateGenerationCard(cardId, (current) => ({ ...current, referenceMediaError: "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB294 Supabase \uC800\uC7A5\uC18C\uAC00 \uC5F0\uACB0\uB41C \uBC30\uD3EC \uD658\uACBD\uC5D0\uC11C \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }));
      return;
    }
    if (card.model !== "seedance-2-5-pro") {
      updateGenerationCard(cardId, (current) => ({ ...current, referenceMediaError: "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB294 Seedance 2.5 Pro\uC5D0\uC11C\uB9CC \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4." }));
      return;
    }
    if (card.referenceImage) {
      updateGenerationCard(cardId, (current) => ({ ...current, referenceMediaError: "\uC2DC\uC791 \uC774\uBBF8\uC9C0\uB97C \uC81C\uAC70\uD55C \uD6C4 \uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB97C \uCD94\uAC00\uD574 \uC8FC\uC138\uC694." }));
      return;
    }

    updateGenerationCard(cardId, (current) => ({ ...current, referenceMediaError: null, referenceMediaUploading: true }));
    const added: ReferenceMedia[] = [];
    const messages: string[] = [];
    let imageCount = card.referenceMedia.filter((media) => media.kind === "image").length;
    let videoCount = card.referenceMedia.filter((media) => media.kind === "video").length;
    let videoDuration = card.referenceMedia.reduce((total, media) => total + (media.kind === "video" ? media.asset.metadata.duration : 0), 0);

    try {
      for (const file of files) {
        const name = file.name.toLowerCase();
        if (name.endsWith(".png")) {
          if (file.size > MAX_GRAPHIC_BYTES) {
            messages.push("PNG \uB808\uD37C\uB7F0\uC2A4\uB294 \uCD5C\uB300 10MB\uAE4C\uC9C0 \uC5C5\uB85C\uB4DC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
            continue;
          }
          if (imageCount >= 30) {
            messages.push("\uC774\uBBF8\uC9C0 \uB808\uD37C\uB7F0\uC2A4\uB294 \uCD5C\uB300 30\uAC1C\uAE4C\uC9C0 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
            continue;
          }
          const result = await uploadToCloud<{ asset: GraphicAsset }>("graphic", file);
          added.push({ id: crypto.randomUUID(), kind: "image", asset: result.asset });
          imageCount += 1;
          continue;
        }
        if (name.endsWith(".mp4")) {
          if (file.size > CLOUD_MAX_UPLOAD_BYTES) {
            messages.push("MP4 \uB808\uD37C\uB7F0\uC2A4\uB294 \uCD5C\uB300 50MB\uAE4C\uC9C0 \uC5C5\uB85C\uB4DC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
            continue;
          }
          if (videoCount >= 10) {
            messages.push("\uC601\uC0C1 \uB808\uD37C\uB7F0\uC2A4\uB294 \uCD5C\uB300 10\uAC1C\uAE4C\uC9C0 \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
            continue;
          }
          const result = await uploadToCloud<{ asset: VideoAsset }>("video", file);
          const candidateDuration = result.asset.metadata.duration;
          if (!Number.isFinite(candidateDuration) || candidateDuration < 2 || candidateDuration > 30) {
            messages.push("\uC601\uC0C1 \uB808\uD37C\uB7F0\uC2A4\uB294 2\uCD08\uBD80\uD130 30\uCD08 \uC0AC\uC774\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
            continue;
          }
          if (videoDuration + candidateDuration > 30.001) {
            messages.push("\uB808\uD37C\uB7F0\uC2A4 \uC601\uC0C1\uC758 \uCD1D \uAE38\uC774\uB294 30\uCD08 \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4.");
            continue;
          }
          added.push({ id: crypto.randomUUID(), kind: "video", asset: result.asset });
          videoCount += 1;
          videoDuration += candidateDuration;
          continue;
        }
        messages.push("\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB294 PNG \uB610\uB294 MP4 \uD30C\uC77C\uB9CC \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
      }
    } catch (error) {
      messages.push(error instanceof Error ? error.message : "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4 \uC5C5\uB85C\uB4DC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    }

    updateGenerationCard(cardId, (current) => ({
      ...current,
      referenceMediaUploading: false,
      referenceMedia: added.length ? [...current.referenceMedia, ...added] : current.referenceMedia,
      referenceMediaError: messages.length ? messages.join("\n") : null,
    }));
    if (referenceMediaInputRef.current) referenceMediaInputRef.current.value = "";
  };


  const updateGraphic = <K extends keyof GraphicItem>(id: string, key: K, value: GraphicItem[K]) => {
    setGraphics((current) =>
      current.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    );
  };

  const updateItem = <K extends keyof TextItem>(id: string, key: K, value: TextItem[K]) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    );
  };

  const seekToTextPreview = (start: number, end: number) => {
    const minimumDuration = 1 / previewFps;
    const previewOffset = Math.min(0.35, Math.max(minimumDuration, (end - start) / 2));
    const previewTime = Math.min(end - minimumDuration, start + previewOffset);
    const frame = Math.max(0, Math.min(
      sequenceDurationInFrames - 1,
      Math.round(previewTime * previewFps),
    ));
    currentFrameRef.current = frame;
    setCurrentFrame(frame);
    requestAnimationFrame(() => {
      playerRef.current?.pause();
      playerRef.current?.seekTo(frame);
    });
  };

  const updateItemStart = (id: string, nextStart: number) => {
    if (!Number.isFinite(nextStart) || totalClipDuration <= 0) return;
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    const minimumDuration = 1 / previewFps;
    const currentDuration = Math.max(minimumDuration, item.end - item.start);
    const start = Math.max(0, Math.min(nextStart, totalClipDuration - minimumDuration));
    const adjustedEnd = start >= item.end
      ? Math.min(totalClipDuration, start + currentDuration)
      : item.end;
    const end = Math.max(start + minimumDuration, adjustedEnd);
    setItems((current) => current.map((entry) => (
      entry.id === id ? { ...entry, start, end } : entry
    )));
    seekToTextPreview(start, end);
  };

  const updateItemEnd = (id: string, nextEnd: number) => {
    if (!Number.isFinite(nextEnd) || totalClipDuration <= 0) return;
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    const minimumDuration = 1 / previewFps;
    const currentDuration = Math.max(minimumDuration, item.end - item.start);
    const end = Math.max(minimumDuration, Math.min(nextEnd, totalClipDuration));
    const adjustedStart = end <= item.start
      ? Math.max(0, end - currentDuration)
      : item.start;
    const start = Math.min(adjustedStart, end - minimumDuration);
    setItems((current) => current.map((entry) => (
      entry.id === id ? { ...entry, start, end } : entry
    )));
    seekToTextPreview(start, end);
  };

  const updateGraphicStart = (id: string, nextStart: number) => {
    if (!Number.isFinite(nextStart) || totalClipDuration <= 0) return;
    const item = graphics.find((entry) => entry.id === id);
    if (!item) return;
    const minimumDuration = 1 / previewFps;
    const currentDuration = Math.max(minimumDuration, item.end - item.start);
    const start = Math.max(0, Math.min(nextStart, totalClipDuration - minimumDuration));
    const adjustedEnd = start >= item.end
      ? Math.min(totalClipDuration, start + currentDuration)
      : item.end;
    const end = Math.max(start + minimumDuration, adjustedEnd);
    setGraphics((current) => current.map((entry) => (
      entry.id === id ? { ...entry, start, end } : entry
    )));
    seekToTextPreview(start, end);
  };

  const updateGraphicEnd = (id: string, nextEnd: number) => {
    if (!Number.isFinite(nextEnd) || totalClipDuration <= 0) return;
    const item = graphics.find((entry) => entry.id === id);
    if (!item) return;
    const minimumDuration = 1 / previewFps;
    const currentDuration = Math.max(minimumDuration, item.end - item.start);
    const end = Math.max(minimumDuration, Math.min(nextEnd, totalClipDuration));
    const adjustedStart = end <= item.start
      ? Math.max(0, end - currentDuration)
      : item.start;
    const start = Math.min(adjustedStart, end - minimumDuration);
    setGraphics((current) => current.map((entry) => (
      entry.id === id ? { ...entry, start, end } : entry
    )));
    seekToTextPreview(start, end);
  };

  const addItem = () => {
    if (!clips.length || items.length >= 20) return;
    const item = createDefaultTextItem();
    item.end = Math.min(totalClipDuration, 2.5);
    setItems((current) => [...current, item]);
  };

  const addExamples = () => {
    if (!clips.length || items.length > 17) return;
    const segment = totalClipDuration / 3;
    const examples: Array<Pick<TextItem, "text" | "position" | "motion">> = [
      { text: "지금 시작하면", position: "top", motion: "pop" },
      { text: "100연 뽑기 무료!", position: "center", motion: "slide-up" },
      { text: "지금 플레이", position: "bottom", motion: "fade" },
    ];
    setItems((current) => [
      ...current,
      ...examples.map((example, index) => ({
        ...createDefaultTextItem(),
        ...example,
        start: Number((segment * index).toFixed(3)),
        end: Number((index === 2 ? totalClipDuration : segment * (index + 1)).toFixed(3)),
      })),
    ]);
  };

  const startRender = async () => {
    if (!asset || activeJob) return;
    setRenderError(null);
    if (editorErrors.length) {
      setRenderError(editorErrors.join("\n"));
      return;
    }

    try {
      const response = await fetch("/api/video-ad/renders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: clips.map((clip) => ({ id: clip.id, assetId: clip.asset.id, metadata: clip.asset.metadata })),
          items,
          graphics,
          aspectMode,
          outputRatio,
        }),
      });
      const created = await responseJson<{ jobId: string; status: RenderJobStatus }>(response);
      localStorage.setItem(LAST_JOB_KEY, created.jobId);
      setJob({
        id: created.jobId,
        status: created.status,
        stage: "렌더링 대기 중",
        progress: null,
        error: null,
        downloadUrl: null,
      });
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "렌더링 작업을 만들지 못했습니다.");
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark}><Film size={18} /></span>
          <span className={styles.logo}>AD MOTION LAB</span>
        </div>
        <div className={styles.projectTitle}>
          <span className={styles.projectBreadcrumb}>프로젝트</span>
          <h1>게임 광고 영상 스튜디오</h1>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.saveStatus}><CheckCircle2 size={14} /> 미리보기 자동 반영</span>
          <button
            type="button"
            className={styles.headerButton}
            onClick={() => {
              setWorkspaceView("edit");
              requestAnimationFrame(() => previewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
            }}
          >
            <MonitorPlay size={16} /> 미리보기
          </button>
          <button
            type="button"
            className={styles.headerPrimary}
            disabled={!asset || activeJob || editorErrors.length > 0}
            onClick={() => {
              setWorkspaceView("edit");
              void startRender();
            }}
          >
            {activeJob ? <LoaderCircle className={styles.spin} size={16} /> : <Film size={16} />}
            전체 영상 내보내기
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <nav className={styles.workspaceSectionNav} aria-label={"\uC791\uC5C5\uACF5\uAC04 \uC120\uD0DD"}>
          <button
            type="button"
            className={workspaceView === "work" ? styles.workspaceSectionActive : ""}
            aria-pressed={workspaceView === "work"}
            aria-controls="work-tools-workspace"
            onClick={() => setWorkspaceView("work")}
          >
            <span className={styles.workspaceStepBadge} aria-hidden="true">1</span>
            <span className={styles.workspaceSectionIcon}><Sparkles size={20} /></span>
            <span className={styles.workspaceSectionCopy}>
              <strong>{"\uC791\uC5C5 \uB3C4\uAD6C"}</strong>
              <small>{"AI \uCEF7\uC744 \uB9CC\uB4E4\uACE0 \uC601\uC0C1\uACFC \uB808\uC774\uC5B4\uB97C \uC900\uBE44\uD569\uB2C8\uB2E4."}</small>
            </span>
          </button>
          <span className={styles.workspaceStepArrow} aria-hidden="true">
            <small>{"\uB2E4\uC74C"}</small>
            <ChevronRight size={20} />
          </span>
          <button
            type="button"
            className={workspaceView === "edit" ? styles.workspaceSectionActive : ""}
            aria-pressed={workspaceView === "edit"}
            aria-controls="editing-workspace"
            onClick={() => setWorkspaceView("edit")}
          >
            <span className={styles.workspaceStepBadge} aria-hidden="true">2</span>
            <span className={styles.workspaceSectionIcon}><MonitorPlay size={20} /></span>
            <span className={styles.workspaceSectionCopy}>
              <strong>{"\uD3B8\uC9D1 \uB3C4\uAD6C"}</strong>
              <small>{"\uBBF8\uB9AC\uBCF4\uAE30, \uD0C0\uC784\uB77C\uC778, \uCD9C\uB825 \uC124\uC815\uC744 \uC870\uC815\uD569\uB2C8\uB2E4."}</small>
            </span>
          </button>
        </nav>
        <section
          id="work-tools-workspace"
          className={[styles.workToolsWorkspace, workspaceView !== "work" ? styles.workspaceViewHidden : ""].filter(Boolean).join(" ")}
          aria-label={"\uC791\uC5C5 \uB3C4\uAD6C"}
          aria-hidden={workspaceView !== "work"}
        >
          <section className={styles.editorColumn}>
          <nav className={styles.toolModeNav} aria-label={"\uC791\uC5C5 \uB3C4\uAD6C \uC120\uD0DD"}>
            <div className={styles.toolModeHeading}>
              <strong>{"\uC791\uC5C5 \uB3C4\uAD6C"}</strong>
              <span>{"AI \uCEF7 \uC0DD\uC131, \uC601\uC0C1 \uC5D0\uC14B, \uC790\uB9C9\u00B7PNG\uB97C \uC900\uBE44\uD558\uC138\uC694."}</span>
            </div>
            <div className={styles.toolModeList}>
              <button type="button" className={activeEditorMode === "generate" ? styles.toolModeActive : ""} aria-pressed={activeEditorMode === "generate"} aria-controls="editor-panel-generate" onClick={() => setActiveEditorMode("generate")}>
                <Sparkles size={18} />
                <span><strong>{"AI \uCEF7 \uC0DD\uC131"}</strong><small>{generationCards.length ? generationCards.length + "\uAC1C \uCEF7 \uC900\uBE44 \uC911" : "Seedance \uC0DD\uC131 \uB3C4\uAD6C"}</small></span>
              </button>
              <button type="button" className={activeEditorMode === "video" ? styles.toolModeActive : ""} aria-pressed={activeEditorMode === "video"} aria-controls="editor-panel-video" onClick={() => setActiveEditorMode("video")}>
                <Film size={18} />
                <span><strong>{"\uC601\uC0C1 \uC5D0\uC14B"}</strong><small>{clips.length ? clips.length + "\uAC1C \uCEF7 \uD3B8\uC9D1 \uC911" : "MP4 \uCD94\uAC00"}</small></span>
              </button>
              <button type="button" className={activeEditorMode === "captions" ? styles.toolModeActive : ""} aria-pressed={activeEditorMode === "captions"} aria-controls="editor-panel-captions" onClick={() => setActiveEditorMode("captions")}>
                <Layers3 size={18} />
                <span><strong>{"\uC790\uB9C9\u00B7PNG"}</strong><small>{items.length + graphics.length ? items.length + graphics.length + "\uAC1C \uB808\uC774\uC5B4" : "\uBB38\uAD6C\uC640 \uADF8\uB798\uD53D"}</small></span>
              </button>
            </div>
          </nav>

          <div className={styles.toolPanel}>
          <div
            id="editor-panel-generate"
            role="region"
            aria-label={"AI \uCEF7 \uC0DD\uC131"}
            hidden={activeEditorMode !== "generate"}
            className={`${styles.card} ${styles.generationCard}`}
          >
            <div className={[styles.aiGenerator, styles.generationQueuePanel].filter(Boolean).join(" ")}>
              <div className={styles.generationQueueHeader}>
                <div>
                  <span><Sparkles size={14} /> {"\uC601\uC0C1 \uB9CC\uB4E4\uAE30"}</span>
                  <p>{"\uCEE7\uBCC4\uB85C \uD504\uB86C\uD504\uD2B8\uC640 \uB808\uD37C\uB7F0\uC2A4\uB97C \uC785\uB825\uD558\uACE0, \uAC01\uAC01 \uB3C5\uB9BD\uC801\uC73C\uB85C \uC0DD\uC131\uD569\uB2C8\uB2E4."}</p>
                </div>
                <div className={styles.generationQueueHeaderActions}>
                  <span className={styles.generationQueueCount}>{generationCards.length}{"\uAC1C \uCEF7"}</span>
                  <button
                    type="button"
                    className={styles.generationAddButton}
                    onClick={addGenerationCard}
                    disabled={!generationCardsReady || generationCards.length >= GENERATION_CARD_LIMIT}
                  ><Plus size={13} /> {"\uCEF7 \uCD94\uAC00"}</button>
                </div>
              </div>

              <div className={styles.generationQueueSummary}>
                <span>{activeGenerationCount > 0 ? <><LoaderCircle className={styles.spin} size={12} /> {activeGenerationCount}{"\uAC1C \uC0DD\uC131 \uC911"}</> : <><CheckCircle2 size={12} /> {completedGenerationCount}{"\uAC1C \uC644\uB8CC"}</>}</span>
                <button
                  type="button"
                  onClick={() => void startAllGeneration()}
                  disabled={generationBatchSubmitting || !generationCards.some((card) => !isGenerationCardBusy(card) && card.job?.status !== "completed" && Boolean(card.prompt.trim()))}
                >
                  {generationBatchSubmitting ? <LoaderCircle className={styles.spin} size={12} /> : <Sparkles size={12} />}
                  {generationBatchSubmitting ? "\uC694\uCCAD \uC911" : "\uC791\uC131\uB41C \uCEF7 \uBAA8\uB450 \uC0DD\uC131"}
                </button>
              </div>

              <input
                ref={referenceImageInputRef}
                className={styles.hiddenInput}
                type="file"
                accept="image/png,.png"
                onChange={(event) => {
                  const target = generationUploadTargetRef.current;
                  const file = event.target.files?.[0];
                  generationUploadTargetRef.current = null;
                  if (target?.kind === "image" && file) void uploadGenerationReferenceImage(target.cardId, file);
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={referenceMediaInputRef}
                className={styles.hiddenInput}
                type="file"
                accept="image/png,.png,video/mp4,.mp4"
                multiple
                onChange={(event) => {
                  const target = generationUploadTargetRef.current;
                  const files = Array.from(event.target.files ?? []);
                  generationUploadTargetRef.current = null;
                  if (target?.kind === "media" && files.length) void uploadGenerationReferenceMedia(target.cardId, files);
                  event.currentTarget.value = "";
                }}
              />

              {!generationCardsReady ? (
                <div className={styles.generationQueueEmpty}><LoaderCircle className={styles.spin} size={14} /> {"\uCEF7 \uC791\uC5C5 \uD654\uBA74\uC744 \uC900\uBE44\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4."}</div>
              ) : (
                <div className={styles.generationQueue}>
                  {generationCards.map((card, index) => {
                    const modelConfig = seedanceModelOptions[card.model];
                    const busy = isGenerationCardBusy(card);
                    const referenceError = getGenerationCardReferenceError(card);
                    const referenceImageCount = card.referenceMedia.filter((media) => media.kind === "image").length;
                    const referenceVideoCount = card.referenceMedia.filter((media) => media.kind === "video").length;
                    const statusClass = card.isSubmitting ? styles.generating : card.job ? styles[card.job.status] : "";
                    const error = card.error || card.job?.error;
                    const cardClip = clips.find((clip) => clip.generationCardId === card.id);
                    return (
                      <article
                        className={[styles.generationDraftCard, card.expanded ? styles.generationDraftCardOpen : "", busy ? styles.generationDraftCardActive : ""].filter(Boolean).join(" ")}
                        key={card.id}
                      >
                        <header className={styles.generationDraftHeader}>
                          <button
                            type="button"
                            className={styles.generationDraftToggle}
                            onClick={() => updateGenerationCard(card.id, (current) => ({ ...current, expanded: !current.expanded }))}
                            aria-expanded={card.expanded}
                          >
                            <span className={styles.generationDraftIdentity}>
                              <strong>{"\uCEF7 "}{index + 1}</strong>
                              <small className={[styles.generationDraftBadge, statusClass].filter(Boolean).join(" ")}>{generationStatusLabel(card)}</small>
                            </span>
                            <span className={styles.generationDraftMeta}>{card.duration}{"\uCD08 \u00B7 "}{seedanceAspectRatioOptions.find((option) => option.value === card.aspectRatio)?.label ?? "9:16"}<ChevronDown className={card.expanded ? styles.generationChevronOpen : ""} size={14} /></span>
                          </button>
                          <div className={styles.generationDraftActions}>
                            {cardClip && (
                              <button type="button" title={"\uD0C0\uC784\uB77C\uC778\uC5D0\uC11C \uBCF4\uAE30"} onClick={() => selectClip(cardClip.id)}><MonitorPlay size={13} /></button>
                            )}
                            <button
                              type="button"
                              title={busy ? "\uC0DD\uC131 \uC911\uC5D0\uB294 \uC0AD\uC81C\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." : "\uCEF7 \uC0AD\uC81C"}
                              aria-label={"\uCEF7 \uC0AD\uC81C"}
                              onClick={() => removeGenerationCard(card.id)}
                              disabled={busy}
                            ><Trash2 size={13} /></button>
                          </div>
                        </header>

                        {card.expanded && (
                          <div className={styles.generationDraftBody}>
                            <div className={styles.modelSelector} role="group" aria-label={"\uC0DD\uC131 \uBAA8\uB378 \uC120\uD0DD"}>
                              {(["seedance-2-pro", "seedance-2-5-pro"] as SeedanceModel[]).map((model) => {
                                const option = seedanceModelOptions[model];
                                const selected = card.model === model;
                                return (
                                  <button
                                    type="button"
                                    key={model}
                                    className={[styles.modelOption, selected ? styles.modelOptionActive : ""].filter(Boolean).join(" ")}
                                    onClick={() => updateGenerationCard(card.id, (current) => ({
                                      ...current,
                                      model,
                                      duration: Math.max(4, Math.min(option.maxDuration, current.duration)),
                                      error: null,
                                    }))}
                                    disabled={busy || card.referenceImageUploading || card.referenceMediaUploading}
                                    aria-pressed={selected}
                                  >
                                    <span>{option.label}</span>
                                    <small>{option.supportsReferenceMedia ? "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4 \uC0AC\uC6A9" : "\uC2DC\uC791 \uC774\uBBF8\uC9C0 \uC0AC\uC6A9"}</small>
                                  </button>
                                );
                              })}
                            </div>

                            <div className={styles.referenceImage}>
                              <div className={styles.referenceImageMeta}>
                                {card.referenceImage ? (
                                  <img className={styles.referenceImageThumbnail} src={card.referenceImage.sourceUrl} alt={"\uC2DC\uC791 \uC774\uBBF8\uC9C0 \uBBF8\uB9AC\uBCF4\uAE30"} />
                                ) : (
                                  <span className={styles.referenceImagePlaceholder}><ImageIcon size={16} /></span>
                                )}
                                <div>
                                  <strong>{"\uC2DC\uC791 \uC774\uBBF8\uC9C0"}</strong>
                                  <span>{card.referenceImage ? card.referenceImage.originalName + " \u00B7 " + card.referenceImage.width + " \u00D7 " + card.referenceImage.height : "\uC5C6\uC73C\uBA74 \uD14D\uC2A4\uD2B8\u2192\uC601\uC0C1\uC73C\uB85C \uC0DD\uC131\uD569\uB2C8\uB2E4."}</span>
                                </div>
                              </div>
                              {card.referenceImage ? (
                                <button type="button" className={styles.referenceImageButton} onClick={() => updateGenerationCard(card.id, (current) => ({ ...current, referenceImage: null, referenceImageError: null }))} disabled={busy}><Trash2 size={12} /> {"\uC81C\uAC70"}</button>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.referenceImageButton}
                                  onClick={() => { generationUploadTargetRef.current = { cardId: card.id, kind: "image" }; referenceImageInputRef.current?.click(); }}
                                  disabled={busy || card.referenceImageUploading || card.referenceMediaUploading || !CLOUD_UPLOADS_ENABLED || card.referenceMedia.length > 0}
                                >
                                  {card.referenceImageUploading ? <LoaderCircle className={styles.spin} size={12} /> : <ImageIcon size={12} />}
                                  {card.referenceImageUploading ? "\uC5C5\uB85C\uB4DC \uC911" : "\uC2DC\uC791 \uC774\uBBF8\uC9C0 \uCD94\uAC00"}
                                </button>
                              )}
                            </div>
                            {card.referenceImageError && <p className={styles.referenceImageError} role="alert">{card.referenceImageError}</p>}
                            {card.referenceImage && <small className={styles.referenceImageHint}>{"\uC2DC\uC791 \uC774\uBBF8\uC9C0\uAC00 \uC788\uC73C\uBA74 \uC774\uBBF8\uC9C0\u2192\uC601\uC0C1 \uC0DD\uC131\uC73C\uB85C \uC9C4\uD589\uB418\uBA70, \uACB0\uACFC \uBE44\uC728\uC740 \uC6D0\uBCF8 \uC774\uBBF8\uC9C0\uB97C \uB530\uB985\uB2C8\uB2E4."}</small>}

                            <section className={styles.referenceMedia}>
                              <div className={styles.referenceMediaHeader}>
                                <div><strong>{"\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4"}</strong><span>{"PNG "}{referenceImageCount}{"\uAC1C \u00B7 MP4 "}{referenceVideoCount}{"\uAC1C"}</span></div>
                                <button
                                  type="button"
                                  className={styles.referenceImageButton}
                                  onClick={() => { generationUploadTargetRef.current = { cardId: card.id, kind: "media" }; referenceMediaInputRef.current?.click(); }}
                                  disabled={busy || card.referenceImageUploading || card.referenceMediaUploading || !CLOUD_UPLOADS_ENABLED || !modelConfig.supportsReferenceMedia || Boolean(card.referenceImage)}
                                >
                                  {card.referenceMediaUploading ? <LoaderCircle className={styles.spin} size={12} /> : <UploadCloud size={12} />}
                                  {card.referenceMediaUploading ? "\uC5C5\uB85C\uB4DC \uC911" : "\uBBF8\uB514\uC5B4 \uCD94\uAC00"}
                                </button>
                              </div>
                              {!modelConfig.supportsReferenceMedia && <p className={styles.referenceMediaNotice}>{"\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB294 Seedance 2.5 Pro\uC5D0\uC11C\uB9CC \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."}</p>}
                              {card.referenceImage && <p className={styles.referenceMediaNotice}>{"\uC2DC\uC791 \uC774\uBBF8\uC9C0 \uBAA8\uB4DC\uC640 \uB808\uD37C\uB7F0\uC2A4 \uBAA8\uB4DC\uB294 \uD568\uAED8 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>}
                              {card.referenceMedia.length ? (
                                <div className={styles.referenceMediaList}>
                                  {card.referenceMedia.map((media, mediaIndex) => {
                                    const ordinal = card.referenceMedia.slice(0, mediaIndex + 1).filter((entry) => entry.kind === media.kind).length;
                                    const label = "@" + (media.kind === "image" ? "Image" : "Video") + ordinal;
                                    return (
                                      <article className={styles.referenceMediaItem} key={media.id}>
                                        {media.kind === "image" ? <img className={styles.referenceMediaPreview} src={media.asset.sourceUrl} alt={label} /> : <video className={styles.referenceMediaPreview} src={media.asset.sourceUrl} muted playsInline preload="metadata" />}
                                        <div>
                                          <strong>{label}</strong>
                                          <span title={media.asset.originalName}>{media.asset.originalName}</span>
                                          <small>{media.kind === "image" ? media.asset.width + " \u00D7 " + media.asset.height : media.asset.metadata.duration.toFixed(2) + "\uCD08 \u00B7 " + media.asset.metadata.width + " \u00D7 " + media.asset.metadata.height}</small>
                                        </div>
                                        <button type="button" className={styles.referenceMediaRemove} aria-label={label + " \uC81C\uAC70"} onClick={() => updateGenerationCard(card.id, (current) => ({ ...current, referenceMedia: current.referenceMedia.filter((entry) => entry.id !== media.id) }))} disabled={busy}><Trash2 size={12} /></button>
                                      </article>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className={styles.referenceMediaEmpty}>{"PNG \uB610\uB294 MP4\uB97C \uCD94\uAC00\uD558\uBA74 \uC0DD\uC131 \uACB0\uACFC\uC5D0 \uC2A4\uD0C0\uC77C\uACFC \uB3D9\uC791\uC744 \uCC38\uC870\uD569\uB2C8\uB2E4."}</p>
                              )}
                              <small className={styles.referenceMediaHint}>{"\uD504\uB86C\uD504\uD2B8\uC5D0 @Image1, @Video1\uCC98\uB7FC \uC21C\uC11C\uBCC4 \uC774\uB984\uC744 \uC4F0\uBA74 \uD574\uB2F9 \uB808\uD37C\uB7F0\uC2A4\uB97C \uC9C0\uC815\uD574 \uC124\uBA85\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."}</small>
                            </section>
                            {card.referenceMediaError && <p className={styles.referenceImageError} role="alert">{card.referenceMediaError}</p>}
                            {referenceError && <p className={styles.referenceImageError} role="alert">{referenceError}</p>}

                            <label className={[styles.clipPrompt, styles.generationDraftPrompt].join(" ")}>
                              <span>{"\uC774 \uCEF7\uC758 \uC601\uC0C1 \uC124\uBA85"}</span>
                              <textarea
                                rows={5}
                                value={card.prompt}
                                placeholder={"\uC608: \uC5B4\uB450\uC6B4 \uB358\uC804\uC5D0\uC11C \uAC8C\uC784 \uCE90\uB9AD\uD130\uAC00 \uBCF4\uC2A4\uC640 \uACA9\uB82C\uD558\uB294 \uC5ED\uB3D9\uC801\uC778 \uC804\uD22C \uC7A5\uBA74"}
                                onChange={(event) => updateGenerationCard(card.id, (current) => ({ ...current, prompt: event.target.value, error: null }))}
                                disabled={busy}
                              />
                              <small>{"\uAC01 \uCEF7\uC758 \uACB0\uACFC\uB294 \uC544\uB798\uC758 \uCEF7 \uBC88\uD638 \uC21C\uC11C\uB300\uB85C \uD0C0\uC784\uB77C\uC778\uC5D0 \uC5F0\uACB0\uB429\uB2C8\uB2E4."}</small>
                            </label>

                            <fieldset className={styles.generationRatioSelector}>
                              <legend>{"\uC0DD\uC131 \uD654\uBA74 \uBE44\uC728"}</legend>
                              <div className={styles.generationRatioGrid} role="group" aria-label={"\uC0DD\uC131 \uD654\uBA74 \uBE44\uC728"}>
                                {seedanceAspectRatioOptions.map((option) => {
                                  const selected = card.aspectRatio === option.value;
                                  return (
                                    <button
                                      type="button"
                                      key={option.value}
                                      className={[styles.generationRatioOption, selected ? styles.generationRatioOptionActive : ""].filter(Boolean).join(" ")}
                                      onClick={() => updateGenerationCard(card.id, (current) => ({ ...current, aspectRatio: option.value, error: null }))}
                                      disabled={busy || Boolean(card.referenceImage)}
                                      aria-pressed={selected}
                                    >
                                      <span className={styles.generationRatioIcon} style={{ aspectRatio: option.visualRatio }} />
                                      <strong>{option.label}</strong>
                                    </button>
                                  );
                                })}
                              </div>
                              {card.referenceImage && <small className={styles.generationRatioNotice}>{"\uC2DC\uC791 \uC774\uBBF8\uC9C0\uB97C \uC4F0\uBA74 \uC774\uBBF8\uC9C0 \uC6D0\uBCF8 \uBE44\uC728\uC774 \uC801\uC6A9\uB429\uB2C8\uB2E4."}</small>}
                            </fieldset>

                            <div className={styles.aiOptions}>
                              <label><span>{"\uAE38\uC774"}</span><input type="number" min={4} max={modelConfig.maxDuration} step={1} value={card.duration} disabled={busy} onChange={(event) => updateGenerationCard(card.id, (current) => ({ ...current, duration: Math.max(4, Math.min(modelConfig.maxDuration, Math.round(Number(event.target.value) || 4))), error: null }))} /></label>
                              <label><span>{"\uD654\uC9C8"}</span><select value={card.resolution} disabled={busy} onChange={(event) => updateGenerationCard(card.id, (current) => ({ ...current, resolution: event.target.value as SeedanceResolution, error: null }))}><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
                              <label className={styles.aiSound}><input type="checkbox" checked={card.soundEffects} disabled={busy} onChange={(event) => updateGenerationCard(card.id, (current) => ({ ...current, soundEffects: event.target.checked, error: null }))} /><span>{"\uD6A8\uACFC\uC74C \uC0DD\uC131"}</span></label>
                            </div>
                            <small className={styles.referenceMediaHint}>{"\uD604\uC7AC \uBAA8\uB378 \uC0DD\uC131 \uAE38\uC774: 4~"}{modelConfig.maxDuration}{"\uCD08"}</small>

                            <div className={[styles.aiActions, styles.generationDraftActionsPrimary].filter(Boolean).join(" ")}>
                              <button
                                type="button"
                                disabled={busy || !card.prompt.trim() || Boolean(referenceError)}
                                onClick={() => void startGenerationForCard(card.id)}
                              >
                                {busy ? <LoaderCircle className={styles.spin} size={13} /> : card.job?.status === "completed" || card.job?.status === "failed" ? <RefreshCw size={13} /> : <Sparkles size={13} />}
                                {busy ? "\uC0DD\uC131 \uC911" : card.job?.status === "completed" || card.job?.status === "failed" ? "\uB2E4\uC2DC \uC0DD\uC131" : "\uC0DD\uC131 \uC2DC\uC791"}
                              </button>
                            </div>
                            {card.job && (
                              <div className={[styles.generationStatus, statusClass].filter(Boolean).join(" ")}>
                                {busy ? <LoaderCircle className={styles.spin} size={14} /> : card.job.status === "completed" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                                <span>{card.job.stage}</span>
                              </div>
                            )}
                            {error && <p className={styles.errorBox}>{error}</p>}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
              <p className={styles.aiHint}>{"\uAC01 \uC0DD\uC131 \uC694\uCCAD\uC740 Magnific API \uD06C\uB808\uB527\uC744 \uC0AC\uC6A9\uD558\uBA70, \uACB0\uACFC \uC601\uC0C1\uC740 \uC791\uC5C5 \uC21C\uC11C\uB300\uB85C \uD0C0\uC784\uB77C\uC778\uC5D0 \uC5F0\uACB0\uB429\uB2C8\uB2E4."}</p>
            </div>
          </div>
          <div
            id="editor-panel-captions"
            role="region"
            aria-label={"\uC790\uB9C9\uACFC PNG \uD3B8\uC9D1"}
            hidden={activeEditorMode !== "captions"}
            className={`${styles.card} ${styles.copyCard}`}
          >
            <div className={styles.sectionTitleRow}>
              <div className={styles.sectionTitle}>
                <span className={styles.panelIcon}><Layers3 size={16} /></span>
                <div><h2>레이어 편집</h2><p>텍스트와 PNG 모두 전체 타임라인 기준입니다</p></div>
              </div>
              <div className={styles.inlineActions}>
                <input
                  ref={graphicInputRef}
                  className={styles.hiddenInput}
                  type="file"
                  accept="image/png,.png"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadGraphic(file);
                  }}
                />

                <button type="button" onClick={addExamples} disabled={!clips.length || items.length > 17}>
                  <Sparkles size={15} /> 예제 3개 추가
                </button>
              </div>
            </div>

            <div className={styles.assetTools} aria-label="에셋 추가 도구">
              <button type="button" onClick={() => { setActiveEditorMode("captions"); requestAnimationFrame(() => graphicInputRef.current?.click()); }} disabled={!asset || graphicUploading || graphics.length >= 10}>
                {graphicUploading ? <LoaderCircle className={styles.spin} size={17} /> : <ImageIcon size={17} />}<span>PNG 글자</span><small>투명 이미지</small>
              </button>
              <button type="button" disabled title="배경 제거 기능은 준비 중입니다">
                <Sparkles size={17} /><span>배경 제거</span><small>준비 중</small>
              </button>
              <button type="button" onClick={() => { setActiveEditorMode("captions"); addItem(); }} disabled={!clips.length || items.length >= 20}>
                <Type size={17} /><span>문구 추가</span><small>전체 타임라인</small>
              </button>
            </div>

            {clips.length > 0 && (
              <div className={styles.timelineScopeNotice}>
                <strong>전체 타임라인 0초–{totalClipDuration.toFixed(2)}초</strong>
                <span>텍스트와 PNG는 컷 경계를 넘어 표시할 수 있습니다. 예: 3초–{totalClipDuration.toFixed(2)}초</span>
              </div>
            )}
            {!asset && <div className={styles.empty}>먼저 영상을 업로드하면 문구를 편집할 수 있습니다.</div>}
            {asset && items.length === 0 && graphics.length === 0 && <div className={styles.empty}>문구를 입력하거나 투명 PNG 글자를 추가해 보세요.</div>}

            {graphicError && <p className={styles.errorBox}>{graphicError}</p>}
            {asset && <p className={styles.captionInputHint}>{"\uC790\uB9C9 \uB0B4\uC6A9\uC744 \uD06C\uAC8C \uC785\uB825\uD558\uACE0, \uC544\uB798\uC5D0\uC11C \uB178\uCD9C \uC2DC\uC791\uACFC \uC885\uB8CC \uC2DC\uAC04\uC744 \uC815\uD558\uC138\uC694."}</p>}

            <div className={styles.itemList}>
              {items.map((item, index) => {
                const errors = getItemErrors(item, totalClipDuration);
                const overflow = estimateOverflow(item);
                return (
                  <article className={`${styles.textCard} ${errors.length ? styles.invalid : ""}`} key={item.id}>
                    <div className={styles.textCardHeader}>
                      <strong>문구 {index + 1}</strong>
                      <button type="button" className={styles.iconButton} aria-label={`문구 ${index + 1} 삭제`} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>
                        <Trash2 size={17} />
                      </button>
                    </div>

                    <label className={styles.fieldWide}>
                      <span>문구</span>
                      <textarea aria-label={"\uC790\uB9C9 \uBB38\uAD6C"} rows={4} maxLength={180} placeholder={"\uC790\uB9C9\uC744 \uC785\uB825\uD558\uC138\uC694. Enter\uB85C \uC904\uBC14\uAFC8\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."} value={item.text} onChange={(event) => updateItem(item.id, "text", event.target.value)} />
                    </label>

                    <div className={styles.quickFieldGrid}>
                      <label><span>시작 (초)</span><input type="number" min="0" max={Math.max(0, totalClipDuration - 1 / previewFps)} step="0.01" value={item.start} onChange={(event) => updateItemStart(item.id, event.target.valueAsNumber)} /></label>
                      <label><span>종료 (초)</span><input type="number" min={1 / previewFps} max={totalClipDuration} step="0.01" value={item.end} onChange={(event) => updateItemEnd(item.id, event.target.valueAsNumber)} /></label>
                      <label><span>위치</span><select value={item.position} onChange={(event) => updateItem(item.id, "position", event.target.value as TextPosition)}>{positions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label><span>모션</span><select value={item.motion} onChange={(event) => updateItem(item.id, "motion", event.target.value as MotionPreset)}>{motions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    </div>
                    <div className={styles.globalRangeEditor}>
                      <div className={styles.globalRangeHeader}>
                        <strong>전체 노출 구간</strong>
                        <span>{item.start.toFixed(2)}초 → {item.end.toFixed(2)}초 / 총 {totalClipDuration.toFixed(2)}초</span>
                      </div>
                      <div className={styles.globalRangeTrack} aria-hidden="true">
                        <span
                          style={{
                            left: `${totalClipDuration ? item.start / totalClipDuration * 100 : 0}%`,
                            width: `${totalClipDuration ? Math.max(0, item.end - item.start) / totalClipDuration * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <label>
                        <span>시작</span>
                        <input type="range" min="0" max={Math.max(0, totalClipDuration - 1 / previewFps)} step="0.01" value={item.start} onChange={(event) => updateItemStart(item.id, event.target.valueAsNumber)} />
                      </label>
                      <label>
                        <span>종료</span>
                        <input type="range" min={1 / previewFps} max={totalClipDuration} step="0.01" value={item.end} onChange={(event) => updateItemEnd(item.id, event.target.valueAsNumber)} />
                      </label>
                    </div>

                    <details className={styles.styleDetails}>
                      <summary>색상 · 크기 · 테두리 · 그림자</summary>
                      <div className={styles.fieldGrid}>
                      <label><span>시작 시간 (초)</span><input type="number" min="0" max={Math.max(0, totalClipDuration - 1 / previewFps)} step="0.01" value={item.start} onChange={(event) => updateItemStart(item.id, event.target.valueAsNumber)} /></label>
                      <label><span>종료 시간 (초)</span><input type="number" min={1 / previewFps} max={totalClipDuration} step="0.01" value={item.end} onChange={(event) => updateItemEnd(item.id, event.target.valueAsNumber)} /></label>
                      <label><span>위치</span><select value={item.position} onChange={(event) => updateItem(item.id, "position", event.target.value as TextPosition)}>{positions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label><span>모션</span><select value={item.motion} onChange={(event) => updateItem(item.id, "motion", event.target.value as MotionPreset)}>{motions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label><span>글자 크기</span><input type="number" min="24" max="140" value={item.fontSize} onChange={(event) => updateItem(item.id, "fontSize", event.target.valueAsNumber)} /></label>
                      <label><span>테두리 두께</span><input type="number" min="0" max="16" value={item.strokeWidth} onChange={(event) => updateItem(item.id, "strokeWidth", event.target.valueAsNumber)} /></label>
                      <label><span>글자 색상</span><span className={styles.colorInput}><input type="color" value={item.color} onChange={(event) => updateItem(item.id, "color", event.target.value.toUpperCase())} /><code>{item.color}</code></span></label>
                      <label><span>테두리 색상</span><span className={styles.colorInput}><input type="color" value={item.strokeColor} onChange={(event) => updateItem(item.id, "strokeColor", event.target.value.toUpperCase())} /><code>{item.strokeColor}</code></span></label>
                    </div>
                    <label className={styles.checkbox}>
                      <input type="checkbox" checked={item.shadow} onChange={(event) => updateItem(item.id, "shadow", event.target.checked)} /> 그림자 사용
                    </label>
                    </details>
                    {errors.map((error) => <p className={styles.itemError} key={error}><AlertTriangle size={14} /> {error}</p>)}
                    {overflow && <p className={styles.itemWarning}><AlertTriangle size={14} /> 문구가 화면 높이를 벗어날 수 있습니다. 줄 수나 글자 크기를 줄이고 미리보기에서 확인해 주세요.</p>}
                  </article>
                );
              })}
              {graphics.map((item, index) => {
                const errors = getGraphicItemErrors(item, totalClipDuration);
                return (
                  <article className={`${styles.textCard} ${styles.graphicCard} ${errors.length ? styles.invalid : ""}`} key={item.id}>
                    <div className={styles.textCardHeader}>
                      <div className={styles.graphicIdentity}>
                        <img src={item.sourceUrl} alt="" />
                        <span><strong>PNG 카피 {index + 1}</strong><small>{item.originalName} · {item.intrinsicWidth}×{item.intrinsicHeight}</small></span>
                      </div>
                      <button type="button" className={styles.iconButton} aria-label={`PNG 카피 ${index + 1} 삭제`} onClick={() => setGraphics((current) => current.filter((entry) => entry.id !== item.id))}>
                        <Trash2 size={17} />
                      </button>
                    </div>
                    <GraphicPlacementPreview
                      item={item}
                      videoSrc={asset!.sourceUrl}
                      playbackActive={isPlaying}
                      aspectMode={aspectMode}
                      width={outputDimensions.width}
                      height={outputDimensions.height}
                      onPositionChange={(xPercent, yPercent) => {
                        setGraphics((current) => current.map((entry) =>
                          entry.id === item.id ? { ...entry, xPercent, yPercent } : entry
                        ));
                      }}
                      onWidthChange={(widthPercent) => updateGraphic(item.id, "widthPercent", widthPercent)}
                    />
                    <div className={styles.quickFieldGrid}>
                      <label><span>시작 (초)</span><input type="number" min="0" max={Math.max(0, totalClipDuration - 1 / previewFps)} step="0.01" value={item.start} onChange={(event) => updateGraphicStart(item.id, event.target.valueAsNumber)} /></label>
                      <label><span>종료 (초)</span><input type="number" min={1 / previewFps} max={totalClipDuration} step="0.01" value={item.end} onChange={(event) => updateGraphicEnd(item.id, event.target.valueAsNumber)} /></label>
                      <label><span>모션</span><select value={item.motion} onChange={(event) => updateGraphic(item.id, "motion", event.target.value as MotionPreset)}>{motions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label><span>크기 (%)</span><input type="number" min="5" max="100" step="1" value={item.widthPercent} onChange={(event) => updateGraphic(item.id, "widthPercent", event.target.valueAsNumber)} /></label>
                    </div>
                    <div className={styles.globalRangeEditor}>
                      <div className={styles.globalRangeHeader}>
                        <strong>PNG 전체 노출 구간</strong>
                        <span>{item.start.toFixed(2)}초 → {item.end.toFixed(2)}초 / 총 {totalClipDuration.toFixed(2)}초</span>
                      </div>
                      <div className={styles.globalRangeTrack} aria-hidden="true">
                        <span
                          style={{
                            left: `${totalClipDuration ? item.start / totalClipDuration * 100 : 0}%`,
                            width: `${totalClipDuration ? Math.max(0, item.end - item.start) / totalClipDuration * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <label>
                        <span>시작</span>
                        <input type="range" min="0" max={Math.max(0, totalClipDuration - 1 / previewFps)} step="0.01" value={item.start} onChange={(event) => updateGraphicStart(item.id, event.target.valueAsNumber)} />
                      </label>
                      <label>
                        <span>종료</span>
                        <input type="range" min={1 / previewFps} max={totalClipDuration} step="0.01" value={item.end} onChange={(event) => updateGraphicEnd(item.id, event.target.valueAsNumber)} />
                      </label>
                    </div>
                    <div className={styles.graphicPositionGrid}>
                      <label><span>가로 위치 {item.xPercent}%</span><input type="range" min="0" max="100" step="1" value={item.xPercent} onChange={(event) => updateGraphic(item.id, "xPercent", event.target.valueAsNumber)} /></label>
                      <label><span>세로 위치 {item.yPercent}%</span><input type="range" min="0" max="100" step="1" value={item.yPercent} onChange={(event) => updateGraphic(item.id, "yPercent", event.target.valueAsNumber)} /></label>
                    </div>
                    <label className={styles.checkbox}>
                      <input type="checkbox" checked={item.shadow} onChange={(event) => updateGraphic(item.id, "shadow", event.target.checked)} /> 그림자 사용
                    </label>
                    {!item.sourceUrl.includes("graphics") && <p className={styles.itemWarning}><AlertTriangle size={14} /> PNG 주소가 올바르지 않습니다.</p>}
                    {errors.map((error) => <p className={styles.itemError} key={error}><AlertTriangle size={14} /> {error}</p>)}
                  </article>
                );
              })}
            </div>
          </div>

          <div
            id="editor-panel-video"
            role="region"
            aria-label={"\uC601\uC0C1 \uC5D0\uC14B"}
            hidden={activeEditorMode !== "video"}
            className={`${styles.card} ${styles.uploadCard}`}
          >
            <div className={styles.panelHeader}>
              <div className={styles.sectionTitle}>
                <span className={styles.panelIcon}><UploadCloud size={16} /></span>
                <div><h2>영상 에셋</h2><p>편집할 원본을 추가하세요</p></div>
              </div>
              <span className={styles.countBadge}>{clips.length}개 컷</span>
            </div>

            <input
              ref={inputRef}
              className={styles.hiddenInput}
              type="file"
              accept="video/mp4,.mp4"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length) void addClipFiles(files);
              }}
            />
            <input
              ref={replaceInputRef}
              className={styles.hiddenInput}
              type="file"
              accept="video/mp4,.mp4"
              onChange={(event) => {
                const file = event.target.files?.[0];
                const clipId = replaceTargetRef.current;
                if (file && clipId) void replaceClipFile(clipId, file);
              }}
            />
            <button
              type="button"
              className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const files = Array.from(event.dataTransfer.files ?? []);
                if (files.length) void addClipFiles(files);
              }}
            >
              <span className={styles.uploadIcon}>{uploading ? <LoaderCircle className={styles.spin} /> : <UploadCloud />}</span>
              <strong>{uploading ? "영상 분석 및 저장 중…" : clips.length ? "영상 컷 더 추가" : "영상을 드래그하거나 선택"}</strong>
              <span>{clips.length ? "여러 MP4를 추가하거나 아래에서 개별 교체하세요" : "여러 파일을 한 번에 선택할 수 있습니다"}</span>
              <span className={styles.formatTags}>
                <em>MP4</em><em>최대 {CLOUD_UPLOADS_ENABLED ? "50MB" : "100MB"}</em><em>최대 30초</em>
              </span>
            </button>
            {uploadError && <p className={styles.errorBox}>{uploadError}</p>}
            {selectedClip && asset && (
              <div className={styles.assetCard}>
                {isPlaying ? (
                  <span className={styles.assetThumbnailPlaceholder}><Film size={18} /></span>
                ) : (
                  <video className={styles.assetThumbnail} src={asset.sourceUrl} muted playsInline preload="metadata" />
                )}
                <div className={styles.assetInfo}>
                  <strong title={asset.originalName}>{asset.originalName}</strong>
                  <span>선택 컷 {selectedClipIndex + 1} · 버전 {selectedClip.version} · {asset.metadata.duration.toFixed(2)}초</span>
                  <span>{asset.metadata.width}×{asset.metadata.height} · 원본 {asset.metadata.fps.toFixed(2)}fps</span>
                  <span>{assetFileSize ? `${(assetFileSize / 1024 / 1024).toFixed(1)}MB · ` : ""}{asset.metadata.hasAudio ? "오디오 있음" : "무음 영상"}</span>
                </div>
                <button type="button" className={styles.assetRemove} aria-label="선택 컷 삭제" onClick={() => removeClip(selectedClip.id)}><Trash2 size={15} /></button>
              </div>
            )}

            {clips.length > 0 && (
              <div className={styles.clipManager}>
                <div className={styles.clipManagerHeader}>
                  <span><Layers3 size={13} /> 컷 구성</span>
                  <button type="button" onClick={startSequencePlayback}>
                    <Play size={12} /> 전체 재생
                  </button>
                </div>
                <div className={styles.clipManagerList}>
                  {clips.map((clip, index) => {
                    const clipStart = (clipStartFrames[index] ?? 0) / previewFps;
                    const clipEnd = clipStart + (clipFrameCounts[index] ?? 1) / previewFps;
                    const textLayerCount = items.filter((item) => item.end > clipStart && item.start < clipEnd).length;
                    const graphicLayerCount = graphics.filter((item) => item.end > clipStart && item.start < clipEnd).length;
                    return (
                      <article
                      key={clip.id}
                      className={clip.id === selectedClipId ? styles.selectedClipCard : ""}
                      onClick={() => selectClip(clip.id)}
                    >
                      {isPlaying ? (
                        <span className={styles.clipThumbnailPlaceholder}><Film size={15} /></span>
                      ) : (
                        <video src={clip.asset.sourceUrl} muted playsInline preload="metadata" />
                      )}
                      <span className={styles.clipNumber}>{index + 1}</span>
                      <div>
                        <strong title={clip.asset.originalName}>{clip.asset.originalName}</strong>
                        <small>{clip.asset.metadata.duration.toFixed(2)}초 · {clip.asset.metadata.fps.toFixed(1)}fps · 레이어 {textLayerCount + graphicLayerCount}개</small>
                      </div>
                      <div className={styles.clipCardActions}>
                        <button type="button" title="앞으로 이동" disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveClip(clip.id, -1); }}><ChevronLeft size={13} /></button>
                        <button type="button" title="뒤로 이동" disabled={index === clips.length - 1} onClick={(event) => { event.stopPropagation(); moveClip(clip.id, 1); }}><ChevronRight size={13} /></button>
                        <button type="button" title="이 컷만 새 MP4로 교체" onClick={(event) => { event.stopPropagation(); replaceTargetRef.current = clip.id; replaceInputRef.current?.click(); }}><RefreshCw size={12} /></button>
                      </div>
                      </article>
                    );
                  })}
                </div>
                <p className={styles.sequenceSummary}>총 {clips.length}개 컷 · {totalClipDuration.toFixed(2)}초</p>
              </div>
            )}


          </div>
          </div>
          </section>
        </section>

        <section
          id="editing-workspace"
          className={[styles.editingWorkspace, workspaceView !== "edit" ? styles.workspaceViewHidden : ""].filter(Boolean).join(" ")}
          aria-labelledby="editing-workspace-heading"
          aria-hidden={workspaceView !== "edit"}
        >
          <div className={styles.editingWorkspaceHeading}>
            <div>
              <span><MonitorPlay size={16} /> {"\uD3B8\uC9D1 \uB3C4\uAD6C"}</span>
              <h2 id="editing-workspace-heading">{"\uBBF8\uB9AC\uBCF4\uAE30\uC640 \uD0C0\uC784\uB77C\uC778\uC73C\uB85C \uC804\uCCB4 \uAD6C\uC131\uC744 \uB2E4\uB4EC\uC73C\uC138\uC694"}</h2>
              <p>{"\uCEF7 \uC21C\uC11C, \uC790\uB9C9\u00B7PNG \uD0C0\uC774\uBC0D, \uCD9C\uB825 \uBE44\uC728\uACFC \uB80C\uB354\uB9C1\uC744 \uD55C \uACF3\uC5D0\uC11C \uD655\uC778\uD558\uC138\uC694."}</p>
            </div>
            <span className={styles.editingWorkspaceMeta}>
              <Film size={15} /> {clips.length ? clips.length + "\uAC1C \uCEF7 \u00B7 " + totalClipDuration.toFixed(2) + "\uCD08" : "\uC544\uC9C1 \uC900\uBE44\uB41C \uCEF7\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"}
            </span>
          </div>
        <aside className={styles.previewColumn}>
          <div className={styles.sticky}>
            <section className={styles.canvasPanel} ref={previewSectionRef}>
              <div className={styles.previewHeading}>
                <div><span className={styles.liveDot} /> {selectedClip ? `컷 ${selectedClipIndex + 1}/${clips.length}` : "컴포지션"} 미리보기</div>
                <span>{outputDimensions.width} × {outputDimensions.height} · 미리보기 {previewFps}fps · 출력 {OUTPUT_FPS}fps · 전체 {totalClipDuration.toFixed(2)}초</span>
              </div>
              <div className={styles.canvasSurface}>
                <div className={styles.playerShell} style={{ aspectRatio: `${outputDimensions.width} / ${outputDimensions.height}` }}>
                  {clips.length ? (
                    <Player
                      ref={playerRef}
                      key={sequencePlayerKey}
                      component={VideoAdSequenceComposition}
                      inputProps={previewInputProps}
                      durationInFrames={sequenceDurationInFrames}
                      compositionWidth={outputDimensions.width}
                      compositionHeight={outputDimensions.height}
                      fps={previewFps}
                      controls={false}
                      loop={false}
                      moveToBeginningWhenEnded={false}
                      style={{ width: "100%", height: "100%" }}
                    />
                  ) : (
                    <div className={styles.previewEmpty}>
                      <span className={styles.emptyPreviewIcon}><MonitorPlay size={34} /></span>
                      <strong>영상을 업로드하면 미리보기가 시작됩니다</strong>
                      <span>왼쪽 에셋 패널에 MP4 파일을 추가하세요</span>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.transport}>
                <span className={styles.timecode}>{formatTime(currentFrame / previewFps)}</span>
                <div className={styles.transportButtons}>
                  <button type="button" aria-label="이전 프레임" disabled={!asset} onClick={() => playerRef.current?.seekTo(Math.max(0, currentFrameRef.current - 1))}><SkipBack size={16} /></button>
                  <button type="button" className={styles.playButton} aria-label={isPlaying ? "일시정지" : "재생"} disabled={!asset} onClick={(event) => playerRef.current?.toggle(event)}>{isPlaying ? <Pause size={17} /> : <Play size={17} />}</button>
                  <button type="button" aria-label="다음 프레임" disabled={!asset} onClick={() => playerRef.current?.seekTo(Math.min(sequenceDurationInFrames - 1, currentFrameRef.current + 1))}><SkipForward size={16} /></button>
                </div>
                <div className={styles.transportUtility}>
                  <button type="button" aria-label={isMuted ? "음소거 해제" : "음소거"} disabled={!asset || !hasSequenceAudio} onClick={() => { const player = playerRef.current; if (!player) return; if (player.isMuted()) player.unmute(); else player.mute(); }}>{isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
                  <button type="button" aria-label="전체 화면" disabled={!asset} onClick={() => playerRef.current?.requestFullscreen()}><Maximize2 size={16} /></button>
                </div>
              </div>

              <div className={styles.timelinePanel}>
                <div className={styles.timelineHeader}>
                  <div><Layers3 size={15} /><strong>타임라인</strong></div>
                  <span>{asset ? `스냅 ON · ${currentFrame + 1} / ${sequenceDurationInFrames} 프레임` : "레이어가 여기에 표시됩니다"}</span>
                </div>
                <div className={styles.timelineRuler}>
                  <span>0초</span><span>{totalClipDuration ? `${(totalClipDuration / 2).toFixed(1)}초` : "—"}</span><span>{totalClipDuration ? `${totalClipDuration.toFixed(1)}초` : "—"}</span>
                </div>
                {clips.length > 0 && <p className={styles.timelineHint}>영상 바 드래그: 순서 변경 · 텍스트/이미지 가운데: 이동 · 양끝: 길이 조절 · 경계 자동 스냅</p>}
                {clips.length > 0 && (
                  <div className={styles.sequenceTimeline}>
                    <span className={styles.trackLabel}><Film size={14} /> 전체 컷</span>
                    <div className={styles.sequenceLane}>
                      {clips.map((clip, index) => (
                        <button
                          type="button"
                          key={clip.id}
                          draggable
                          className={clip.id === selectedClipId ? styles.selectedSequenceClip : ""}
                          style={{ width: `${clip.asset.metadata.duration / totalClipDuration * 100}%` }}
                          onClick={() => selectClip(clip.id)}
                          onDragStart={(event) => {
                            draggedClipIdRef.current = clip.id;
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", clip.id);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const sourceId = draggedClipIdRef.current || event.dataTransfer.getData("text/plain");
                            if (sourceId) reorderClip(sourceId, clip.id);
                            draggedClipIdRef.current = null;
                          }}
                          onDragEnd={() => { draggedClipIdRef.current = null; }}
                          title={`${clip.asset.originalName} · 드래그해서 순서 변경`}
                        >
                          {index + 1}
                        </button>
                      ))}
                      <span
                        className={styles.sequencePlayhead}
                        style={{ left: `${Math.min(100, sequenceCurrentTime / totalClipDuration * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className={styles.timelineBody}>
                  {timelineTracks.map(({ key, label, icon: TrackIcon }) => (
                    <div className={styles.timelineRow} key={key}>
                      <span className={styles.trackLabel}><TrackIcon size={14} /> {label}</span>
                      <div className={styles.trackLane}>
                        {timelineSegments[key].map((segment, index) => {
                          const editableTrack = key === "text" || key === "image" ? key : null;
                          const segmentStyle = {
                            left: `${totalClipDuration ? Math.max(0, segment.start / totalClipDuration * 100) : 0}%`,
                            width: `${totalClipDuration ? Math.max(1.5, (segment.end - segment.start) / totalClipDuration * 100) : 0}%`,
                          };
                          if (!editableTrack) {
                            return <span className={`${styles.timelineClip} ${styles[`timelineClip${key}`]}`} key={segment.id} style={segmentStyle}>{key === "video" ? `컷 ${index + 1}` : `${label} ${index + 1}`}</span>;
                          }
                          return (
                            <div
                              className={`${styles.timelineClip} ${styles.timelineClipEditable} ${styles[`timelineClip${key}`]}`}
                              key={segment.id}
                              style={segmentStyle}
                              role="slider"
                              tabIndex={0}
                              aria-label={`${label} ${index + 1} · ${segment.start.toFixed(2)}초부터 ${segment.end.toFixed(2)}초`}
                              onPointerDown={(event) => beginTimelineDrag(event, editableTrack, segment.id, "move", segment.start, segment.end)}
                              onPointerMove={moveTimelineDrag}
                              onPointerUp={endTimelineDrag}
                              onPointerCancel={endTimelineDrag}
                              title="가운데를 드래그해 이동 · 양끝을 드래그해 길이 조절"
                            >
                              <span
                                className={`${styles.timelineResizeHandle} ${styles.timelineResizeStart}`}
                                onPointerDown={(event) => beginTimelineDrag(event, editableTrack, segment.id, "resize-start", segment.start, segment.end)}
                                onPointerMove={moveTimelineDrag}
                                onPointerUp={endTimelineDrag}
                                onPointerCancel={endTimelineDrag}
                              />
                              <span className={styles.timelineClipLabel}>{label} {index + 1}</span>
                              <span
                                className={`${styles.timelineResizeHandle} ${styles.timelineResizeEnd}`}
                                onPointerDown={(event) => beginTimelineDrag(event, editableTrack, segment.id, "resize-end", segment.start, segment.end)}
                                onPointerMove={moveTimelineDrag}
                                onPointerUp={endTimelineDrag}
                                onPointerCancel={endTimelineDrag}
                              />
                            </div>
                          );
                        })}
                        {snapGuide !== null && (
                          <span className={styles.snapGuide} style={{ left: `${snapGuide / totalClipDuration * 100}%` }} />
                        )}
                        {asset && <span className={styles.playhead} style={{ left: `${Math.min(100, currentFrame / Math.max(1, sequenceDurationInFrames - 1) * 100)}%` }} />}
                      </div>
                    </div>
                  ))}
                </div>
                {asset && (
                  <input
                    className={styles.timelineScrubber}
                    type="range"
                    aria-label="재생 위치"
                    min="0"
                    max={Math.max(0, sequenceDurationInFrames - 1)}
                    value={Math.min(currentFrame, sequenceDurationInFrames - 1)}
                    onChange={(event) => playerRef.current?.seekTo(event.target.valueAsNumber)}
                  />
                )}
              </div>
            </section>

            <details className={styles.renderCard} open>
              <summary className={styles.settingsSummary}><span><Settings2 size={16} /> 출력 설정</span><ChevronDown size={16} /></summary>
              <div className={styles.sectionTitle}>
                <span className={styles.panelIcon}><Settings2 size={16} /></span>
                <div><h2>출력 설정</h2><p>모든 컷을 타임라인 순서대로 하나의 영상으로 만듭니다</p></div>
              </div>
              <div className={styles.ratioGrid}>
                {outputRatios.map((ratio) => {
                  const dimensions = OUTPUT_RATIOS[ratio];
                  return (
                    <label key={ratio} className={outputRatio === ratio ? styles.selected : ""}>
                      <input type="radio" name="ratio" value={ratio} checked={outputRatio === ratio} onChange={() => setOutputRatio(ratio)} />
                      <span className={styles.ratioIcon} style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }} />
                      <strong>{ratio}</strong>
                      {outputRatio === ratio && <Check className={styles.ratioCheck} size={12} />}
                    </label>
                  );
                })}
              </div>
              <p className={styles.fitLabel}>편집 모드</p>
              <div className={styles.segmented}>
                <label className={aspectMode === "cover" ? styles.selected : ""}>
                  <input type="radio" name="fit" value="cover" checked={aspectMode === "cover"} onChange={() => setAspectMode("cover")} />
                  <span className={styles.fitIcon}><Maximize2 size={15} /></span>
                  <span><strong>화면 꽉 채우기 <em>추천</em></strong><small>원본을 확대해 여백 없이 출력</small></span>
                  {aspectMode === "cover" && <Check size={14} />}
                </label>
                <label className={aspectMode === "contain" ? styles.selected : ""}>
                  <input type="radio" name="fit" value="contain" checked={aspectMode === "contain"} onChange={() => setAspectMode("contain")} />
                  <span className={styles.fitIcon}><MonitorPlay size={15} /></span>
                  <span><strong>영상 전체 보기</strong><small>원본 전체를 유지하고 여백 허용</small></span>
                  {aspectMode === "contain" && <Check size={14} />}
                </label>
              </div>

              <div className={styles.qualityCard}>
                <div><span>출력 해상도</span><strong>{outputDimensions.width} × {outputDimensions.height}</strong></div>
                <div><span>프레임</span><strong>{OUTPUT_FPS} fps</strong></div>
                <div><span>코덱</span><strong>H.264 · MP4</strong></div>
              </div>

              {editorErrors.length > 0 && asset && <p className={styles.validationSummary}><AlertTriangle size={15} /> 수정할 문구 설정이 {editorErrors.length}개 있습니다.</p>}
              {renderError && <p className={styles.errorBox} style={{ whiteSpace: "pre-line" }}>{renderError}</p>}

              {job && (
                <div className={`${styles.jobStatus} ${styles[job.status]}`}>
                  <div>
                    {job.status === "completed" ? <CheckCircle2 size={18} /> : job.status === "failed" ? <AlertTriangle size={18} /> : <LoaderCircle className={styles.spin} size={18} />}
                    <strong>{job.stage}</strong>
                    {typeof job.progress === "number" && <span>{Math.round(job.progress * 100)}%</span>}
                  </div>
                  {job.error && <p>{job.error}</p>}
                  {(job.status === "queued" || job.status === "rendering") && <small>작업 ID {job.id.slice(0, 8)} · 시작 시점의 설정으로 렌더링합니다.</small>}
                </div>
              )}

              {job?.status === "completed" && job.downloadUrl ? (
                <a className={styles.primaryButton} href={job.downloadUrl}><Download size={18} /> 완성 영상 다운로드</a>
              ) : (
                <button type="button" className={styles.primaryButton} disabled={!asset || activeJob || editorErrors.length > 0} onClick={() => void startRender()}>
                  {activeJob ? <LoaderCircle className={styles.spin} size={18} /> : <Film size={18} />}
                  <span><strong>{activeJob ? "렌더링 중…" : job?.status === "failed" ? "다시 렌더링" : "전체 영상 렌더링"}</strong><small>{clips.length}개 컷 · 전체 {totalClipDuration.toFixed(2)}초 · 크레딧 0</small></span>
                </button>
              )}
              {job?.status === "completed" && (
                <button type="button" className={styles.secondaryButton} onClick={() => void startRender()} disabled={!asset || editorErrors.length > 0}>현재 설정으로 새 영상 만들기</button>
              )}
              <p className={styles.workerHint}>렌더 워커가 켜져 있어야 대기 작업이 처리됩니다: <code>pnpm worker</code></p>
            </details>
          </div>
        </aside>
        </section>
      </div>
    </main>
  );
}
