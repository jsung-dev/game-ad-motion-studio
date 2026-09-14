"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, Download, Film, ImageIcon,
  Layers3, LoaderCircle, Maximize2, MonitorPlay, Pause, Play, Settings2,
  SkipBack, SkipForward, Sparkles, Trash2, Type,
  UploadCloud, Volume2, VolumeX,
} from "lucide-react";
import {
  createDefaultTextItem, MAX_GRAPHIC_BYTES, MAX_UPLOAD_BYTES, OUTPUT_FPS, OUTPUT_RATIOS,
  type AspectMode, type GraphicAsset, type GraphicItem, type MotionPreset, type OutputRatio,
  type RenderJobStatus, type TextItem, type TextPosition, type VideoAsset,
} from "@/lib/video-ad/types";
import { getDurationInFrames, getGraphicItemErrors, getItemErrors, validateEditorPayload } from "@/lib/video-ad/validation";
import { VideoAdComposition } from "@/remotion/AdComposition";
import styles from "./VideoAdStudio.module.css";

type JobView = {
  id: string;
  status: RenderJobStatus;
  stage: string;
  progress: number | null;
  error: string | null;
  downloadUrl: string | null;
};

const LAST_JOB_KEY = "video-ad:last-job";
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
  if (!response.ok) throw new Error(body.error || "요청을 처리하지 못했습니다.");
  return body;
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
  aspectMode: AspectMode;
  width: number;
  height: number;
  onPositionChange: (xPercent: number, yPercent: number) => void;
};

function GraphicPlacementPreview({
  item,
  videoSrc,
  aspectMode,
  width,
  height,
  onPositionChange,
}: GraphicPlacementPreviewProps) {
  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
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
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        >
          <video src={videoSrc} muted playsInline preload="auto" onLoadedData={(event) => { event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration || 0.1); }} style={{ objectFit: aspectMode === "cover" ? "cover" : "contain" }} />
          <img
            src={item.sourceUrl}
            alt="배치할 PNG 카피"
            draggable={false}
            style={{
              left: `${item.xPercent}%`,
              top: `${item.yPercent}%`,
              width: `${item.widthPercent}%`,
              filter: item.shadow ? "drop-shadow(0 4px 7px rgba(0,0,0,.65))" : "none",
            }}
          />
          <span className={styles.placementCrosshair} style={{ left: `${item.xPercent}%`, top: `${item.yPercent}%` }} />
        </div>
      </div>
    </div>
  );
}

