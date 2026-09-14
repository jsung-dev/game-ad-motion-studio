import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { parseRenderSettings, PayloadValidationError } from "@/lib/video-ad/server-validation";
import { createJobDirectory, readAsset, readGraphicAsset, writeJob } from "@/lib/video-ad/storage";
import type { RenderJob } from "@/lib/video-ad/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    if (typeof raw.assetId !== "string") {
      throw new PayloadValidationError("먼저 영상을 업로드해 주세요.");
    }
    const asset = await readAsset(raw.assetId);
    if (!asset) throw new PayloadValidationError("업로드한 영상을 찾을 수 없습니다.");

    const settings = parseRenderSettings(raw, asset.metadata);
    const graphicAssets = await Promise.all(
      settings.graphics.map((item) => readGraphicAsset(item.graphicId)),
    );
    if (graphicAssets.some((item) => !item)) {
      throw new PayloadValidationError("업로드한 PNG 카피를 찾을 수 없습니다. 다시 업로드해 주세요.");
    }
    const graphics = settings.graphics.map((item, index) => {
      const graphic = graphicAssets[index]!;
      return {
        ...item,
        sourceUrl: graphic.sourceUrl,
        originalName: graphic.originalName,
        intrinsicWidth: graphic.width,
        intrinsicHeight: graphic.height,
      };
    });

    const id = randomUUID();
    const now = new Date().toISOString();
    const requestUrl = new URL(request.url);
    const origin = process.env.VIDEO_AD_RENDER_ORIGIN || requestUrl.origin;
    const job: RenderJob = {
      id,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      assetId: asset.id,
      origin,
      snapshot: {
        items: structuredClone(settings.items),
        graphics: structuredClone(graphics),
        aspectMode: settings.aspectMode,
        outputRatio: settings.outputRatio,
        metadata: structuredClone(asset.metadata),
      },
      stage: "렌더링 대기 중",
    };

    await createJobDirectory(id);
    await writeJob(job);
    return NextResponse.json({ jobId: id, status: job.status }, { status: 202 });
  } catch (error) {
    const message =
      error instanceof PayloadValidationError
        ? error.message
        : "렌더링 작업을 만들지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
