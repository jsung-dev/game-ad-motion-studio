import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import ffmpegPath from "ffmpeg-static";
import { DEFAULT_OUTPUT_RATIO, OUTPUT_FPS, type RenderJob, type VideoAdCompositionProps, type VideoAdSequenceCompositionProps } from "./types";
import {
  claimOldestQueuedJob,
  jobOutputPath,
  readAsset,
  readJob,
  writeJob,
} from "./storage";

let bundledServeUrl: string | null = null;
const execFileAsync = promisify(execFile);

const updateJob = async (jobId: string, patch: Partial<RenderJob>) => {
  const current = await readJob(jobId);
  if (!current) throw new Error("렌더링 작업 정보를 찾을 수 없습니다.");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeJob(next);
  return next;
};

const getServeUrl = async (jobId: string) => {
  if (bundledServeUrl) return bundledServeUrl;
  await updateJob(jobId, { stage: "영상 템플릿 번들링 중", progress: undefined });
  bundledServeUrl = await bundle({
    entryPoint: path.resolve(process.cwd(), "remotion", "index.ts"),
    publicDir: path.resolve(process.cwd(), "public"),
    onProgress: () => undefined,
  });
  return bundledServeUrl;
};

export const renderClaimedJob = async (job: RenderJob) => {
  try {
    const asset = await readAsset(job.assetId);
    if (!asset) throw new Error("업로드한 원본 영상을 찾을 수 없습니다.");

    const serveUrl = await getServeUrl(job.id);
    const isSequence = Boolean(job.snapshot.clips?.length);
    const inputProps: VideoAdCompositionProps | VideoAdSequenceCompositionProps = isSequence ? {
      clips: job.snapshot.clips!.map((clip) => ({
        id: clip.id,
        videoSrc: `${job.origin}/api/video-ad/assets/${clip.assetId}`,
        metadata: clip.metadata,
        durationInFrames: Math.max(1, Math.round(clip.metadata.duration * OUTPUT_FPS)),
        graphics: [],
      })),
      items: job.snapshot.items,
      graphics: (job.snapshot.graphics ?? []).map((item) => ({
        ...item,
        sourceUrl: `${job.origin}/api/video-ad/graphics/${item.graphicId}`,
      })),
      aspectMode: job.snapshot.aspectMode,
      outputRatio: job.snapshot.outputRatio ?? DEFAULT_OUTPUT_RATIO,
    } : {
      videoSrc: `${job.origin}/api/video-ad/assets/${job.assetId}`,
      metadata: job.snapshot.metadata,
      items: job.snapshot.items,
      graphics: (job.snapshot.graphics ?? []).map((item) => ({
        ...item,
        sourceUrl: `${job.origin}/api/video-ad/graphics/${item.graphicId}`,
      })),
      aspectMode: job.snapshot.aspectMode,
      outputRatio: job.snapshot.outputRatio ?? DEFAULT_OUTPUT_RATIO,
    };

    await updateJob(job.id, { stage: "composition 확인 중", progress: undefined });
    const composition = await selectComposition({
      serveUrl,
      id: isSequence ? "VideoAdSequence" : "VideoAd",
      inputProps,
      logLevel: "warn",
    });

    const finalOutput = jobOutputPath(job.id);
    const renderedOutput = path.join(path.dirname(finalOutput), "rendered.mp4");
    let lastWrite = 0;
    await updateJob(job.id, { stage: "프레임 렌더링 중", progress: 0 });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      imageFormat: "png",
      outputLocation: renderedOutput,
      inputProps,
      overwrite: true,
      concurrency: 1,
      logLevel: "warn",
      onProgress: ({ progress, stitchStage }) => {
        const now = Date.now();
        if (now - lastWrite < 250 && progress < 1) return;
        lastWrite = now;
        void updateJob(job.id, {
          progress,
          stage: stitchStage === "muxing" ? "오디오·영상 결합 중" : "프레임 렌더링 중",
        });
      },
    });

    if (!ffmpegPath) throw new Error("출력 길이를 정리할 FFmpeg 실행 파일을 찾지 못했습니다.");
    await updateJob(job.id, { stage: "출력 길이 정리 중", progress: undefined });
    const exactSeconds = composition.durationInFrames / composition.fps;
    await execFileAsync(ffmpegPath, [
      "-y", "-i", renderedOutput, "-t", exactSeconds.toFixed(6),
      "-c", "copy", "-movflags", "+faststart", finalOutput,
    ]);
    await unlink(renderedOutput).catch(() => undefined);

    await updateJob(job.id, {
      status: "completed",
      stage: "완료",
      progress: 1,
      outputFile: finalOutput,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 렌더링 오류";
    await updateJob(job.id, {
      status: "failed",
      stage: "렌더링 실패",
      progress: undefined,
      error: message.slice(0, 1200),
    });
  }
};

export const processNextJob = async () => {
  const job = await claimOldestQueuedJob();
  if (!job) return false;
  await renderClaimedJob(job);
  return true;
};
