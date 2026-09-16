import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { publicGenerationJob, writeGenerationJob, type GenerationJob } from "@/lib/video-ad/generation-state";
import {
  createSeedanceTask,
  MagnificApiError,
  MagnificConfigurationError,
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

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const duration = Number(body.duration);
    const resolution = body.resolution as SeedanceResolution;
    const aspectRatio = body.aspectRatio as SeedanceAspectRatio;
    const targetClipId = typeof body.targetClipId === "string" ? body.targetClipId.slice(0, 100) : null;
    if (!prompt || prompt.length > 40000) {
      return NextResponse.json({ error: "영상 설명을 1자 이상 40,000자 이하로 입력해 주세요." }, { status: 400 });
    }
    if (!Number.isInteger(duration) || duration < 4 || duration > 30) {
      return NextResponse.json({ error: "영상 길이는 4초부터 30초까지 정수로 설정해 주세요." }, { status: 400 });
    }
    if (!resolutions.includes(resolution) || !ratios.includes(aspectRatio)) {
      return NextResponse.json({ error: "Seedance 출력 설정을 확인해 주세요." }, { status: 400 });
    }
    const task = await createSeedanceTask({
      prompt,
      duration,
      resolution,
      aspectRatio,
      soundEffects: body.soundEffects !== false,
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

