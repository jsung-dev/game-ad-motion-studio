import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { del } from "@vercel/blob";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { getCloudStorage } from "../lib/video-ad/cloud-storage";
import type { VideoAsset } from "../lib/video-ad/types";

const run = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, { stdio: "ignore" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`명령이 종료 코드 ${code}로 실패했습니다.`)));
});

const json = async <T>(response: Response): Promise<T> => {
  const value = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
};

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const main = async () => {
  const origin = (process.env.VIDEO_AD_CLOUD_TEST_ORIGIN ?? "https://game-ad-motion-studio.vercel.app").replace(/\/$/, "");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!supabaseUrl || !publishableKey || !process.env.SUPABASE_SECRET_KEY || !blobToken) {
    throw new Error("Supabase와 Blob 테스트 환경 변수가 필요합니다.");
  }
  if (!ffmpegPath) throw new Error("ffmpeg-static 실행 파일을 찾을 수 없습니다.");
  const ffmpeg = ffmpegPath;

  const directory = await mkdtemp(path.join(tmpdir(), "video-ad-cloud-render-"));
  const inputObjects: Array<{ bucket: string; path: string }> = [];
  let jobId: string | null = null;
  try {
    const createSample = async (name: string, hue: number, withAudio: boolean) => {
      const output = path.join(directory, name);
      const args = ["-y", "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=30,hue=h=${hue}`, ...(
        withAudio ? ["-f", "lavfi", "-i", "sine=frequency=540:sample_rate=48000"] : []
      ), "-t", "1.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(
        withAudio ? ["-c:a", "aac", "-shortest"] : ["-an"]
      ), output];
      await run(ffmpeg, args);
      return output;
    };
    const upload = async (filePath: string): Promise<VideoAsset> => {
      const bytes = await readFile(filePath);
      const signed = await json<{ id: string; bucket: string; path: string; token: string }>(await fetch(`${origin}/api/video-ad/cloud-uploads/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "video", fileName: path.basename(filePath), size: bytes.length }),
      }));
      inputObjects.push({ bucket: signed.bucket, path: signed.path });
      const client = createClient(supabaseUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error } = await client.storage.from(signed.bucket).uploadToSignedUrl(
        signed.path,
        signed.token,
        new Blob([bytes], { type: "video/mp4" }),
        { contentType: "video/mp4" },
      );
      if (error) throw error;
      const finalized = await json<{ asset: VideoAsset }>(await fetch(`${origin}/api/video-ad/cloud-uploads/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "video", id: signed.id, originalName: path.basename(filePath) }),
      }));
      return finalized.asset;
    };

    const first = await upload(await createSample("cloud-audio.mp4", 0, true));
    const second = await upload(await createSample("cloud-silent.mp4", 120, false));
    const created = await json<{ jobId: string }>(await fetch(`${origin}/api/video-ad/renders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clips: [first, second].map((asset, index) => ({ id: `cloud-clip-${index}`, assetId: asset.id, metadata: asset.metadata })),
        items: [
          { id: "cloud-boundary-copy", text: "첫 컷에서\n두 번째 컷까지", start: 0.8, end: 1.7, position: "center", fontSize: 64, color: "#FFFFFF", strokeColor: "#111827", strokeWidth: 5, shadow: true, motion: "pop" },
          { id: "cloud-cta", text: "지금 플레이", start: 1.3, end: 2.3, position: "bottom", fontSize: 66, color: "#FFE44D", strokeColor: "#3B0764", strokeWidth: 6, shadow: true, motion: "slide-up" },
        ],
        graphics: [],
        aspectMode: "contain",
        outputRatio: "9:16",
      }),
    }));
    jobId = created.jobId;

    let job: { status: string; stage: string; progress: number | null; error: string | null; downloadUrl: string | null } | null = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      const current = await json<{ status: string; stage: string; progress: number | null; error: string | null; downloadUrl: string | null }>(
        await fetch(`${origin}/api/video-ad/renders/${jobId}`, { cache: "no-store" }),
      );
      job = current;
      if (current.status === "completed" || current.status === "failed") break;
      await sleep(2000);
    }
    if (!job || job.status !== "completed" || !job.downloadUrl) {
      throw new Error(`클라우드 렌더 실패: ${JSON.stringify(job)}`);
    }
    const result = await fetch(`${origin}${job.downloadUrl}`);
    if (!result.ok) throw new Error(`클라우드 다운로드가 HTTP ${result.status}로 실패했습니다.`);
    const outputPath = path.resolve("test-artifacts", "video-ad", "output-cloud-sequence.mp4");
    await writeFile(outputPath, new Uint8Array(await result.arrayBuffer()));
    const metadataPath = path.join(directory, "metadata.json");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffprobe.path, ["-v", "error", "-show_streams", "-show_format", "-of", "json", outputPath], { stdio: ["ignore", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      child.once("error", reject);
      child.once("exit", async (code) => {
        if (code !== 0) return reject(new Error("ffprobe 검증에 실패했습니다."));
        await writeFile(metadataPath, Buffer.concat(chunks));
        resolve();
      });
    });
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; pix_fmt?: string; nb_frames?: string }>; format: { duration: string } };
    const video = metadata.streams.find((stream) => stream.codec_type === "video");
    if (!video || video.codec_name !== "h264" || video.width !== 720 || video.height !== 1280 || video.pix_fmt !== "yuv420p" || video.nb_frames !== "72") {
      throw new Error(`클라우드 출력 규격이 예상과 다릅니다: ${JSON.stringify(video)}`);
    }
    if (!metadata.streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "aac")) {
      throw new Error("클라우드 출력에 AAC 오디오가 없습니다.");
    }
    await run(ffmpeg, ["-v", "error", "-i", outputPath, "-f", "null", "NUL"]);
    for (const [name, seconds] of [["cloud-before-cut", 1.1], ["cloud-cut-boundary", 1.2], ["cloud-after-cut", 1.4]] as const) {
      await run(ffmpeg, ["-y", "-ss", String(seconds), "-i", outputPath, "-frames:v", "1", path.resolve("test-artifacts", "video-ad", `${name}.png`)]);
    }
    console.log(JSON.stringify({ passed: true, origin, jobId, outputPath, metadata }, null, 2));
  } finally {
    await Promise.all(inputObjects.map((object) => getCloudStorage().storage.from(object.bucket).remove([object.path])));
    if (jobId) {
      await del([`_render-jobs/${jobId}.json`, `video-ad-renders/${jobId}/output.mp4`], { token: blobToken }).catch(() => undefined);
    }
    await rm(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
