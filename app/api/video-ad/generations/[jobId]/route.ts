import { mkdir, writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { cloudObject, getCloudStorage } from "@/lib/video-ad/cloud-storage";
import { publicGenerationJob, readGenerationJob, writeGenerationJob, type GenerationJob } from "@/lib/video-ad/generation-state";
import { getSeedanceTask } from "@/lib/video-ad/magnific";
import { MediaValidationError, probeMp4 } from "@/lib/video-ad/media";
import { assetDirectory, assetVideoPath, writeAsset } from "@/lib/video-ad/storage";
import { CLOUD_MAX_UPLOAD_BYTES, MAX_VIDEO_SECONDS, type VideoAsset } from "@/lib/video-ad/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Context = { params: Promise<{ jobId: string }> };

const failJob = async (job: GenerationJob, error: unknown) => {
  const next: GenerationJob = {
    ...job,
    status: "failed",
    stage: "AI 영상 생성에 실패했습니다.",
    error: error instanceof Error ? error.message : "AI 영상을 가져오지 못했습니다.",
    updatedAt: new Date().toISOString(),
  };
  await writeGenerationJob(next);
  return next;
};

const importVideo = async (job: GenerationJob, videoUrl: string) => {
  const parsed = new URL(videoUrl);
  if (parsed.protocol !== "https:") throw new Error("Magnific 결과 영상 주소가 안전하지 않습니다.");
  const metadata = await probeMp4(videoUrl);
  if (metadata.duration > MAX_VIDEO_SECONDS + 0.0001) {
    throw new MediaValidationError("생성된 영상이 편집기의 30초 컷 제한을 초과했습니다.");
  }
  const response = await fetch(videoUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("Magnific 결과 영상을 다운로드하지 못했습니다.");
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > CLOUD_MAX_UPLOAD_BYTES) {
    throw new Error("생성된 영상이 현재 저장소의 50MB 제한을 초과했습니다.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > CLOUD_MAX_UPLOAD_BYTES) {
    throw new Error("생성된 영상이 비어 있거나 현재 저장소의 50MB 제한을 초과했습니다.");
  }
  const asset: VideoAsset = {
    id: job.assetId,
    sourceUrl: `/api/video-ad/assets/${job.assetId}`,
    originalName: `seedance-${job.id.slice(0, 8)}.mp4`,
    metadata,
    createdAt: new Date().toISOString(),
  };
  if (process.env.VERCEL) {
    const target = cloudObject("video", job.assetId);
    const { error } = await getCloudStorage().storage.from(target.bucket).upload(target.path, bytes, {
      contentType: "video/mp4",
      cacheControl: "3600",
      upsert: true,
    });
    if (error) throw new Error(`생성 영상 저장에 실패했습니다: ${error.message}`);
  } else {
    await mkdir(assetDirectory(job.assetId), { recursive: true });
    await writeFile(assetVideoPath(job.assetId), bytes);
    await writeAsset(asset);
  }
  return { asset, fileSize: bytes.length };
};

export async function GET(_request: Request, context: Context) {
  const { jobId } = await context.params;
  let job = await readGenerationJob(jobId);
  if (!job) return NextResponse.json({ error: "AI 생성 작업을 찾을 수 없습니다." }, { status: 404 });
  if (job.status === "completed" || job.status === "failed") {
    return NextResponse.json(publicGenerationJob(job));
  }
  if (job.status === "importing" && Date.now() - Date.parse(job.updatedAt) < 120_000) {
    return NextResponse.json(publicGenerationJob(job));
  }
  try {
    const task = await getSeedanceTask(job.model ?? "seedance-2-5-pro", job.resolution, job.providerTaskId);
    if (task.status === "FAILED") {
      job = await failJob(job, new Error("Seedance 생성 작업이 실패했습니다. 프롬프트를 조정해 다시 시도해 주세요."));
    } else if (task.status === "COMPLETED") {
      const videoUrl = task.generated[0];
      if (!videoUrl) throw new Error("완료된 Seedance 작업에 영상 주소가 없습니다.");
      job = { ...job, status: "importing", stage: "완성 영상을 편집 프로젝트에 저장하고 있습니다.", updatedAt: new Date().toISOString() };
      await writeGenerationJob(job);
      const imported = await importVideo(job, videoUrl);
      job = {
        ...job,
        ...imported,
        status: "completed",
        stage: "AI 영상 생성이 완료되었습니다.",
        error: null,
        updatedAt: new Date().toISOString(),
      };
      await writeGenerationJob(job);
    } else {
      job = {
        ...job,
        stage: task.status === "IN_PROGRESS" ? "Seedance가 영상을 생성하고 있습니다." : "Seedance 생성 대기 중입니다.",
        updatedAt: new Date().toISOString(),
      };
      await writeGenerationJob(job);
    }
    return NextResponse.json(publicGenerationJob(job));
  } catch (error) {
    console.error("Seedance generation status failed", error);
    job = await failJob(job, error);
    return NextResponse.json(publicGenerationJob(job));
  }
}