export function VideoAdEditor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const graphicInputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<PlayerRef>(null);
  const previewSectionRef = useRef<HTMLElement>(null);
  const [asset, setAsset] = useState<VideoAsset | null>(null);
  const [assetFileSize, setAssetFileSize] = useState<number | null>(null);
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

  const duration = asset?.metadata.duration ?? 0;
  const outputDimensions = OUTPUT_RATIOS[outputRatio];
  const editorErrors = useMemo(
    () => (asset ? validateEditorPayload(items, asset.metadata, graphics) : []),
    [asset, items, graphics],
  );
  const activeJob = job?.status === "queued" || job?.status === "rendering";
  const durationInFrames = asset ? getDurationInFrames(asset.metadata.duration) : 1;

  const timelineSegments = useMemo(() => ({
    video: asset ? [{ id: asset.id, start: 0, end: duration }] : [],
    image: graphics.map((item) => ({ id: item.id, start: item.start, end: item.end })),
    text: items.map((item) => ({ id: item.id, start: item.start, end: item.end })),
    effect: [
      ...items.filter((item) => item.motion !== "none"),
      ...graphics.filter((item) => item.motion !== "none"),
    ].map((item) => ({ id: `effect-${item.id}`, start: item.start, end: item.end })),
  }), [asset, duration, graphics, items]);

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
    if (!player || !asset) return;
    const onFrameUpdate = (event: { detail: { frame: number } }) => setCurrentFrame(event.detail.frame);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onMuteChange = (event: { detail: { isMuted: boolean } }) => setIsMuted(event.detail.isMuted);
    player.addEventListener("frameupdate", onFrameUpdate);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onPause);
    player.addEventListener("mutechange", onMuteChange);
    setCurrentFrame(player.getCurrentFrame());
    setIsPlaying(player.isPlaying());
    setIsMuted(player.isMuted());
    return () => {
      player.removeEventListener("frameupdate", onFrameUpdate);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onPause);
      player.removeEventListener("mutechange", onMuteChange);
    };
  }, [asset, outputRatio]);

  const upload = async (file: File) => {
    setUploadError(null);
    if (!file.name.toLowerCase().endsWith(".mp4")) {
      setUploadError("현재는 MP4 파일만 지원합니다.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("파일 크기는 최대 100MB까지 업로드할 수 있습니다.");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/video-ad/uploads", { method: "POST", body: form });
      const result = await responseJson<{ asset: VideoAsset }>(response);
      setAsset(result.asset);
      setAssetFileSize(file.size);
      setCurrentFrame(0);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
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
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/video-ad/graphics", { method: "POST", body: form });
      const result = await responseJson<{ asset: GraphicAsset }>(response);
      const graphic: GraphicItem = {
        id: crypto.randomUUID(),
        graphicId: result.asset.id,
        sourceUrl: result.asset.sourceUrl,
        originalName: result.asset.originalName,
        intrinsicWidth: result.asset.width,
        intrinsicHeight: result.asset.height,
        start: 0,
        end: Math.min(duration, 2.5),
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

  const addItem = () => {
    if (!asset || items.length >= 20) return;
    const item = createDefaultTextItem();
    item.end = Math.min(duration, 2.5);
    setItems((current) => [...current, item]);
  };

  const addExamples = () => {
    if (!asset || items.length > 17) return;
    const segment = duration / 3;
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
        end: Number((index === 2 ? duration : segment * (index + 1)).toFixed(3)),
      })),
    ]);
  };

  const startRender = async () => {
    if (!asset || activeJob) return;
    setRenderError(null);
    const errors = validateEditorPayload(items, asset.metadata, graphics);
    if (errors.length) {
      setRenderError(errors.join("\n"));
      return;
    }

    try {
      const response = await fetch("/api/video-ad/renders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, items, graphics, aspectMode, outputRatio }),
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
            내보내기
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
              <span className={styles.countBadge}>{asset ? 1 : 0}/1</span>
            </div>

            <input
              ref={inputRef}
              className={styles.hiddenInput}
              type="file"
              accept="video/mp4,.mp4"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
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
                const file = event.dataTransfer.files?.[0];
                if (file) void upload(file);
              }}
            >
              <span className={styles.uploadIcon}>{uploading ? <LoaderCircle className={styles.spin} /> : <UploadCloud />}</span>
              <strong>{uploading ? "영상 분석 및 저장 중…" : asset ? "다른 영상으로 교체" : "영상을 드래그하거나 선택"}</strong>
              <span>{asset ? "기존 문구 설정은 그대로 유지됩니다" : "클릭해서 컴퓨터에서 파일 찾기"}</span>
              <span className={styles.formatTags}>
                <em>MP4</em><em>최대 100MB</em><em>최대 30초</em>
              </span>
            </button>
            {uploadError && <p className={styles.errorBox}>{uploadError}</p>}
            {asset && (
              <div className={styles.assetCard}>
                <video className={styles.assetThumbnail} src={asset.sourceUrl} muted playsInline preload="metadata" />
                <div className={styles.assetInfo}>
                  <strong title={asset.originalName}>{asset.originalName}</strong>
                  <span>{asset.metadata.duration.toFixed(2)}초 · {asset.metadata.width}×{asset.metadata.height}</span>
                  <span>{assetFileSize ? `${(assetFileSize / 1024 / 1024).toFixed(1)}MB · ` : ""}{asset.metadata.hasAudio ? "오디오 있음" : "무음 영상"}</span>
                </div>
                <button type="button" className={styles.assetRemove} aria-label="업로드 영상 제거" onClick={() => { setAsset(null); setAssetFileSize(null); setCurrentFrame(0); setIsPlaying(false); }}><Trash2 size={15} /></button>
              </div>
            )}

            <div className={styles.assetTools} aria-label="에셋 추가 도구">
              <button type="button" onClick={() => graphicInputRef.current?.click()} disabled={!asset || graphicUploading || graphics.length >= 10}>
                {graphicUploading ? <LoaderCircle className={styles.spin} size={17} /> : <ImageIcon size={17} />}<span>PNG 글자</span><small>투명 이미지</small>
              </button>
              <button type="button" disabled title="배경 제거 기능은 준비 중입니다">
                <Sparkles size={17} /><span>배경 제거</span><small>준비 중</small>
              </button>
              <button type="button" onClick={addItem} disabled={!asset || items.length >= 20}>
                <Type size={17} /><span>문구 추가</span><small>텍스트 레이어</small>
              </button>
            </div>
          </div>

          <div className={`${styles.card} ${styles.copyCard}`}>
            <div className={styles.sectionTitleRow}>
              <div className={styles.sectionTitle}>
                <span className={styles.panelIcon}><Layers3 size={16} /></span>
                <div><h2>레이어 편집</h2><p>문구와 PNG의 노출·스타일을 조정하세요</p></div>
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
                <button type="button" onClick={addExamples} disabled={!asset || items.length > 17}>
                  <Sparkles size={15} /> 예제 3개 추가
                </button>
              </div>
            </div>

            {!asset && <div className={styles.empty}>먼저 영상을 업로드하면 문구를 편집할 수 있습니다.</div>}
            {asset && items.length === 0 && graphics.length === 0 && <div className={styles.empty}>문구를 입력하거나 투명 PNG 글자를 추가해 보세요.</div>}

            {graphicError && <p className={styles.errorBox}>{graphicError}</p>}

            <div className={styles.itemList}>
              {items.map((item, index) => {
                const errors = getItemErrors(item, duration);
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
                      <label><span>시작 (초)</span><input type="number" min="0" step="0.01" value={item.start} onChange={(event) => updateItem(item.id, "start", event.target.valueAsNumber)} /></label>
                      <label><span>종료 (초)</span><input type="number" min="0.01" step="0.01" value={item.end} onChange={(event) => updateItem(item.id, "end", event.target.valueAsNumber)} /></label>
                      <label><span>위치</span><select value={item.position} onChange={(event) => updateItem(item.id, "position", event.target.value as TextPosition)}>{positions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label><span>모션</span><select value={item.motion} onChange={(event) => updateItem(item.id, "motion", event.target.value as MotionPreset)}>{motions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    </div>

                    <details className={styles.styleDetails}>
                      <summary>색상 · 크기 · 테두리 · 그림자</summary>
                      <div className={styles.fieldGrid}>
                      <label><span>시작 시간 (초)</span><input type="number" min="0" step="0.01" value={item.start} onChange={(event) => updateItem(item.id, "start", event.target.valueAsNumber)} /></label>
                      <label><span>종료 시간 (초)</span><input type="number" min="0.01" step="0.01" value={item.end} onChange={(event) => updateItem(item.id, "end", event.target.valueAsNumber)} /></label>
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
                const errors = getGraphicItemErrors(item, duration);
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
                      aspectMode={aspectMode}
                      width={outputDimensions.width}
                      height={outputDimensions.height}
                      onPositionChange={(xPercent, yPercent) => {
                        setGraphics((current) => current.map((entry) =>
                          entry.id === item.id ? { ...entry, xPercent, yPercent } : entry
                        ));
                      }}
                    />
                    <div className={styles.quickFieldGrid}>
                      <label><span>시작 (초)</span><input type="number" min="0" step="0.01" value={item.start} onChange={(event) => updateGraphic(item.id, "start", event.target.valueAsNumber)} /></label>
                      <label><span>종료 (초)</span><input type="number" min="0.01" step="0.01" value={item.end} onChange={(event) => updateGraphic(item.id, "end", event.target.valueAsNumber)} /></label>
                      <label><span>모션</span><select value={item.motion} onChange={(event) => updateGraphic(item.id, "motion", event.target.value as MotionPreset)}>{motions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label><span>크기 (%)</span><input type="number" min="5" max="100" step="1" value={item.widthPercent} onChange={(event) => updateGraphic(item.id, "widthPercent", event.target.valueAsNumber)} /></label>
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
                <div><span className={styles.liveDot} /> 컴포지션 미리보기</div>
                <span>{outputDimensions.width} × {outputDimensions.height} · {OUTPUT_FPS}fps</span>
              </div>
              <div className={styles.canvasSurface}>
                <div className={styles.playerShell} style={{ aspectRatio: `${outputDimensions.width} / ${outputDimensions.height}` }}>
                  {asset ? (
                    <Player
                      ref={playerRef}
                      key={`${asset.id}-${outputRatio}`}
                      component={VideoAdComposition}
                      inputProps={{ videoSrc: asset.sourceUrl, metadata: asset.metadata, items, graphics, aspectMode, outputRatio }}
                      durationInFrames={durationInFrames}
                      compositionWidth={outputDimensions.width}
                      compositionHeight={outputDimensions.height}
                      fps={OUTPUT_FPS}
                      controls={false}
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
                <span className={styles.timecode}>{formatTime(currentFrame / OUTPUT_FPS)}</span>
                <div className={styles.transportButtons}>
                  <button type="button" aria-label="이전 프레임" disabled={!asset} onClick={() => playerRef.current?.seekTo(Math.max(0, currentFrame - 1))}><SkipBack size={16} /></button>
                  <button type="button" className={styles.playButton} aria-label={isPlaying ? "일시정지" : "재생"} disabled={!asset} onClick={(event) => playerRef.current?.toggle(event)}>{isPlaying ? <Pause size={17} /> : <Play size={17} />}</button>
                  <button type="button" aria-label="다음 프레임" disabled={!asset} onClick={() => playerRef.current?.seekTo(Math.min(durationInFrames - 1, currentFrame + 1))}><SkipForward size={16} /></button>
                </div>
                <div className={styles.transportUtility}>
                  <button type="button" aria-label={isMuted ? "음소거 해제" : "음소거"} disabled={!asset || !asset.metadata.hasAudio} onClick={() => { const player = playerRef.current; if (!player) return; if (player.isMuted()) player.unmute(); else player.mute(); }}>{isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
                  <button type="button" aria-label="전체 화면" disabled={!asset} onClick={() => playerRef.current?.requestFullscreen()}><Maximize2 size={16} /></button>
                </div>
              </div>

              <div className={styles.timelinePanel}>
                <div className={styles.timelineHeader}>
                  <div><Layers3 size={15} /><strong>타임라인</strong></div>
                  <span>{asset ? `${currentFrame + 1} / ${durationInFrames} 프레임` : "레이어가 여기에 표시됩니다"}</span>
                </div>
                <div className={styles.timelineRuler}>
                  <span>0초</span><span>{duration ? `${(duration / 2).toFixed(1)}초` : "—"}</span><span>{duration ? `${duration.toFixed(1)}초` : "—"}</span>
                </div>
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
                              left: `${duration ? Math.max(0, segment.start / duration * 100) : 0}%`,
                              width: `${duration ? Math.max(1.5, (segment.end - segment.start) / duration * 100) : 0}%`,
                            }}
                          >{key === "video" ? "원본 영상" : `${label} ${index + 1}`}</span>
                        ))}
                        {asset && <span className={styles.playhead} style={{ left: `${Math.min(100, currentFrame / Math.max(1, durationInFrames - 1) * 100)}%` }} />}
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
                    max={Math.max(0, durationInFrames - 1)}
                    value={Math.min(currentFrame, durationInFrames - 1)}
                    onChange={(event) => playerRef.current?.seekTo(event.target.valueAsNumber)}
                  />
                )}
              </div>
            </section>

            <details className={styles.renderCard} open>
              <summary className={styles.settingsSummary}><span><Settings2 size={16} /> 출력 설정</span><ChevronDown size={16} /></summary>
              <div className={styles.sectionTitle}>
                <span className={styles.panelIcon}><Settings2 size={16} /></span>
                <div><h2>출력 설정</h2><p>최종 영상의 화면과 품질을 정하세요</p></div>
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
                  <span><strong>{activeJob ? "렌더링 중…" : job?.status === "failed" ? "다시 렌더링" : "렌더링 시작"}</strong><small>로컬 렌더 · 크레딧 0</small></span>
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
