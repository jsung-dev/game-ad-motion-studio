"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { createClient } from "@supabase/supabase-js";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Download, Film, ImageIcon,
  Layers3, LoaderCircle, Maximize2, MonitorPlay, Pause, Play, Settings2,
  RefreshCw, SkipBack, SkipForward, Sparkles, Trash2, Type,
  UploadCloud, Volume2, VolumeX,
} from "lucide-react";
import {
  CLOUD_MAX_UPLOAD_BYTES, createDefaultTextItem, MAX_GRAPHIC_BYTES, MAX_UPLOAD_BYTES, OUTPUT_FPS, OUTPUT_RATIOS,
  type AspectMode, type GraphicAsset, type GraphicItem, type MotionPreset, type OutputRatio,
  type RenderJobStatus, type TextItem, type TextPosition, type VideoAdSequenceClip, type VideoAsset,
} from "@/lib/video-ad/types";
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
};

const LAST_JOB_KEY = "video-ad:last-job";
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
  const playerRef = useRef<PlayerRef>(null);
  const currentFrameRef = useRef(0);
  const previewSectionRef = useRef<HTMLElement>(null);
  const [clips, setClips] = useState<EditorClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [items, setItems] = useState<TextItem[]>([]);
  const [graphics, setGraphics] = useState<GraphicItem[]>([]);
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
  const selectedRenderItems = useMemo(() => items
    .filter((item) => item.end > selectedClipStartTime && item.start < selectedClipEndTime)
    .map((item) => ({
      ...item,
      start: Math.max(0, item.start - selectedClipStartTime),
      end: Math.min(duration, item.end - selectedClipStartTime),
    })), [duration, items, selectedClipEndTime, selectedClipStartTime]);
  const selectedRenderGraphics = useMemo(() => graphics
    .filter((item) => item.end > selectedClipStartTime && item.start < selectedClipEndTime)
    .map((item) => ({
      ...item,
      start: Math.max(0, item.start - selectedClipStartTime),
      end: Math.min(duration, item.end - selectedClipStartTime),
    })), [duration, graphics, selectedClipEndTime, selectedClipStartTime]);
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

  const updateClipPrompt = (clipId: string, prompt: string) => {
    setClips((current) =>
      current.map((clip) => clip.id === clipId ? { ...clip, prompt } : clip),
    );
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
        body: JSON.stringify({ assetId: asset.id, items: selectedRenderItems, graphics: selectedRenderGraphics, aspectMode, outputRatio }),
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
          <button type="button" className={styles.headerButton} onClick={() => previewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
            <MonitorPlay size={16} /> 미리보기
          </button>
          <button type="button" className={styles.headerPrimary} disabled={!asset || activeJob || editorErrors.length > 0} onClick={() => void startRender()}>
            {activeJob ? <LoaderCircle className={styles.spin} size={16} /> : <Film size={16} />}
            선택 컷 내보내기
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <section className={styles.editorColumn}>
          <div className={`${styles.card} ${styles.uploadCard}`}>
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
                {selectedClip && (
                  <label className={styles.clipPrompt}>
                    <span>선택 컷 생성 메모</span>
                    <textarea
                      rows={2}
                      value={selectedClip.prompt}
                      placeholder="예: 캐릭터가 보스를 향해 달려가는 3초 장면"
                      onChange={(event) => updateClipPrompt(selectedClip.id, event.target.value)}
                    />
                    <small>영상 생성 API 연결 시 이 컷만 재생성하는 입력값으로 사용됩니다.</small>
                  </label>
                )}
                <p className={styles.sequenceSummary}>총 {clips.length}개 컷 · {totalClipDuration.toFixed(2)}초</p>
              </div>
            )}

            <div className={styles.assetTools} aria-label="에셋 추가 도구">
              <button type="button" onClick={() => graphicInputRef.current?.click()} disabled={!asset || graphicUploading || graphics.length >= 10}>
                {graphicUploading ? <LoaderCircle className={styles.spin} size={17} /> : <ImageIcon size={17} />}<span>PNG 글자</span><small>투명 이미지</small>
              </button>
              <button type="button" disabled title="배경 제거 기능은 준비 중입니다">
                <Sparkles size={17} /><span>배경 제거</span><small>준비 중</small>
              </button>
              <button type="button" onClick={addItem} disabled={!clips.length || items.length >= 20}>
                <Type size={17} /><span>문구 추가</span><small>전체 타임라인</small>
              </button>
            </div>
          </div>

          <div className={`${styles.card} ${styles.copyCard}`}>
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

            {clips.length > 0 && (
              <div className={styles.timelineScopeNotice}>
                <strong>전체 타임라인 0초–{totalClipDuration.toFixed(2)}초</strong>
                <span>텍스트와 PNG는 컷 경계를 넘어 표시할 수 있습니다. 예: 3초–{totalClipDuration.toFixed(2)}초</span>
              </div>
            )}
            {!asset && <div className={styles.empty}>먼저 영상을 업로드하면 문구를 편집할 수 있습니다.</div>}
            {asset && items.length === 0 && graphics.length === 0 && <div className={styles.empty}>문구를 입력하거나 투명 PNG 글자를 추가해 보세요.</div>}

            {graphicError && <p className={styles.errorBox}>{graphicError}</p>}

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
                      <textarea rows={2} maxLength={180} value={item.text} onChange={(event) => updateItem(item.id, "text", event.target.value)} />
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
        </section>

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
                  <span>{asset ? `${currentFrame + 1} / ${sequenceDurationInFrames} 프레임` : "레이어가 여기에 표시됩니다"}</span>
                </div>
                <div className={styles.timelineRuler}>
                  <span>0초</span><span>{totalClipDuration ? `${(totalClipDuration / 2).toFixed(1)}초` : "—"}</span><span>{totalClipDuration ? `${totalClipDuration.toFixed(1)}초` : "—"}</span>
                </div>
                {clips.length > 0 && (
                  <div className={styles.sequenceTimeline}>
                    <span className={styles.trackLabel}><Film size={14} /> 전체 컷</span>
                    <div className={styles.sequenceLane}>
                      {clips.map((clip, index) => (
                        <button
                          type="button"
                          key={clip.id}
                          className={clip.id === selectedClipId ? styles.selectedSequenceClip : ""}
                          style={{ width: `${clip.asset.metadata.duration / totalClipDuration * 100}%` }}
                          onClick={() => selectClip(clip.id)}
                          title={clip.asset.originalName}
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
                        {timelineSegments[key].map((segment, index) => (
                          <span
                            className={`${styles.timelineClip} ${styles[`timelineClip${key}`]}`}
                            key={segment.id}
                            style={{
                              left: `${totalClipDuration ? Math.max(0, segment.start / totalClipDuration * 100) : 0}%`,
                              width: `${totalClipDuration ? Math.max(1.5, (segment.end - segment.start) / totalClipDuration * 100) : 0}%`,
                            }}
                          >{key === "video" ? "원본 영상" : `${label} ${index + 1}`}</span>
                        ))}
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
                <div><h2>출력 설정</h2><p>현재 선택한 컷의 화면과 품질을 정하세요</p></div>
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
                  <span><strong>{activeJob ? "렌더링 중…" : job?.status === "failed" ? "다시 렌더링" : "선택 컷 렌더링"}</strong><small>기존 렌더 기능 · 크레딧 0</small></span>
                </button>
              )}
              {job?.status === "completed" && (
                <button type="button" className={styles.secondaryButton} onClick={() => void startRender()} disabled={!asset || editorErrors.length > 0}>현재 설정으로 새 영상 만들기</button>
              )}
              <p className={styles.workerHint}>렌더 워커가 켜져 있어야 대기 작업이 처리됩니다: <code>pnpm worker</code></p>
            </details>
          </div>
        </aside>
      </div>
    </main>
  );
}
