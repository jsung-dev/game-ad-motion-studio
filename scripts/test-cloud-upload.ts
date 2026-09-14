import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";
import { POST as finalizeUpload } from "../app/api/video-ad/cloud-uploads/finalize/route";
import { POST as signUpload } from "../app/api/video-ad/cloud-uploads/sign/route";
import { cloudObject, createCloudReadUrl, getCloudStorage } from "../lib/video-ad/cloud-storage";

const run = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`명령이 종료 코드 ${code}로 실패했습니다.`)),
    );
  });

const json = async <T>(response: Response) => {
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
};

const main = async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error("Supabase 테스트 환경 변수가 필요합니다.");
  }
  if (!ffmpegPath) throw new Error("ffmpeg-static 실행 파일을 찾을 수 없습니다.");
  const origin = process.env.VIDEO_AD_CLOUD_TEST_ORIGIN?.replace(/\/$/, "");

  const directory = await mkdtemp(path.join(tmpdir(), "video-ad-cloud-test-"));
  const samplePath = path.join(directory, "sample.mp4");
  let uploaded: { bucket: string; path: string } | null = null;
  try {
    await run(ffmpegPath, [
      "-y",
      "-f", "lavfi",
      "-i", "testsrc2=size=320x180:rate=30",
      "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1.2",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      samplePath,
    ]);
    const bytes = await readFile(samplePath);
    const signRequest = new Request(origin
      ? `${origin}/api/video-ad/cloud-uploads/sign`
      : "http://local.test/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "video", fileName: "sample.mp4", size: bytes.length }),
      });
    const signResponse = origin ? await fetch(signRequest) : await signUpload(signRequest);
    const signed = await json<{ id: string; bucket: string; path: string; token: string }>(signResponse);
    uploaded = { bucket: signed.bucket, path: signed.path };

    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: uploadError } = await client.storage
      .from(signed.bucket)
      .uploadToSignedUrl(
        signed.path,
        signed.token,
        new Blob([bytes], { type: "video/mp4" }),
        { contentType: "video/mp4" },
      );
    if (uploadError) throw uploadError;

    const finalizeRequest = new Request(origin
      ? `${origin}/api/video-ad/cloud-uploads/finalize`
      : "http://local.test/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "video", id: signed.id, originalName: "한글 테스트.mp4" }),
      });
    const finalizeResponse = origin
      ? await fetch(finalizeRequest)
      : await finalizeUpload(finalizeRequest);
    const finalized = await json<{
      asset: {
        originalName: string;
        metadata: { duration: number; width: number; height: number; fps: number; hasAudio: boolean };
      };
    }>(finalizeResponse);
    const readUrl = origin
      ? `${origin}/api/video-ad/assets/${signed.id}`
      : await createCloudReadUrl("video", signed.id, 60);
    if (!readUrl) throw new Error("미리보기 URL을 만들지 못했습니다.");
    const preview = await fetch(readUrl, { headers: { Range: "bytes=0-1023" } });
    if (preview.status !== 200 && preview.status !== 206) {
      throw new Error(`미리보기 응답이 HTTP ${preview.status}입니다.`);
    }
    if (
      finalized.asset.metadata.width !== 320 ||
      finalized.asset.metadata.height !== 180 ||
      !finalized.asset.metadata.hasAudio
    ) {
      throw new Error("ffprobe 메타데이터가 예상과 다릅니다.");
    }
    console.log(JSON.stringify({
      uploaded: true,
      origin: origin ?? "route-direct",
      previewStatus: preview.status,
      originalName: finalized.asset.originalName,
      metadata: finalized.asset.metadata,
    }, null, 2));
  } finally {
    if (uploaded) {
      await getCloudStorage().storage.from(uploaded.bucket).remove([uploaded.path]);
    }
    await rm(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
