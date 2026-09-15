import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { readCloudRenderJob } from "@/lib/video-ad/cloud-render-state";
import { jobOutputPath, readJob } from "@/lib/video-ad/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = await readJob(jobId);
  if (!job && process.env.VERCEL) {
    const cloudJob = await readCloudRenderJob(jobId);
    if (!cloudJob || cloudJob.status !== "completed" || !cloudJob.downloadUrl) {
      return NextResponse.json({ error: "다운로드할 결과 영상이 아직 없습니다." }, { status: 404 });
    }
    const blob = await get(cloudJob.downloadUrl, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!blob || blob.statusCode !== 200) {
      return NextResponse.json({ error: "결과 파일을 찾을 수 없습니다." }, { status: 404 });
    }
    return new Response(blob.stream, {
      headers: {
        "Content-Type": blob.blob.contentType || "video/mp4",
        "Content-Length": String(blob.blob.size),
        "Content-Disposition": `attachment; filename="game-ad-${jobId}.mp4"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (!job || job.status !== "completed") {
    return NextResponse.json({ error: "다운로드할 결과 영상이 아직 없습니다." }, { status: 404 });
  }
  const output = jobOutputPath(jobId);
  const info = await stat(output).catch(() => null);
  if (!info) return NextResponse.json({ error: "결과 파일을 찾을 수 없습니다." }, { status: 404 });

  const body = Readable.toWeb(createReadStream(output)) as unknown as BodyInit;
  return new Response(body, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="game-ad-${jobId}.mp4"`,
      "Cache-Control": "private, no-store",
    },
  });
}
