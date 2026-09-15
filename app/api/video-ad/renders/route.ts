import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { parseRenderSettings, parseSequenceRenderSettings, PayloadValidationError } from "@/lib/video-ad/server-validation";
import { createJobDirectory, readAsset, readGraphicAsset, writeJob } from "@/lib/video-ad/storage";
import type { RenderJob } from "@/lib/video-ad/types";
import { isCloudRenderEnabled, startCloudSequenceRender } from "@/lib/video-ad/cloud-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    if (Array.isArray(raw.clips)) {
      const settings = parseSequenceRenderSettings(raw);
      if (process.env.VERCEL) {
        if (!isCloudRenderEnabled()) {
          return NextResponse.json(
            { error: "클라우드 렌더링을 사용하려면 Vercel Blob 저장소를 연결해 주세요." },
            { status: 503 },
          );
        }
        const cloudJob = await startCloudSequenceRender(settings);
        return NextResponse.json({ jobId: cloudJob.id, status: cloudJob.status }, { status: 202 });
      }
      const assets = await Promise.all(settings.clips.map((clip) => readAsset(clip.assetId)));
      if (assets.some((item) => !item)) {
        throw new PayloadValidationError("업로드한 영상 컷을 찾을 수 없습니다. 다시 업로드해 주세요.");
      }
      const graphicAssets = await Promise.all(settings.graphics.map((item) => readGraphicAsset(item.graphicId)));
      if (graphicAssets.some((item) => !item)) {
        throw new PayloadValidationError("업로드한 PNG 카피를 찾을 수 없습니다. 다시 업로드해 주세요.");
      }
      const graphics = settings.graphics.map((item, index) => ({
        ...item,
        sourceUrl: graphicAssets[index]!.sourceUrl,
        originalName: graphicAssets[index]!.originalName,
        intrinsicWidth: graphicAssets[index]!.width,
        intrinsicHeight: graphicAssets[index]!.height,
      }));
      const id = randomUUID();
      const now = new Date().toISOString();
      const origin = process.env.VIDEO_AD_RENDER_ORIGIN || new URL(request.url).origin;
      const job: RenderJob = {
        id,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        assetId: settings.clips[0].assetId,
        origin,
        snapshot: {
          clips: structuredClone(settings.clips),
          items: structuredClone(settings.items),
          graphics: structuredClone(graphics),
          aspectMode: settings.aspectMode,
          outputRatio: settings.outputRatio,
          metadata: {
            duration: settings.totalDuration,
            width: assets[0]!.metadata.width,
            height: assets[0]!.metadata.height,
            fps: 30,
            hasAudio: assets.some((item) => item!.metadata.hasAudio),
          },
        },
        stage: "전체 시퀀스 렌더링 대기 중",
      };
      await createJobDirectory(id);
      await writeJob(job);
      return NextResponse.json({ jobId: id, status: job.status }, { status: 202 });
    }
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
