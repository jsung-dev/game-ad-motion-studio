import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createCloudReadUrl } from "@/lib/video-ad/cloud-storage";
import { probeMp4 } from "@/lib/video-ad/media";
import type { SeedanceModel } from "@/lib/video-ad/types";
import { publicGenerationJob, writeGenerationJob, type GenerationJob } from "@/lib/video-ad/generation-state";
import {
  createSeedanceTask,
  MagnificApiError,
  MagnificConfigurationError,
  isSeedanceModel,
  SEEDANCE_MODEL_LIMITS,
  type SeedanceAspectRatio,
  type SeedanceResolution,
} from "@/lib/video-ad/magnific";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const resolutions: SeedanceResolution[] = ["480p", "720p", "1080p"];
const ratios: SeedanceAspectRatio[] = [
  "film_horizontal_21_9", "widescreen_16_9", "classic_4_3", "square_1_1",
  "traditional_3_4", "social_story_9_16", "film_vertical_9_21",
];
type ReferenceMediaInput = {
  kind: "image" | "video";
  assetId: string;
};

const isReferenceMediaInput = (value: unknown): value is ReferenceMediaInput => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "image" || record.kind === "video") &&
    typeof record.assetId === "string" &&
    isSafeId(record.assetId)
  );
};

const isSafeId = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const duration = Number(body.duration);
    const resolution = body.resolution as SeedanceResolution;
    const aspectRatio = body.aspectRatio as SeedanceAspectRatio;
    const targetClipId = typeof body.targetClipId === "string" ? body.targetClipId.slice(0, 100) : null;
    const imageAssetId = typeof body.imageAssetId === "string" ? body.imageAssetId : null;
    const modelValue = body.model;
    const model: SeedanceModel | null = modelValue === undefined
      ? "seedance-2-5-pro"
      : isSeedanceModel(modelValue)
        ? modelValue
        : null;
    if (!model) {
      return NextResponse.json({ error: "\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 Seedance \uBAA8\uB378\uC785\uB2C8\uB2E4." }, { status: 400 });
    }
    const modelLimits = SEEDANCE_MODEL_LIMITS[model];
    if (!Number.isInteger(duration) || duration < 4 || duration > modelLimits.maxDuration) {
      return NextResponse.json({ error: `\uC601\uC0C1 \uAE38\uC774\uB294 4\uCD08\uBD80\uD130 ${modelLimits.maxDuration}\uCD08\uAE4C\uC9C0 \uC815\uC218\uB85C \uC124\uC815\uD574 \uC8FC\uC138\uC694.` }, { status: 400 });
    }

    const rawReferenceMedia = body.referenceMedia;
    if (rawReferenceMedia !== undefined && !Array.isArray(rawReferenceMedia)) {
      return NextResponse.json({ error: "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4 \uC815\uBCF4\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694." }, { status: 400 });
    }
    const referenceMedia: ReferenceMediaInput[] = Array.isArray(rawReferenceMedia)
      ? rawReferenceMedia.filter(isReferenceMediaInput)
      : [];
    if (Array.isArray(rawReferenceMedia) && referenceMedia.length !== rawReferenceMedia.length) {
      return NextResponse.json({ error: "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4 \uC815\uBCF4\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694." }, { status: 400 });
    }
    const referenceImages = referenceMedia.filter((media) => media.kind === "image");
    const referenceVideos = referenceMedia.filter((media) => media.kind === "video");
    if (referenceMedia.length && model === "seedance-2-pro") {
      return NextResponse.json({ error: "Seedance 2.0 Pro\uC5D0\uC11C\uB294 \uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, { status: 400 });
    }
    if (referenceImages.length > modelLimits.maxReferenceImages || referenceVideos.length > modelLimits.maxReferenceVideos) {
      return NextResponse.json({ error: "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4 \uAC1C\uC218\uAC00 \uBAA8\uB378 \uC81C\uD55C\uC744 \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4." }, { status: 400 });
    }
    if (imageAssetId && referenceMedia.length) {
      return NextResponse.json({ error: "\uC2DC\uC791 \uC774\uBBF8\uC9C0\uC640 \uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB294 \uD568\uAED8 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." }, { status: 400 });
    }

    if (imageAssetId && !isSafeId(imageAssetId)) {
      return NextResponse.json({ error: "\uC2DC\uC791 \uC774\uBBF8\uC9C0 \uC815\uBCF4\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694." }, { status: 400 });
    }
    if (!prompt || prompt.length > 40000) {
      return NextResponse.json({ error: "영상 설명을 1자 이상 40,000자 이하로 입력해 주세요." }, { status: 400 });
    }
    if (!Number.isInteger(duration) || duration < 4 || duration > 30) {
      return NextResponse.json({ error: "영상 길이는 4초부터 30초까지 정수로 설정해 주세요." }, { status: 400 });
    }
    if (!resolutions.includes(resolution) || !ratios.includes(aspectRatio)) {
      return NextResponse.json({ error: "Seedance 출력 설정을 확인해 주세요." }, { status: 400 });
    }
    const image = imageAssetId ? (await createCloudReadUrl("graphic", imageAssetId, 3600) ?? undefined) : undefined;
    if (imageAssetId && !image) {
      return NextResponse.json({ error: "\uC2DC\uC791 \uC774\uBBF8\uC9C0\uB97C \uC77D\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC5C5\uB85C\uB4DC\uD574 \uC8FC\uC138\uC694." }, { status: 400 });
    }
    const [referenceImageUrls, referenceVideoUrls] = await Promise.all([
      Promise.all(referenceImages.map((media) => createCloudReadUrl("graphic", media.assetId, 3600))),
      Promise.all(referenceVideos.map((media) => createCloudReadUrl("video", media.assetId, 3600))),
    ]);
    if (referenceImageUrls.some((url) => !url) || referenceVideoUrls.some((url) => !url)) {
      return NextResponse.json({ error: "\uB808\uD37C\uB7F0\uC2A4 \uBBF8\uB514\uC5B4\uB97C \uC77D\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC5C5\uB85C\uB4DC\uD574 \uC8FC\uC138\uC694." }, { status: 400 });
    }
    const usableReferenceImageUrls = referenceImageUrls.filter((url): url is string => Boolean(url));
    const usableReferenceVideoUrls = referenceVideoUrls.filter((url): url is string => Boolean(url));
    const referenceVideoMetadata = await Promise.all(
      usableReferenceVideoUrls.map((url) => probeMp4(url).catch(() => null)),
    );
    const invalidReferenceVideo = referenceVideoMetadata.some((metadata) => (
      !metadata ||
      metadata.duration < 2 ||
      metadata.duration > modelLimits.maxReferenceVideoSeconds ||
      metadata.fps < 24 ||
      metadata.fps > 60
    ));
    if (invalidReferenceVideo) {
      return NextResponse.json({ error: "\uB808\uD37C\uB7F0\uC2A4 MP4\uB294 2~30\uCD08, 24~60fps \uC601\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4." }, { status: 400 });
    }
    const referenceVideoTotalDuration = referenceVideoMetadata.reduce(
      (total, metadata) => total + (metadata?.duration ?? 0),
      0,
    );
    if (referenceVideoTotalDuration > modelLimits.maxReferenceVideoTotalSeconds + 0.001) {
      return NextResponse.json({ error: "\uB808\uD37C\uB7F0\uC2A4 \uC601\uC0C1\uC758 \uCD1D \uAE38\uC774\uB294 30\uCD08 \uC774\uD558\uC5EC\uC57C \uD569\uB2C8\uB2E4." }, { status: 400 });
    }


    const task = await createSeedanceTask({
      model,
      prompt,
      duration,
      resolution,
      aspectRatio,
      soundEffects: body.soundEffects !== false,
      image,
      referenceImages: usableReferenceImageUrls,
      referenceVideos: usableReferenceVideoUrls,
    });
    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: randomUUID(),
      providerTaskId: task.taskId,
      targetClipId,
      assetId: randomUUID(),
      prompt,
      duration,
      resolution,
      aspectRatio,
      soundEffects: body.soundEffects !== false,
      status: "generating",
      stage: task.status === "IN_PROGRESS" ? "Seedance가 영상을 생성하고 있습니다." : "Seedance 생성 대기 중입니다.",
      model,
      error: null,
      asset: null,
      fileSize: null,
      createdAt: now,
      updatedAt: now,
    };
    await writeGenerationJob(job);
    return NextResponse.json(publicGenerationJob(job), { status: 202 });
  } catch (error) {
    console.error("Seedance generation create failed", error);
    const status = error instanceof MagnificConfigurationError ? 503 : error instanceof MagnificApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "AI 영상 생성을 시작하지 못했습니다.";
    return NextResponse.json({ error: message }, { status });
  }
}

