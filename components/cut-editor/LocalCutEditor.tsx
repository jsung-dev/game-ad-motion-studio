"use client";

import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock3,
  ImagePlus,
  Layers3,
  Maximize2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SkipBack,
  Trash2,
  UploadCloud,
  Video,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadLocalPng,
  loadLocalVideo,
  revokeLocalMediaUrl,
} from "@/lib/cut-editor/local-media";
import {
  buildClipTimings,
  findClipAtTime,
  type Clip,
  type Overlay,
  type OverlayMotion,
} from "@/lib/cut-editor/types";
import styles from "./LocalCutEditor.module.css";

const motions: Array<{ value: OverlayMotion; label: string }> = [
  { value: "none", label: "모션 없음" },
  { value: "pop", label: "팝업" },
  { value: "slideUp", label: "슬라이드 업" },
];

const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${(safe - minutes * 60).toFixed(2).padStart(5, "0")}`;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const motionStyle = (overlay: Overlay, time: number): React.CSSProperties => {
  if (time < overlay.startTime || time >= overlay.endTime) return { display: "none" };
  if (overlay.motion === "none") return {};
  const visibleDuration = overlay.endTime - overlay.startTime;
  const enterDuration = Math.max(0.08, Math.min(0.36, visibleDuration * 0.35));
  const progress = clamp((time - overlay.startTime) / enterDuration, 0, 1);
  if (overlay.motion === "slideUp") {
    const eased = 1 - Math.pow(1 - progress, 3);
    return {
      opacity: progress,
      transform: `translateY(${(1 - eased) * 36}px)`,
    };
  }
  const scale = progress < 0.72
    ? 0.55 + (progress / 0.72) * 0.56
    : 1.11 - ((progress - 0.72) / 0.28) * 0.11;
  return { opacity: progress, transform: `scale(${scale})` };
};

type Manipulation = {
  overlayId: string;
  mode: "move" | "resize";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  x: number;
  y: number;
  width: number;
  stageWidth: number;
  stageHeight: number;
  aspect: number;
};

export function LocalCutEditor() {
  const clipInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const manipulationRef = useRef<Manipulation | null>(null);
  const replaceTargetRef = useRef<string | null>(null);

  const [clips, setClips] = useState<Clip[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [globalTime, setGlobalTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAddingClips, setIsAddingClips] = useState(false);
  const [isAddingOverlay, setIsAddingOverlay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timings = useMemo(() => buildClipTimings(clips), [clips]);
  const totalDuration = timings.at(-1)?.end ?? 0;
  const currentTiming = useMemo(
    () => findClipAtTime(timings, globalTime),
    [globalTime, timings],
  );
  const currentClip = currentTiming?.clip ?? null;
  const localTime = currentTiming
    ? clamp(globalTime - currentTiming.start, 0, currentTiming.clip.duration)
    : 0;
  const selectedOverlay = overlays.find((item) => item.id === selectedOverlayId) ?? null;
  const currentOverlays = currentClip
    ? overlays.filter((overlay) => overlay.clipId === currentClip.id)
    : [];

  const rememberUrl = useCallback((url: string) => {
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  const releaseUrl = useCallback((url: string) => {
    revokeLocalMediaUrl(url);
    objectUrlsRef.current.delete(url);
  }, []);

  useEffect(() => () => {
    objectUrlsRef.current.forEach(revokeLocalMediaUrl);
    objectUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentTiming) return;
    let callbackId = 0;
    let animationId = 0;
    const sync = () => {
      setGlobalTime(clamp(currentTiming.start + video.currentTime, 0, totalDuration));
    };
    if ("requestVideoFrameCallback" in video) {
      const next = () => {
        sync();
        callbackId = video.requestVideoFrameCallback(next);
      };
      callbackId = video.requestVideoFrameCallback(next);
      return () => video.cancelVideoFrameCallback(callbackId);
    }
    const next = () => {
      sync();
      animationId = requestAnimationFrame(next);
    };
    animationId = requestAnimationFrame(next);
    return () => cancelAnimationFrame(animationId);
  }, [currentTiming?.clip.id, currentTiming?.start, totalDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentClip) return;
    if (isPlaying) void video.play().catch(() => undefined);
    else video.pause();
  }, [currentClip?.id, isPlaying]);

  const seekGlobal = (nextTime: number) => {
    const safeTime = clamp(nextTime, 0, totalDuration);
    const target = findClipAtTime(timings, safeTime);
    setGlobalTime(safeTime);
    if (target && target.clip.id === currentClip?.id && videoRef.current) {
      videoRef.current.currentTime = clamp(
        safeTime - target.start,
        0,
        target.clip.duration,
      );
    }
  };

  const selectClip = (clipId: string) => {
    const timing = timings.find((item) => item.clip.id === clipId);
    if (!timing) return;
    setIsPlaying(false);
    setSelectedOverlayId(null);
    seekGlobal(timing.start);
  };

  const addClips = async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    setIsAddingClips(true);
    const loaded: Clip[] = [];
    try {
      for (const file of files) {
        const source = await loadLocalVideo(file);
        rememberUrl(source.url);
        loaded.push({
          id: crypto.randomUUID(),
          order: clips.length + loaded.length,
          name: file.name,
          prompt: "",
          sourceType: "local",
          sourceUrl: source.url,
          duration: source.duration,
          width: source.width,
          height: source.height,
          fileSize: file.size,
          status: "ready",
          generationVersion: 1,
        });
      }
      setClips((current) => [
        ...current,
        ...loaded.map((clip, index) => ({ ...clip, order: current.length + index })),
      ]);
      if (!clips.length && loaded.length) setGlobalTime(0);
    } catch (caught) {
      loaded.forEach((clip) => releaseUrl(clip.sourceUrl));
      setError(caught instanceof Error ? caught.message : "영상을 추가하지 못했습니다.");
    } finally {
      setIsAddingClips(false);
      if (clipInputRef.current) clipInputRef.current.value = "";
    }
  };

  const replaceClip = async (clipId: string, file: File) => {
    setError(null);
    try {
      const source = await loadLocalVideo(file);
      rememberUrl(source.url);
      const previous = clips.find((clip) => clip.id === clipId);
      if (!previous) {
        releaseUrl(source.url);
        return;
      }
      setIsPlaying(false);
      setClips((current) => current.map((clip) => clip.id === clipId ? {
        ...clip,
        name: file.name,
        sourceUrl: source.url,
        duration: source.duration,
        width: source.width,
        height: source.height,
        fileSize: file.size,
        status: "ready",
        generationVersion: clip.generationVersion + 1,
        error: undefined,
      } : clip));
      releaseUrl(previous.sourceUrl);
      const timing = timings.find((item) => item.clip.id === clipId);
      if (timing) setGlobalTime(timing.start);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "컷을 교체하지 못했습니다.");
    } finally {
      if (replaceInputRef.current) replaceInputRef.current.value = "";
      replaceTargetRef.current = null;
    }
  };

  const removeClip = (clipId: string) => {
    const clip = clips.find((item) => item.id === clipId);
    const removedOverlays = overlays.filter((item) => item.clipId === clipId);
    if (clip) releaseUrl(clip.sourceUrl);
    removedOverlays.forEach((item) => releaseUrl(item.sourceUrl));
    setClips((current) =>
      current.filter((item) => item.id !== clipId).map((item, order) => ({ ...item, order })),
    );
    setOverlays((current) => current.filter((item) => item.clipId !== clipId));
    setSelectedOverlayId(null);
    setIsPlaying(false);
    setGlobalTime(0);
  };

  const moveClip = (clipId: string, direction: -1 | 1) => {
    const ordered = [...clips].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((clip) => clip.id === clipId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setClips(ordered.map((clip, order) => ({ ...clip, order })));
    setIsPlaying(false);
    setGlobalTime(0);
  };

  const addOverlay = async (file: File) => {
    if (!currentClip) return;
    setError(null);
    setIsAddingOverlay(true);
    try {
      const source = await loadLocalPng(file);
      rememberUrl(source.url);
      const overlay: Overlay = {
        id: crypto.randomUUID(),
        clipId: currentClip.id,
        name: file.name,
        sourceUrl: source.url,
        intrinsicWidth: source.width,
        intrinsicHeight: source.height,
        startTime: 0,
        endTime: currentClip.duration,
        x: 0.2,
        y: 0.4,
        width: 0.6,
        motion: "pop",
      };
      setOverlays((current) => [...current, overlay]);
      setSelectedOverlayId(overlay.id);
      if (currentTiming) {
        seekGlobal(currentTiming.start + Math.min(0.4, currentClip.duration * 0.5));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PNG를 추가하지 못했습니다.");
    } finally {
      setIsAddingOverlay(false);
      if (overlayInputRef.current) overlayInputRef.current.value = "";
    }
  };

  const updateOverlay = <K extends keyof Overlay>(
    overlayId: string,
    key: K,
    value: Overlay[K],
  ) => {
    setOverlays((current) =>
      current.map((overlay) => overlay.id === overlayId
        ? { ...overlay, [key]: value }
        : overlay),
    );
  };

  const updateClipPrompt = (clipId: string, prompt: string) => {
    setClips((current) =>
      current.map((clip) => clip.id === clipId ? { ...clip, prompt } : clip),
    );
  };

  const removeOverlay = (overlayId: string) => {
    const overlay = overlays.find((item) => item.id === overlayId);
    if (overlay) releaseUrl(overlay.sourceUrl);
    setOverlays((current) => current.filter((item) => item.id !== overlayId));
    setSelectedOverlayId(null);
  };

  const beginManipulation = (
    event: React.PointerEvent,
    overlay: Overlay,
    mode: Manipulation["mode"],
  ) => {
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedOverlayId(overlay.id);
    const bounds = stage.getBoundingClientRect();
    stage.setPointerCapture(event.pointerId);
    manipulationRef.current = {
      overlayId: overlay.id,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      x: overlay.x,
      y: overlay.y,
      width: overlay.width,
      stageWidth: bounds.width,
      stageHeight: bounds.height,
      aspect: overlay.intrinsicWidth / overlay.intrinsicHeight,
    };
  };

  const manipulate = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = manipulationRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startClientX;
    const dy = event.clientY - state.startClientY;
    if (state.mode === "move") {
      const height = state.width * state.stageWidth / state.aspect / state.stageHeight;
      updateOverlay(state.overlayId, "x", clamp(state.x + dx / state.stageWidth, 0, 1 - state.width));
      updateOverlay(state.overlayId, "y", clamp(state.y + dy / state.stageHeight, 0, 1 - height));
      return;
    }
    const initialWidth = state.width * state.stageWidth;
    const initialHeight = initialWidth / state.aspect;
    const scale = (
      (initialWidth + dx) * initialWidth +
      (initialHeight + dy) * initialHeight
    ) / (initialWidth * initialWidth + initialHeight * initialHeight);
    const maxWidthByX = (1 - state.x) * state.stageWidth;
    const maxWidthByY = (1 - state.y) * state.stageHeight * state.aspect;
    const widthPixels = clamp(
      initialWidth * scale,
      Math.min(56, state.stageWidth * 0.08),
      Math.min(maxWidthByX, maxWidthByY),
    );
    updateOverlay(state.overlayId, "width", widthPixels / state.stageWidth);
  };

  const finishManipulation = (event: React.PointerEvent<HTMLDivElement>) => {
    if (manipulationRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    manipulationRef.current = null;
  };

  const invalidSelectedTime = Boolean(
    selectedOverlay &&
    currentClip &&
    (
      selectedOverlay.startTime < 0 ||
      selectedOverlay.endTime > currentClip.duration ||
      selectedOverlay.startTime >= selectedOverlay.endTime
    ),
  );

  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}><Clapperboard size={19} /></span>
          <div><strong>AD MOTION LAB</strong><span>로컬 컷 조립 테스트</span></div>
        </div>
        <div className={styles.headerStatus}>
          <span><span className={styles.localDot} />파일은 브라우저에서만 사용됩니다</span>
          <a href="/">기존 영상 스튜디오</a>
        </div>
      </header>

      <div className={styles.editorGrid}>
        <aside className={styles.assetPanel}>
          <div className={styles.panelHeading}>
            <div><span>01</span><h1>영상 컷</h1></div>
            <strong>{clips.length}개</strong>
          </div>

          <button
            className={styles.uploadBox}
            onClick={() => clipInputRef.current?.click()}
            disabled={isAddingClips}
          >
            <UploadCloud size={24} />
            <strong>{isAddingClips ? "영상 확인 중…" : "MP4 컷 추가"}</strong>
            <span>여러 파일을 한 번에 선택할 수 있습니다</span>
          </button>
          <input
            ref={clipInputRef}
            className={styles.hiddenInput}
            type="file"
            accept="video/mp4,.mp4"
            multiple
            onChange={(event) => void addClips(Array.from(event.target.files ?? []))}
          />
          <input
            ref={replaceInputRef}
            className={styles.hiddenInput}
            type="file"
            accept="video/mp4,.mp4"
            onChange={(event) => {
              const file = event.target.files?.[0];
              const clipId = replaceTargetRef.current;
              if (file && clipId) void replaceClip(clipId, file);
            }}
          />

          <div className={styles.clipList}>
            {!clips.length && (
              <div className={styles.listEmpty}>컷을 추가하면 이곳에서 순서와 개별 영상을 관리할 수 있습니다.</div>
            )}
            {[...clips].sort((a, b) => a.order - b.order).map((clip, index) => {
              const active = clip.id === currentClip?.id;
              return (
                <article
                  key={clip.id}
                  className={`${styles.clipCard} ${active ? styles.activeClip : ""}`}
                  onClick={() => selectClip(clip.id)}
                >
                  <div className={styles.clipThumbnail}>
                    <video src={clip.sourceUrl} muted preload="metadata" />
                    <span>{index + 1}</span>
                  </div>
                  <div className={styles.clipInfo}>
                    <strong title={clip.name}>{clip.name}</strong>
                    <span>{formatTime(clip.duration)} · {formatBytes(clip.fileSize)}</span>
                    <small>버전 {clip.generationVersion} · {clip.width}×{clip.height}</small>
                  </div>
                  <div className={styles.clipActions}>
                    <button
                      title="앞으로 이동"
                      disabled={index === 0}
                      onClick={(event) => { event.stopPropagation(); moveClip(clip.id, -1); }}
                    ><ChevronLeft size={15} /></button>
                    <button
                      title="뒤로 이동"
                      disabled={index === clips.length - 1}
                      onClick={(event) => { event.stopPropagation(); moveClip(clip.id, 1); }}
                    ><ChevronRight size={15} /></button>
                    <button
                      title="새 MP4로 교체"
                      onClick={(event) => {
                        event.stopPropagation();
                        replaceTargetRef.current = clip.id;
                        replaceInputRef.current?.click();
                      }}
                    ><RefreshCw size={14} /></button>
                    <button
                      title="컷 삭제"
                      onClick={(event) => { event.stopPropagation(); removeClip(clip.id); }}
                    ><Trash2 size={14} /></button>
                  </div>
                </article>
              );
            })}
          </div>
          {currentClip && (
            <label className={styles.clipPrompt}>
              <span>선택 컷 생성 메모</span>
              <textarea
                value={currentClip.prompt}
                placeholder="예: 캐릭터가 보스를 향해 달려가는 3초 장면"
                onChange={(event) => updateClipPrompt(currentClip.id, event.target.value)}
              />
              <small>영상 생성 API 연결 시 이 컷의 개별 재생성 입력값으로 사용합니다.</small>
            </label>
          )}
        </aside>

        <section className={styles.previewArea}>
          <div className={styles.previewToolbar}>
            <div>
              <Video size={16} />
              <span>{currentClip ? `컷 ${currentClip.order + 1} · ${currentClip.width} × ${currentClip.height}` : "미리보기"}</span>
            </div>
            <span>{formatTime(globalTime)} / {formatTime(totalDuration)}</span>
          </div>

          <div className={styles.canvas}>
            {currentClip ? (
              <div
                ref={stageRef}
                className={styles.stage}
                style={{ aspectRatio: `${currentClip.width} / ${currentClip.height}` }}
                onPointerMove={manipulate}
                onPointerUp={finishManipulation}
                onPointerCancel={finishManipulation}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) setSelectedOverlayId(null);
                }}
              >
                <video
                  key={currentClip.id}
                  ref={videoRef}
                  className={styles.video}
                  src={currentClip.sourceUrl}
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(event) => {
                    event.currentTarget.currentTime = localTime;
                  }}
                  onCanPlay={(event) => {
                    if (isPlaying) void event.currentTarget.play().catch(() => undefined);
                  }}
                  onSeeked={(event) => {
                    if (currentTiming) {
                      setGlobalTime(currentTiming.start + event.currentTarget.currentTime);
                    }
                  }}
                  onEnded={() => {
                    if (!currentTiming) return;
                    const index = timings.findIndex((item) => item.clip.id === currentTiming.clip.id);
                    const next = timings[index + 1];
                    if (next) {
                      setGlobalTime(next.start);
                      setIsPlaying(true);
                    } else {
                      setGlobalTime(totalDuration);
                      setIsPlaying(false);
                    }
                  }}
                />
                {currentOverlays.map((overlay) => {
                  const heightPercent = (
                    overlay.width * currentClip.width /
                    (overlay.intrinsicWidth / overlay.intrinsicHeight) /
                    currentClip.height * 100
                  );
                  const selected = overlay.id === selectedOverlayId;
                  return (
                    <div
                      key={overlay.id}
                      className={`${styles.overlay} ${selected ? styles.selectedOverlay : ""}`}
                      style={{
                        left: `${overlay.x * 100}%`,
                        top: `${overlay.y * 100}%`,
                        width: `${overlay.width * 100}%`,
                        ...motionStyle(overlay, localTime),
                      }}
                      onPointerDown={(event) => beginManipulation(event, overlay, "move")}
                    >
                      <img src={overlay.sourceUrl} alt={overlay.name} draggable={false} />
                      {selected && (
                        <>
                          <span className={styles.overlayLabel}>{Math.round(overlay.x * 100)}, {Math.round(overlay.y * 100)} · {Math.round(overlay.width * 100)}%</span>
                          <button
                            className={styles.resizeHandle}
                            aria-label="PNG 크기 조절"
                            title={`비율 유지 크기 조절 · 높이 ${heightPercent.toFixed(1)}%`}
                            onPointerDown={(event) => beginManipulation(event, overlay, "resize")}
                          ><Maximize2 size={13} /></button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyPreview}>
                <span><Clapperboard size={34} /></span>
                <strong>첫 번째 MP4 컷을 추가해 주세요</strong>
                <p>여러 컷을 순서대로 연결하고 컷별 PNG 모션을 확인할 수 있습니다.</p>
                <button onClick={() => clipInputRef.current?.click()}><Plus size={16} />컷 추가</button>
              </div>
            )}
          </div>

          <div className={styles.transport}>
            <button
              aria-label="처음으로"
              disabled={!currentClip}
              onClick={() => { setIsPlaying(false); seekGlobal(0); }}
            ><SkipBack size={17} /></button>
            <button
              className={styles.playButton}
              aria-label={isPlaying ? "일시정지" : "재생"}
              disabled={!currentClip}
              onClick={() => {
                if (!currentClip) return;
                if (isPlaying) {
                  setIsPlaying(false);
                } else {
                  if (globalTime >= totalDuration) seekGlobal(0);
                  setIsPlaying(true);
                }
              }}
            >{isPlaying ? <Pause size={18} /> : <Play size={18} />}</button>
            <input
              aria-label="전체 영상 탐색"
              type="range"
              min={0}
              max={Math.max(totalDuration, 0.01)}
              step={0.01}
              value={Math.min(globalTime, Math.max(totalDuration, 0.01))}
              disabled={!currentClip}
              onChange={(event) => seekGlobal(Number(event.target.value))}
            />
            <span>{currentClip ? `컷 내부 ${formatTime(localTime)}` : "00:00"}</span>
          </div>

          <div className={styles.cutStrip}>
            <div className={styles.stripHeading}>
              <span><Layers3 size={15} />컷 구성</span>
              <strong>총 {formatTime(totalDuration)}</strong>
            </div>
            <div className={styles.stripTrack}>
              {timings.map((timing, index) => (
                <button
                  key={timing.clip.id}
                  className={timing.clip.id === currentClip?.id ? styles.activeSegment : ""}
                  style={{ flexGrow: Math.max(timing.clip.duration, 0.5) }}
                  onClick={() => selectClip(timing.clip.id)}
                >
                  <span>{index + 1}</span>
                  <strong>{timing.clip.name}</strong>
                  <small>{formatTime(timing.clip.duration)}</small>
                </button>
              ))}
              {!timings.length && <div className={styles.emptyTrack}>추가된 컷이 없습니다</div>}
            </div>
          </div>
        </section>

        <aside className={styles.inspector}>
          <div className={styles.panelHeading}>
            <div><span>02</span><h2>PNG 오버레이</h2></div>
            <strong>{currentOverlays.length}개</strong>
          </div>
          <button
            className={styles.addOverlayButton}
            disabled={!currentClip || isAddingOverlay}
            onClick={() => overlayInputRef.current?.click()}
          >
            <ImagePlus size={18} />
            {isAddingOverlay ? "PNG 확인 중…" : "현재 컷에 PNG 추가"}
          </button>
          <input
            ref={overlayInputRef}
            className={styles.hiddenInput}
            type="file"
            accept="image/png,.png"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void addOverlay(file);
            }}
          />

          <div className={styles.overlayTabs}>
            {currentOverlays.map((overlay, index) => (
              <button
                key={overlay.id}
                className={overlay.id === selectedOverlayId ? styles.activeOverlayTab : ""}
                onClick={() => setSelectedOverlayId(overlay.id)}
              >
                <span>{index + 1}</span>
                <strong>{overlay.name}</strong>
              </button>
            ))}
            {currentClip && !currentOverlays.length && (
              <div className={styles.overlayEmpty}>이 컷에는 PNG가 없습니다.</div>
            )}
          </div>

          {selectedOverlay && currentClip && selectedOverlay.clipId === currentClip.id ? (
            <div className={styles.settings}>
              <div className={styles.selectedAsset}>
                <img src={selectedOverlay.sourceUrl} alt="" />
                <div><strong>{selectedOverlay.name}</strong><span>{selectedOverlay.intrinsicWidth}×{selectedOverlay.intrinsicHeight}</span></div>
                <button aria-label="PNG 삭제" onClick={() => removeOverlay(selectedOverlay.id)}><Trash2 size={16} /></button>
              </div>

              <label>
                <span><Clock3 size={14} />표시 시간</span>
                <div className={styles.timeFields}>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={selectedOverlay.startTime}
                    onChange={(event) => updateOverlay(selectedOverlay.id, "startTime", Number(event.target.value))}
                  />
                  <i>초부터</i>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={selectedOverlay.endTime}
                    onChange={(event) => updateOverlay(selectedOverlay.id, "endTime", Number(event.target.value))}
                  />
                  <i>초까지</i>
                </div>
              </label>
              {invalidSelectedTime && (
                <p className={styles.fieldError}>0초 ≤ 시작 시간 &lt; 종료 시간 ≤ {currentClip.duration.toFixed(2)}초로 입력해 주세요.</p>
              )}

              <label>
                <span>등장 모션</span>
                <select
                  value={selectedOverlay.motion}
                  onChange={(event) => updateOverlay(selectedOverlay.id, "motion", event.target.value as OverlayMotion)}
                >
                  {motions.map((motion) => <option key={motion.value} value={motion.value}>{motion.label}</option>)}
                </select>
              </label>

              <div className={styles.coordinates}>
                <label><span>X 위치</span><input type="number" value={Math.round(selectedOverlay.x * 100)} onChange={(event) => updateOverlay(selectedOverlay.id, "x", clamp(Number(event.target.value) / 100, 0, 1))} /><i>%</i></label>
                <label><span>Y 위치</span><input type="number" value={Math.round(selectedOverlay.y * 100)} onChange={(event) => updateOverlay(selectedOverlay.id, "y", clamp(Number(event.target.value) / 100, 0, 1))} /><i>%</i></label>
                <label><span>너비</span><input type="number" min={8} max={100} value={Math.round(selectedOverlay.width * 100)} onChange={(event) => updateOverlay(selectedOverlay.id, "width", clamp(Number(event.target.value) / 100, 0.08, 1))} /><i>%</i></label>
              </div>

              <div className={styles.hint}>
                <Maximize2 size={16} />
                <p><strong>프리뷰에서 직접 조절</strong><span>PNG를 끌어 이동하고 우측 아래 핸들로 원본 비율을 유지하며 크기를 바꿀 수 있습니다.</span></p>
              </div>
            </div>
          ) : (
            <div className={styles.inspectorEmpty}>
              <ImagePlus size={25} />
              <strong>{currentClip ? "PNG를 추가하거나 선택해 주세요" : "먼저 영상 컷을 선택해 주세요"}</strong>
              <span>위치와 크기는 실제 영상 프레임 기준 상대 좌표로 저장됩니다.</span>
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.localNotice}>
            <RefreshCw size={15} />
            <p><strong>개별 컷 재생성 준비</strong><span>지금은 새 MP4로 교체하며, 향후 생성 API는 같은 컷 ID의 영상 소스만 바꾸게 됩니다.</span></p>
          </div>
        </aside>
      </div>
    </main>
  );
}
