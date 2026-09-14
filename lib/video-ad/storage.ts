import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GraphicAsset, RenderJob, VideoAsset } from "./types";

export const DATA_ROOT = path.join(process.cwd(), "data", "video-ad");
export const UPLOADS_ROOT = path.join(DATA_ROOT, "uploads");
export const JOBS_ROOT = path.join(DATA_ROOT, "jobs");
export const GRAPHICS_ROOT = path.join(DATA_ROOT, "graphics");

const SAFE_ID = /^[0-9a-f-]{36}$/i;

export const assertSafeId = (id: string) => {
  if (!SAFE_ID.test(id)) throw new Error("잘못된 작업 식별자입니다.");
  return id;
};

export const ensureStorage = async () => {
  await Promise.all([
    mkdir(UPLOADS_ROOT, { recursive: true }),
    mkdir(JOBS_ROOT, { recursive: true }),
    mkdir(GRAPHICS_ROOT, { recursive: true }),
  ]);
};

const atomicJsonWrite = async (filePath: string, value: unknown) => {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, filePath);
};

export const assetDirectory = (id: string) =>
  path.join(UPLOADS_ROOT, assertSafeId(id));

export const assetVideoPath = (id: string) =>
  path.join(assetDirectory(id), "input.mp4");

export const assetJsonPath = (id: string) =>
  path.join(assetDirectory(id), "asset.json");

export const createAssetDirectory = async (id: string) => {
  await ensureStorage();
  const directory = assetDirectory(id);
  await mkdir(directory, { recursive: false });
  return directory;
};

export const writeAsset = async (asset: VideoAsset) => {
  await atomicJsonWrite(assetJsonPath(asset.id), asset);
};

export const readAsset = async (id: string): Promise<VideoAsset | null> => {
  try {
    return JSON.parse(await readFile(assetJsonPath(id), "utf8")) as VideoAsset;
  } catch {
    return null;
  }
};

export const graphicDirectory = (id: string) =>
  path.join(GRAPHICS_ROOT, assertSafeId(id));

export const graphicImagePath = (id: string) =>
  path.join(graphicDirectory(id), "input.png");

export const graphicJsonPath = (id: string) =>
  path.join(graphicDirectory(id), "graphic.json");

export const createGraphicDirectory = async (id: string) => {
  await ensureStorage();
  const directory = graphicDirectory(id);
  await mkdir(directory, { recursive: false });
  return directory;
};

export const writeGraphicAsset = async (asset: GraphicAsset) => {
  await atomicJsonWrite(graphicJsonPath(asset.id), asset);
};

export const readGraphicAsset = async (id: string): Promise<GraphicAsset | null> => {
  try {
    return JSON.parse(await readFile(graphicJsonPath(id), "utf8")) as GraphicAsset;
  } catch {
    return null;
  }
};

export const jobDirectory = (id: string) =>
  path.join(JOBS_ROOT, assertSafeId(id));

export const jobJsonPath = (id: string) =>
  path.join(jobDirectory(id), "job.json");

export const jobOutputPath = (id: string) =>
  path.join(jobDirectory(id), "output.mp4");

export const createJobDirectory = async (id: string) => {
  await ensureStorage();
  await mkdir(jobDirectory(id), { recursive: false });
};

export const writeJob = async (job: RenderJob) => {
  await atomicJsonWrite(jobJsonPath(job.id), job);
};

export const readJob = async (id: string): Promise<RenderJob | null> => {
  try {
    return JSON.parse(await readFile(jobJsonPath(id), "utf8")) as RenderJob;
  } catch {
    return null;
  }
};

const processExists = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const recoverInterruptedJob = async (job: RenderJob) => {
  if (
    job.status === "rendering" &&
    job.workerPid &&
    Date.now() - Date.parse(job.updatedAt) > 15_000 &&
    !processExists(job.workerPid)
  ) {
    const failed: RenderJob = {
      ...job,
      status: "failed",
      stage: "렌더링 중단",
      error: "렌더링 작업 프로세스가 종료되었습니다. 다시 시도해 주세요.",
      progress: undefined,
      updatedAt: new Date().toISOString(),
    };
    await writeJob(failed);
    return failed;
  }
  return job;
};

export const listJobs = async (): Promise<RenderJob[]> => {
  await ensureStorage();
  const entries = await readdir(JOBS_ROOT, { withFileTypes: true });
  const jobs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
      .map((entry) => readJob(entry.name)),
  );
  return jobs
    .filter((job): job is RenderJob => Boolean(job))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

export const claimOldestQueuedJob = async (): Promise<RenderJob | null> => {
  const jobs = await listJobs();
  for (const queued of jobs.filter((job) => job.status === "queued")) {
    const lockPath = path.join(jobDirectory(queued.id), "claim.lock");
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      const current = await readJob(queued.id);
      if (!current || current.status !== "queued") continue;
      const rendering: RenderJob = {
        ...current,
        status: "rendering",
        stage: "렌더링 준비 중",
        workerPid: process.pid,
        updatedAt: new Date().toISOString(),
      };
      await writeJob(rendering);
      return rendering;
    } catch {
      continue;
    }
  }
  return null;
};

export const fileSize = async (filePath: string) => (await stat(filePath)).size;
