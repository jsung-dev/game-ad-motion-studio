import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DATA_ROOT } from "../lib/video-ad/storage";
import type { RenderJob } from "../lib/video-ad/types";

const rawDays =
  process.argv.find((argument) => argument.startsWith("--days="))?.split("=")[1] ?? "7";
const days = Number(rawDays);
if (!Number.isFinite(days) || days < 1) {
  throw new Error("--days는 1 이상의 숫자여야 합니다.");
}

const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
let removed = 0;

const cleanDirectories = async (root: string, isJob: boolean) => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
    const directory = path.resolve(root, entry.name);
    if (!directory.startsWith(path.resolve(DATA_ROOT) + path.sep)) continue;

    if (isJob) {
      try {
        const job = JSON.parse(
          await readFile(path.join(directory, "job.json"), "utf8"),
        ) as RenderJob;
        if (job.status === "queued" || job.status === "rendering") continue;
      } catch {
        continue;
      }
    }

    const info = await stat(directory);
    if (info.mtimeMs >= cutoff) continue;
    await rm(directory, { recursive: true, force: false });
    removed += 1;
  }
};

const main = async () => {
  await cleanDirectories(path.join(DATA_ROOT, "jobs"), true);
  await cleanDirectories(path.join(DATA_ROOT, "uploads"), false);
  await cleanDirectories(path.join(DATA_ROOT, "graphics"), false);
  console.log(`${days}일보다 오래된 폴더 ${removed}개를 정리했습니다.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
