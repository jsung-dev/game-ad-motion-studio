import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cloudObject, getCloudStorage, type CloudAssetKind } from "@/lib/video-ad/cloud-storage";
import { CLOUD_MAX_UPLOAD_BYTES, MAX_GRAPHIC_BYTES } from "@/lib/video-ad/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isKind = (value: unknown): value is CloudAssetKind => value === "video" || value === "graphic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { kind?: unknown; fileName?: unknown; size?: unknown };
    if (!isKind(body.kind) || typeof body.fileName !== "string" || typeof body.size !== "number") {
      return NextResponse.json({ error: "업로드할 파일 정보를 확인해 주세요." }, { status: 400 });
    }
    const extension = body.kind === "video" ? ".mp4" : ".png";
    const maxBytes = body.kind === "video" ? CLOUD_MAX_UPLOAD_BYTES : MAX_GRAPHIC_BYTES;
    if (!body.fileName.toLowerCase().endsWith(extension)) {
      return NextResponse.json({ error: body.kind === "video" ? "MP4 파일만 지원합니다." : "PNG 파일만 지원합니다." }, { status: 400 });
    }
    if (!Number.isFinite(body.size) || body.size <= 0 || body.size > maxBytes) {
      return NextResponse.json({ error: body.kind === "video" ? "현재 웹 버전에서는 영상을 최대 50MB까지 업로드할 수 있습니다." : "PNG는 최대 10MB까지 업로드할 수 있습니다." }, { status: 400 });
    }

    const id = randomUUID();
    const target = cloudObject(body.kind, id);
    const { data, error } = await getCloudStorage().storage
      .from(target.bucket)
      .createSignedUploadUrl(target.path);
    if (error || !data?.token) throw error ?? new Error("업로드 주소를 만들지 못했습니다.");

    return NextResponse.json({ id, bucket: target.bucket, path: target.path, token: data.token });
  } catch (error) {
    console.error("cloud upload sign failed", error);
    return NextResponse.json({ error: "업로드 준비에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
