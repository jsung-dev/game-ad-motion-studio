import { get, put } from "@vercel/blob";
import type { RenderJobStatus } from "./types";

const JOB_PREFIX = "_render-jobs";

export type CloudRenderJob = {
  id: string;
  status: RenderJobStatus;
  stage: string;
  progress: number | null;
  error: string | null;
  downloadUrl: string | null;
  sandboxId?: string;
  cmdId?: string;
  createdAt: string;
  updatedAt: string;
};

const jobPath = (id: string) => `${JOB_PREFIX}/${id}.json`;

export const writeCloudRenderJob = async (job: CloudRenderJob) => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Vercel Blob 저장소 연결이 필요합니다.");
  await put(jobPath(job.id), JSON.stringify(job), {
    access: "private",
    token,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
};

export const readCloudRenderJob = async (id: string): Promise<CloudRenderJob | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const result = await get(jobPath(id), { access: "private", token, useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return JSON.parse(await new Response(result.stream).text()) as CloudRenderJob;
  } catch {
    return null;
  }
};
