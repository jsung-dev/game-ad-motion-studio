import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  createGraphicDirectory,
  graphicImagePath,
  writeGraphicAsset,
} from "@/lib/video-ad/storage";
import { inspectPng } from "@/lib/video-ad/png";
import { MAX_GRAPHIC_BYTES, type GraphicAsset } from "@/lib/video-ad/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_GRAPHIC_BYTES + 256 * 1024) {
    return NextResponse.json({ error: "PNG는 최대 10MB까지 업로드할 수 있습니다." }, { status: 413 });
  }

  let directory: string | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) {
      return NextResponse.json({ error: "업로드할 PNG 파일을 선택해 주세요." }, { status: 400 });
    }
    if (!value.name.toLowerCase().endsWith(".png")) {
      return NextResponse.json({ error: "PNG 파일만 지원합니다." }, { status: 400 });
    }
    if (value.size <= 0 || value.size > MAX_GRAPHIC_BYTES) {
      return NextResponse.json({ error: value.size <= 0 ? "빈 파일은 업로드할 수 없습니다." : "PNG는 최대 10MB까지 업로드할 수 있습니다." }, { status: value.size <= 0 ? 400 : 413 });
    }

    const bytes = Buffer.from(await value.arrayBuffer());
    const metadata = inspectPng(bytes);
    const id = randomUUID();
    directory = await createGraphicDirectory(id);
    await writeFile(graphicImagePath(id), bytes);

    const asset: GraphicAsset = {
      id,
      sourceUrl: `/api/video-ad/graphics/${id}`,
      originalName: path.basename(value.name).slice(0, 200),
      ...metadata,
      createdAt: new Date().toISOString(),
    };
    await writeGraphicAsset(asset);
    return NextResponse.json({ asset });
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "PNG를 저장하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
