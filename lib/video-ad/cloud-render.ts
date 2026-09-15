import { randomUUID } from "node:crypto";
import path from "node:path";
import { addBundleToSandbox, createSandbox, getRenderProgress, renderMediaOnVercel } from "@remotion/vercel";
import { Sandbox } from "@vercel/sandbox";
import { createCloudReadUrl } from "./cloud-storage";
import { OUTPUT_FPS, type VideoAdSequenceCompositionProps } from "./types";
import type { SequenceRenderClip } from "./server-validation";
import type { AspectMode, GraphicItem, OutputRatio, TextItem } from "./types";
import { writeCloudRenderJob, type CloudRenderJob } from "./cloud-render-state";

type CloudSequenceSettings = {
  clips: SequenceRenderClip[];
  items: TextItem[];
  graphics: GraphicItem[];
  aspectMode: AspectMode;
  outputRatio: OutputRatio;
};

export const isCloudRenderEnabled = () => Boolean(
  process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN,
);

const stageLabel = (stage: string) => {
  if (stage === "starting") return "렌더링 환경 시작 중";
  if (stage === "opening-browser") return "렌더링 브라우저 시작 중";
  if (stage === "selecting-composition") return "전체 시퀀스 확인 중";
  if (stage === "render-progress") return "프레임 렌더링 중";
  if (stage === "uploading") return "완성 영상 저장 중";
  return "렌더링 처리 중";
};

export const startCloudSequenceRender = async (settings: CloudSequenceSettings) => {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) throw new Error("Vercel Blob 저장소 연결이 필요합니다.");

  const id = randomUUID();
  const now = new Date().toISOString();
  let job: CloudRenderJob = {
    id,
    status: "queued",
    stage: "전체 시퀀스 렌더링 준비 중",
    progress: null,
    error: null,
    downloadUrl: null,
    createdAt: now,
    updatedAt: now,
  };
  await writeCloudRenderJob(job);

  let sandbox: Awaited<ReturnType<typeof createSandbox>> | null = null;
  const bundleDir = path.resolve(process.cwd(), ".remotion");
  try {
    const clipUrls = await Promise.all(
      settings.clips.map((clip) => createCloudReadUrl("video", clip.assetId, 60 * 60)),
    );
    const graphicUrls = await Promise.all(
      settings.graphics.map((graphic) => createCloudReadUrl("graphic", graphic.graphicId, 60 * 60)),
    );
    if (clipUrls.some((url) => !url)) throw new Error("업로드한 영상 컷을 찾을 수 없습니다.");
    if (graphicUrls.some((url) => !url)) throw new Error("업로드한 PNG 카피를 찾을 수 없습니다.");

    job = { ...job, status: "rendering", stage: "렌더링 환경 시작 중", updatedAt: new Date().toISOString() };
    await writeCloudRenderJob(job);
    sandbox = await createSandbox({ timeoutInMilliseconds: 5 * 60 * 1000 });
    await sandbox.mkDir("remotion-bundle");
    await addBundleToSandbox({ sandbox, bundleDir });
    const inputProps: VideoAdSequenceCompositionProps = {
      clips: settings.clips.map((clip, index) => ({
        id: clip.id,
        videoSrc: clipUrls[index]!,
        metadata: clip.metadata,
        durationInFrames: Math.max(1, Math.round(clip.metadata.duration * OUTPUT_FPS)),
        graphics: [],
      })),
      items: settings.items,
      graphics: settings.graphics.map((graphic, index) => ({ ...graphic, sourceUrl: graphicUrls[index]! })),
      aspectMode: settings.aspectMode,
      outputRatio: settings.outputRatio,
    };
    const started = await renderMediaOnVercel({
      sandbox,
      compositionId: "VideoAdSequence",
      inputProps: inputProps as unknown as Record<string, unknown>,
      detached: true,
      vercelBlob: {
        blobToken,
        access: "private",
        blobPath: `video-ad-renders/${id}/output.mp4`,
      },
      outputFile: "output.mp4",
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      imageFormat: "png",
      concurrency: 1,
      logLevel: "warn",
      detachedSandboxTimeoutInMilliseconds: 30 * 60 * 1000,
    });
    job = {
      ...job,
      status: "rendering",
      stage: "프레임 렌더링 중",
      progress: 0,
      sandboxId: started.sandboxId,
      cmdId: started.cmdId,
      updatedAt: new Date().toISOString(),
    };
    await writeCloudRenderJob(job);
    return job;
  } catch (error) {
    await sandbox?.stop().catch(() => undefined);
    const message = error instanceof Error ? error.message : "클라우드 렌더링을 시작하지 못했습니다.";
    job = {
      ...job,
      status: "failed",
      stage: "렌더링 실패",
      progress: null,
      error: message.slice(0, 1200),
      updatedAt: new Date().toISOString(),
    };
    await writeCloudRenderJob(job).catch(() => undefined);
    throw error;
  }
};

export const refreshCloudRenderJob = async (job: CloudRenderJob) => {
  if (job.status === "completed" || job.status === "failed") return job;
  if (!job.sandboxId || !job.cmdId) return job;
  try {
    const progress = await getRenderProgress({ sandboxId: job.sandboxId, cmdId: job.cmdId });
    let next: CloudRenderJob;
    if (progress.stage === "done") {
      next = {
        ...job,
        status: "completed",
        stage: "완료",
        progress: 1,
        error: null,
        downloadUrl: progress.url,
        updatedAt: new Date().toISOString(),
      };
      await Sandbox.get({ sandboxId: job.sandboxId }).then((active) => active.stop()).catch(() => undefined);
    } else if (progress.stage === "error" || progress.stage === "expired") {
      next = {
        ...job,
        status: "failed",
        stage: "렌더링 실패",
        progress: null,
        error: progress.stage === "error" ? progress.message : "렌더링 환경이 만료되었습니다. 다시 시도해 주세요.",
        updatedAt: new Date().toISOString(),
      };
    } else {
      next = {
        ...job,
        status: "rendering",
        stage: stageLabel(progress.stage),
        progress: progress.overallProgress,
        updatedAt: new Date().toISOString(),
      };
    }
    await writeCloudRenderJob(next);
    return next;
  } catch (error) {
    if (Date.now() - Date.parse(job.updatedAt) < 10 * 60 * 1000) return job;
    const next: CloudRenderJob = {
      ...job,
      status: "failed",
      stage: "렌더링 상태 확인 실패",
      progress: null,
      error: error instanceof Error ? error.message.slice(0, 1200) : "렌더링 상태를 확인하지 못했습니다.",
      updatedAt: new Date().toISOString(),
    };
    await writeCloudRenderJob(next);
    return next;
  }
};
