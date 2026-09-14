import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { assetVideoPath, readAsset } from "@/lib/video-ad/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ assetId: string }> };

const commonHeaders = {
  "Accept-Ranges": "bytes",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "Content-Type": "video/mp4",
};

const resolveFile = async (context: Context) => {
  const { assetId } = await context.params;
  const asset = await readAsset(assetId);
  if (!asset) return null;
  const filePath = assetVideoPath(assetId);
  const info = await stat(filePath).catch(() => null);
  return info ? { filePath, size: info.size } : null;
};

export async function HEAD(_request: Request, context: Context) {
  const file = await resolveFile(context);
  if (!file) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, {
    headers: { ...commonHeaders, "Content-Length": String(file.size) },
  });
}

export async function GET(request: Request, context: Context) {
  const file = await resolveFile(context);
  if (!file) return NextResponse.json({ error: "영상을 찾을 수 없습니다." }, { status: 404 });

  const range = request.headers.get("range");
  if (!range) {
    const body = Readable.toWeb(createReadStream(file.filePath)) as unknown as BodyInit;
    return new Response(body, {
      headers: { ...commonHeaders, "Content-Length": String(file.size) },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, "Content-Range": `bytes */${file.size}` },
    });
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= file.size) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, "Content-Range": `bytes */${file.size}` },
    });
  }

  const length = end - start + 1;
  const body = Readable.toWeb(createReadStream(file.filePath, { start, end })) as unknown as BodyInit;
  return new Response(body, {
    status: 206,
    headers: {
      ...commonHeaders,
      "Content-Length": String(length),
      "Content-Range": `bytes ${start}-${end}/${file.size}`,
    },
  });
}
