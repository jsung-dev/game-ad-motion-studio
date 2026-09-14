import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffprobe from "ffprobe-static";
import type { VideoMetadata } from "./types";

const execFileAsync = promisify(execFile);

type ProbeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
};

type ProbeResult = {
  streams?: ProbeStream[];
  format?: { duration?: string; format_name?: string };
};

export class MediaValidationError extends Error {}

const parseRate = (rate?: string) => {
  if (!rate) return 0;
  const [numerator, denominator = 1] = rate.split("/").map(Number);
  return denominator ? numerator / denominator : 0;
};

export const probeMp4 = async (filePath: string): Promise<VideoMetadata> => {
  let parsed: ProbeResult;
  try {
    const { stdout } = await execFileAsync(
      ffprobe.path,
      ["-v", "error", "-show_streams", "-show_format", "-print_format", "json", filePath],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    parsed = JSON.parse(stdout) as ProbeResult;
  } catch {
    throw new MediaValidationError("파일을 실제 MP4 영상으로 읽을 수 없습니다.");
  }

  if (!parsed.format?.format_name?.split(",").includes("mp4")) {
    throw new MediaValidationError("MP4 컨테이너 영상만 업로드할 수 있습니다.");
  }

  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video.height) {
    throw new MediaValidationError("영상 트랙이나 해상도를 확인할 수 없습니다.");
  }

  const duration = Number(video.duration ?? parsed.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new MediaValidationError("영상 길이를 확인할 수 없습니다.");
  }

  const rotation = Number(
    video.tags?.rotate ??
      video.side_data_list?.find((data) => Number.isFinite(data.rotation))?.rotation ??
      0,
  );
  const rotated = Math.abs(rotation) % 180 === 90;
  const fps = parseRate(video.avg_frame_rate || video.r_frame_rate);

  return {
    duration,
    width: rotated ? video.height : video.width,
    height: rotated ? video.width : video.height,
    fps: Number.isFinite(fps) ? fps : 0,
    hasAudio: Boolean(parsed.streams?.some((stream) => stream.codec_type === "audio")),
  };
};
