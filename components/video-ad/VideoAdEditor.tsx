"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import {
  AlertTriangle, CheckCircle2, Download, Film, LoaderCircle, Plus,
  Sparkles, Trash2, UploadCloud, Volume2, VolumeX,
} from "lucide-react";
import {
  createDefaultTextItem, MAX_GRAPHIC_BYTES, MAX_UPLOAD_BYTES, OUTPUT_FPS, OUTPUT_RATIOS,
  type AspectMode, type GraphicAsset, type GraphicItem, type MotionPreset, type OutputRatio,
  type RenderJobStatus, type TextItem, type TextPosition, type VideoAsset,
} from "@/lib/video-ad/types";
import { getDurationInFrames, getGraphicItemErrors, getItemErrors, validateEditorPayload } from "@/lib/video-ad/validation";
import { VideoAdComposition } from "@/remotion/AdComposition";
import styles from "./VideoAdEditor.module.css";

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
  const [asset, setAsset] = useState<VideoAsset | null>(null);
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

  const duration = asset?.metadata.duration ?? 0;
  const outputDimensions = OUTPUT_RATIOS[outputRatio];
  const editorErrors = useMemo(
    () => (asset ? validateEditorPayload(items, asset.metadata, graphics) : []),
    [asset, items, graphics],
  );
  const activeJob = job?.status === "queued" || job?.status === "rendering";

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
        <div className={styles.logo}><Film size={21} /> AD MOTION LAB</div>
        <div>
          <p className={styles.eyebrow}>첫 번째 테스트 MVP</p>
          <h1>게임 광고 영상 스튜디오</h1>
          <p>MP4 위에 문구와 모션을 직접 합성해 원하는 비율의 광고로 출력합니다.</p>
        </div>
        <div className={styles.outputBadge}>{outputRatio} · {outputDimensions.width} × {outputDimensions.height} · 30fps</div>
      </header>

      <div className={styles.workspace}>
        <section className={styles.editorColumn}>
          <div className={`${styles.card} ${styles.uploadCard}`}>
            <div className={styles.sectionTitle}>
              <span className={styles.step}>1</span>
              <div><h2>영상 업로드</h2><p>MP4 · 최대 100MB · 최대 30초</p></div>
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
              {uploading ? <LoaderCircle className={styles.spin} /> : <UploadCloud />}
              <strong>{uploading ? "영상 분석 및 저장 중…" : asset ? "다른 영상으로 교체" : "MP4를 놓거나 클릭해서 선택"}</strong>
              <span>확장자뿐 아니라 ffprobe로 실제 영상 여부를 확인합니다.</span>
            </button>
            {uploadError && <p className={styles.errorBox}>{uploadError}</p>}
            {asset && (
              <div className={styles.metadata}>
                <div><span>파일</span><strong title={asset.originalName}>{asset.originalName}</strong></div>
                <div><span>길이</span><strong>{asset.metadata.duration.toFixed(2)}초</strong></div>
                <div><span>해상도</span><strong>{asset.metadata.width} × {asset.metadata.height}</strong></div>
                <div>
                  <span>오디오</span>
                  <strong>{asset.metadata.hasAudio ? <><Volume2 size={15} /> 있음</> : <><VolumeX size={15} /> 없음</>}</strong>
                </div>
              </div>
            )}
          </div>

          <div className={`${styles.card} ${styles.copyCard}`}>
            <div className={styles.sectionTitleRow}>
              <div className={styles.sectionTitle}>
                <span className={styles.step}>2</span>
                <div><h2>광고 카피 편집</h2><p>문구와 노출 타이밍을 빠르게 설정하세요.</p></div>
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
                <button type="button" onClick={() => graphicInputRef.current?.click()} disabled={!asset || graphicUploading || graphics.length >= 10}>
                  {graphicUploading ? <LoaderCircle className={styles.spin} size={15} /> : <UploadCloud size={15} />} PNG 글자 추가
                </button>
                <button type="button" onClick={addExamples} disabled={!asset || items.length > 17}>
                  <Sparkles size={15} /> 예제 3개 추가
                </button>
                <button type="button" onClick={addItem} disabled={!asset || items.length >= 20}>
                  <Plus size={15} /> 문구 추가
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
            <div className={styles.previewHeading}>
              <div><span className={styles.liveDot} /> 실시간 미리보기</div><span>{outputRatio} · {outputDimensions.width} × {outputDimensions.height}</span>
            </div>
            <div className={styles.playerShell} style={{ aspectRatio: `${outputDimensions.width} / ${outputDimensions.height}` }}>
              {asset ? (
                <Player
                  key={`${asset.id}-${outputRatio}`}
                  component={VideoAdComposition}
                  inputProps={{ videoSrc: asset.sourceUrl, metadata: asset.metadata, items, graphics, aspectMode, outputRatio }}
                  durationInFrames={getDurationInFrames(asset.metadata.duration)}
                  compositionWidth={outputDimensions.width}
                  compositionHeight={outputDimensions.height}
                  fps={OUTPUT_FPS}
                  controls
                  initiallyShowControls
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <div className={styles.previewEmpty}><Film size={40} /><span>영상을 업로드하면<br />여기에 표시됩니다.</span></div>
              )}
            </div>

            <div className={styles.renderCard}>
              <div className={styles.sectionTitle}>
                <span className={styles.step}>3</span>
                <div><h2>영상 비율</h2><p>완성할 영상의 가로·세로 모양을 선택하세요.</p></div>
              </div>
              <div className={styles.ratioGrid}>
                {outputRatios.map((ratio) => {
                  const dimensions = OUTPUT_RATIOS[ratio];
                  return (
                    <label key={ratio} className={outputRatio === ratio ? styles.selected : ""}>
                      <input type="radio" name="ratio" value={ratio} checked={outputRatio === ratio} onChange={() => setOutputRatio(ratio)} />
                      <span className={styles.ratioIcon} style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }} />
                      <strong>{ratio}</strong>
                    </label>
                  );
                })}
              </div>
              <p className={styles.fitLabel}>원본 영상을 선택한 비율에 맞추는 방법</p>
              <div className={styles.segmented}>
                <label className={aspectMode === "cover" ? styles.selected : ""}>
                  <input type="radio" name="fit" value="cover" checked={aspectMode === "cover"} onChange={() => setAspectMode("cover")} />
                  <strong>화면 꽉 채우기 <em>추천</em></strong><span>빈 공간 없이 채움 · 좌우 일부가 잘릴 수 있음</span>
                </label>
                <label className={aspectMode === "contain" ? styles.selected : ""}>
                  <input type="radio" name="fit" value="contain" checked={aspectMode === "contain"} onChange={() => setAspectMode("contain")} />
                  <strong>영상 전체 보기</strong><span>잘리지 않음 · 위아래에 검은 여백이 생김</span>
                </label>
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
                  {activeJob ? "영상 만드는 중…" : job?.status === "failed" ? "다시 렌더링" : "최종 영상 만들기"}
                </button>
              )}
              {job?.status === "completed" && (
                <button type="button" className={styles.secondaryButton} onClick={() => void startRender()} disabled={!asset || editorErrors.length > 0}>현재 설정으로 새 영상 만들기</button>
              )}
              <p className={styles.workerHint}>렌더 워커가 켜져 있어야 대기 작업이 처리됩니다: <code>pnpm worker</code></p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
