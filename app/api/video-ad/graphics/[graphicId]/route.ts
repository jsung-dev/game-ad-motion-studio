import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { graphicImagePath, readGraphicAsset } from "@/lib/video-ad/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ graphicId: string }> };

export async function GET(_request: Request, context: Context) {
  const { graphicId } = await context.params;
  const asset = await readGraphicAsset(graphicId);
  if (!asset) return NextResponse.json({ error: "PNG 카피를 찾을 수 없습니다." }, { status: 404 });
  const filePath = graphicImagePath(graphicId);
  const info = await stat(filePath).catch(() => null);
  if (!info) return NextResponse.json({ error: "PNG 카피를 찾을 수 없습니다." }, { status: 404 });
  const body = Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit;
  return new Response(body, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Length": String(info.size),
      "Content-Type": "image/png",
    },
  });
}
