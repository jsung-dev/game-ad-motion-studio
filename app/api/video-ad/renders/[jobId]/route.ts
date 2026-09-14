import { NextResponse } from "next/server";
import { readJob, recoverInterruptedJob } from "@/lib/video-ad/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const stored = await readJob(jobId);
  if (!stored) return NextResponse.json({ error: "렌더링 작업을 찾을 수 없습니다." }, { status: 404 });
  const job = await recoverInterruptedJob(stored);

  return NextResponse.json({
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: typeof job.progress === "number" ? job.progress : null,
    error: job.error ?? null,
    downloadUrl:
      job.status === "completed" ? `/api/video-ad/renders/${job.id}/download` : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}
