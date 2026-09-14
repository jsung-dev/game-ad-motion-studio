import path from "node:path";
import { NextResponse } from "next/server";
import { cloudObject, createCloudReadUrl, getCloudStorage, type CloudAssetKind } from "@/lib/video-ad/cloud-storage";
import { MediaValidationError, probeMp4 } from "@/lib/video-ad/media";
import { inspectPng } from "@/lib/video-ad/png";
import { MAX_VIDEO_SECONDS, type GraphicAsset, type VideoAsset } from "@/lib/video-ad/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const safeName = (value: string) =>
  path.basename(value.replaceAll(String.fromCharCode(92), "/")).slice(0, 200);
const isKind = (value: unknown): value is CloudAssetKind =>
  value === "video" || value === "graphic";
const isSafeId = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

export async function POST(request: Request) {
  let kind: CloudAssetKind | null = null;
  let id = "";
  try {
    const body = (await request.json()) as {
      kind?: unknown;
      id?: unknown;
      originalName?: unknown;
    };
    if (
      !isKind(body.kind) ||
      typeof body.id !== "string" ||
      !isSafeId(body.id) ||
      typeof body.originalName !== "string"
    ) {
      return NextResponse.json(
        { error: "업로드 완료 정보를 확인해 주세요." },
        { status: 400 },
      );
    }
    kind = body.kind;
    id = body.id;
    const originalName = safeName(body.originalName);
    const createdAt = new Date().toISOString();

    if (kind === "video") {
      const signedUrl = await createCloudReadUrl(kind, id, 120);
      if (!signedUrl) throw new Error("업로드한 영상을 찾을 수 없습니다.");
      const metadata = await probeMp4(signedUrl);
      if (metadata.duration > MAX_VIDEO_SECONDS + 0.0001) {
        throw new MediaValidationError("영상 길이는 최대 30초까지 지원합니다.");
      }
      const asset: VideoAsset = {
        id,
        sourceUrl: `/api/video-ad/assets/${id}`,
        originalName,
        metadata,
        createdAt,
      };
      return NextResponse.json({ asset });
    }

    const target = cloudObject(kind, id);
    const { data, error } = await getCloudStorage().storage
      .from(target.bucket)
      .download(target.path);
    if (error || !data) {
      throw error ?? new Error("업로드한 PNG를 찾을 수 없습니다.");
    }
    const metadata = inspectPng(Buffer.from(await data.arrayBuffer()));
    const asset: GraphicAsset = {
      id,
      sourceUrl: `/api/video-ad/graphics/${id}`,
      originalName,
      ...metadata,
      createdAt,
    };
    return NextResponse.json({ asset });
  } catch (error) {
    if (kind && id) {
      try {
        const target = cloudObject(kind, id);
        await getCloudStorage().storage.from(target.bucket).remove([target.path]);
      } catch {
        // Validation error is more useful than a best-effort cleanup error.
      }
    }
    console.error("cloud upload validation failed", error);
    const message =
      error instanceof MediaValidationError || error instanceof Error
        ? error.message
        : "파일을 확인하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
