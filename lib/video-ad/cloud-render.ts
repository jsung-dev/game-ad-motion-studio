import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { addBundleToSandbox, createSandbox, getRenderProgress, renderMediaOnVercel } from "@remotion/vercel";
import { Sandbox } from "@vercel/sandbox";
import { get, put } from "@vercel/blob";
import { createCloudReadUrl } from "./cloud-storage";
import { OUTPUT_FPS, type RenderJobStatus, type VideoAdSequenceCompositionProps } from "./types";
import type { SequenceRenderClip } from "./server-validation";
import type { AspectMode, GraphicItem, OutputRatio, TextItem } from "./types";

const JOB_PREFIX = "_render-jobs";

export type CloudRenderJob = {
  id: string;
  status: RenderJobStatus;
  stage: string;
  progress: number | null;
  error: string | null;
  downloadUrl: string | null;
  sandboxId?: string;
  cmdId?: string;
  createdAt: string;
  updatedAt: string;
};

type CloudSequenceSettings = {
  clips: SequenceRenderClip[];
  items: TextItem[];
  graphics: GraphicItem[];
  aspectMode: AspectMode;
  outputRatio: OutputRatio;
};

const jobPath = (id: string) => `${JOB_PREFIX}/${id}.json`;

export const isCloudRenderEnabled = () => Boolean(
  process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN,
);

export const writeCloudRenderJob = async (job: CloudRenderJob) => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Vercel Blob 저장소 연결이 필요합니다.");
  await put(jobPath(job.id), JSON.stringify(job), {
    access: "private",
    token,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
};

export const readCloudRenderJob = async (id: string): Promise<CloudRenderJob | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const result = await get(jobPath(id), { access: "private", token, useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return JSON.parse(await new Response(result.stream).text()) as CloudRenderJob;
  } catch {
    return null;
  }
};

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
  const bundleDir = path.join(tmpdir(), `video-ad-remotion-${id}`);
  try {
    const clipUrls = await Promise.all(
      settings.clips.map((clip) => createCloudReadUrl("video", clip.assetId, 60 * 60)),
    );
    const graphicUrls = await Promise.all(
      settings.graphics.map((graphic) => createCloudReadUrl("graphic", graphic.graphicId, 60 * 60)),
    );
    if (clipUrls.some((url) => !url)) throw new Error("업로드한 영상 컷을 찾을 수 없습니다.");
    if (graphicUrls.some((url) => !url)) throw new Error("업로드한 PNG 카피를 찾을 수 없습니다.");

    job = { ...job, status: "rendering", stage: "영상 템플릿 번들링 중", updatedAt: new Date().toISOString() };
    await writeCloudRenderJob(job);
    await bundle({
      entryPoint: path.resolve(process.cwd(), "remotion", "index.ts"),
      publicDir: path.resolve(process.cwd(), "public"),
      outDir: bundleDir,
      onProgress: () => undefined,
    });

    sandbox = await createSandbox({ timeoutInMilliseconds: 5 * 60 * 1000 });
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
      detachedSandboxTimeoutInMilliseconds: 45 * 60 * 1000,
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
  } finally {
    await rm(bundleDir, { recursive: true, force: true }).catch(() => undefined);
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
