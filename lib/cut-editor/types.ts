export type ClipSourceType = "local" | "generated";
export type ClipStatus = "ready" | "generating" | "error";
export type OverlayMotion = "none" | "pop" | "slideUp";

export type Clip = {
  id: string;
  order: number;
  name: string;
  prompt: string;
  sourceType: ClipSourceType;
  sourceUrl: string;
  duration: number;
  width: number;
  height: number;
  fileSize: number;
  status: ClipStatus;
  generationVersion: number;
  error?: string;
};

export type Overlay = {
  id: string;
  clipId: string;
  name: string;
  sourceUrl: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  startTime: number;
  endTime: number;
  x: number;
  y: number;
  width: number;
  motion: OverlayMotion;
};

export type ClipTiming = {
  clip: Clip;
  start: number;
  end: number;
};

export const buildClipTimings = (clips: Clip[]): ClipTiming[] => {
  let cursor = 0;
  return [...clips]
    .sort((a, b) => a.order - b.order)
    .map((clip) => {
      const timing = { clip, start: cursor, end: cursor + clip.duration };
      cursor = timing.end;
      return timing;
    });
};

export const findClipAtTime = (timings: ClipTiming[], time: number) => {
  if (!timings.length) return null;
  const total = timings[timings.length - 1].end;
  if (time >= total) return timings[timings.length - 1];
  return timings.find((timing) => time >= timing.start && time < timing.end) ?? timings[0];
};
