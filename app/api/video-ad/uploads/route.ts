import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { probeMp4, MediaValidationError } from "@/lib/video-ad/media";
import {
  assetVideoPath,
  createAssetDirectory,
  writeAsset,
} from "@/lib/video-ad/storage";
import {
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_SECONDS,
  type VideoAsset,
} from "@/lib/video-ad/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return NextResponse.json(
      { error: "파일 크기는 최대 100MB까지 업로드할 수 있습니다." },
      { status: 413 },
    );
  }

  let directory: string | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) {
      return NextResponse.json({ error: "업로드할 MP4 파일을 선택해 주세요." }, { status: 400 });
    }
    if (!value.name.toLowerCase().endsWith(".mp4")) {
      return NextResponse.json({ error: "현재는 MP4 파일만 지원합니다." }, { status: 400 });
    }
    if (value.size <= 0) {
      return NextResponse.json({ error: "빈 파일은 업로드할 수 없습니다." }, { status: 400 });
    }
    if (value.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "파일 크기는 최대 100MB까지 업로드할 수 있습니다." },
        { status: 413 },
      );
    }

    const id = randomUUID();
    directory = await createAssetDirectory(id);
    const inputPath = assetVideoPath(id);
    await writeFile(inputPath, new Uint8Array(await value.arrayBuffer()));

    const metadata = await probeMp4(inputPath);
    if (metadata.duration > MAX_VIDEO_SECONDS + 0.0001) {
      throw new MediaValidationError("영상 길이는 최대 30초까지 지원합니다.");
    }

    const asset: VideoAsset = {
      id,
      sourceUrl: `/api/video-ad/assets/${id}`,
      originalName: path.basename(value.name).slice(0, 200),
      metadata,
      createdAt: new Date().toISOString(),
    };
    await writeAsset(asset);
    return NextResponse.json({ asset });
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    const message =
      error instanceof MediaValidationError
        ? error.message
        : "영상을 저장하거나 분석하지 못했습니다. 다른 MP4 파일로 다시 시도해 주세요.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
