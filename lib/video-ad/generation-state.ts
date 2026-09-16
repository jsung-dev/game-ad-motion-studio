import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";
import type { SeedanceAspectRatio, SeedanceResolution } from "./magnific";
import { assertSafeId, DATA_ROOT } from "./storage";
import type { SeedanceModel, VideoAsset } from "./types";

export type GenerationStatus = "generating" | "importing" | "completed" | "failed";

export type GenerationJob = {
  id: string;
  providerTaskId: string;
  targetClipId: string | null;
  assetId: string;
  prompt: string;
  duration: number;
  aspectRatio: SeedanceAspectRatio;
  resolution: SeedanceResolution;
  model?: SeedanceModel;
  soundEffects: boolean;
  status: GenerationStatus;
  stage: string;
  error: string | null;
  asset: VideoAsset | null;
  fileSize: number | null;
  createdAt: string;
  updatedAt: string;
};

const PREFIX = "_generation-jobs";
const LOCAL_ROOT = path.join(DATA_ROOT, "generations");
const blobPath = (id: string) => `${PREFIX}/${assertSafeId(id)}.json`;
const localPath = (id: string) => path.join(LOCAL_ROOT, `${assertSafeId(id)}.json`);

export const writeGenerationJob = async (job: GenerationJob) => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    await put(blobPath(job.id), JSON.stringify(job), {
      access: "private",
      token,
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  await mkdir(LOCAL_ROOT, { recursive: true });
  const destination = localPath(job.id);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(job, null, 2), "utf8");
  await rename(temporary, destination);
};

export const readGenerationJob = async (id: string): Promise<GenerationJob | null> => {
  try {
    assertSafeId(id);
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (token) {
      const result = await get(blobPath(id), { access: "private", token, useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return JSON.parse(await new Response(result.stream).text()) as GenerationJob;
    }
    return JSON.parse(await readFile(localPath(id), "utf8")) as GenerationJob;
  } catch {
    return null;
  }
};

export const publicGenerationJob = (job: GenerationJob) => ({
  id: job.id,
  targetClipId: job.targetClipId,
  prompt: job.prompt,
  model: job.model ?? "seedance-2-5-pro",
  status: job.status,
  stage: job.stage,
  error: job.error,
  asset: job.asset,
  fileSize: job.fileSize,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

