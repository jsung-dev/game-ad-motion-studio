import {execFile, spawn, type ChildProcess} from "node:child_process";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {promisify} from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import {processNextJob} from "../lib/video-ad/render-worker";
import type {AspectMode, GraphicAsset, GraphicItem, OutputRatio, TextItem, VideoAsset} from "../lib/video-ad/types";

const exec = promisify(execFile);
const root = process.cwd();
const require = createRequire(path.join(root, "scripts", "test-video-ad.ts"));
const artifacts = path.join(root, "test-artifacts", "video-ad");
const origin = "http://127.0.0.1:3100";
if (!ffmpegPath) throw new Error("ffmpeg-static was not found");
const ffmpeg = ffmpegPath;

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin + "/video-ad")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Next.js test server did not start");
};

const json = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(origin + url, init);
  const body = (await response.json().catch(() => ({}))) as T & {error?: string};
  if (!response.ok) throw new Error(body.error || url + " failed");
  return body;
};

const upload = async (file: string) => {
  const form = new FormData();
  const bytes = new Uint8Array(await readFile(file));
  form.append("file", new Blob([bytes], {type: "video/mp4"}), path.basename(file));
  return (await json<{asset: VideoAsset}>("/api/video-ad/uploads", {method: "POST", body: form})).asset;
};

const uploadGraphic = async (file: string) => {
  const form = new FormData();
  const bytes = new Uint8Array(await readFile(file));
  form.append("file", new Blob([bytes], {type: "image/png"}), path.basename(file));
  return (await json<{asset: GraphicAsset}>("/api/video-ad/graphics", {method: "POST", body: form})).asset;
};

const graphicItem = (asset: GraphicAsset): GraphicItem => ({
  id: "graphic-copy",
  graphicId: asset.id,
  sourceUrl: asset.sourceUrl,
  originalName: asset.originalName,
  intrinsicWidth: asset.width,
  intrinsicHeight: asset.height,
  start: .25,
  end: 2.75,
  xPercent: 72,
  yPercent: 30,
  widthPercent: 32,
  shadow: true,
  motion: "pop",
});

const items = (suffix: string): TextItem[] => [
  {id: "pop-" + suffix, text: "\uC9C0\uAE08 \uC2DC\uC791\uD558\uBA74", start: .15, end: 1.05, position: "top", fontSize: 66, color: "#FFFFFF", strokeColor: "#111827", strokeWidth: 5, shadow: true, motion: "pop"},
  {id: "slide-" + suffix, text: "100\uC5F0 \uBF51\uAE30\n\uBB34\uB8CC!", start: 1, end: 2.05, position: "center", fontSize: 72, color: "#FFE44D", strokeColor: "#3B0764", strokeWidth: 6, shadow: true, motion: "slide-up"},
  {id: "fade-" + suffix, text: "\uC9C0\uAE08 \uD50C\uB808\uC774", start: 1.95, end: 2.9, position: "bottom", fontSize: 68, color: "#FFFFFF", strokeColor: "#7C2D12", strokeWidth: 5, shadow: false, motion: "fade"},
];

const render = async (asset: VideoAsset, mode: AspectMode, ratio: OutputRatio, name: string, graphics: GraphicItem[] = []) => {
  const created = await json<{jobId: string}>("/api/video-ad/renders", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({assetId: asset.id, items: items(name), graphics, aspectMode: mode, outputRatio: ratio}),
  });
  const queued = await json<{status: string}>("/api/video-ad/renders/" + created.jobId);
  if (queued.status !== "queued") throw new Error("job was not queued");
  if (!(await processNextJob())) throw new Error("worker did not claim a job");
  const done = await json<{status: string; downloadUrl: string; progress: number}>("/api/video-ad/renders/" + created.jobId);
  if (done.status !== "completed" || done.progress !== 1 || !done.downloadUrl) {
    throw new Error("render failed: " + JSON.stringify(done));
  }
  const download = await fetch(origin + done.downloadUrl);
  if (!download.ok) throw new Error("download failed");
  const output = path.join(artifacts, name);
  await writeFile(output, new Uint8Array(await download.arrayBuffer()));
  return {output, jobId: created.jobId};
};

const renderSequence = async (assets: VideoAsset[]) => {
  const sequenceItems: TextItem[] = [
    {id: "cross-boundary", text: "첫 컷에서\n두 번째 컷까지", start: 2.4, end: 3.7, position: "center", fontSize: 64, color: "#FFFFFF", strokeColor: "#111827", strokeWidth: 5, shadow: true, motion: "pop"},
    {id: "sequence-cta", text: "지금 플레이", start: 3.2, end: 5.8, position: "bottom", fontSize: 68, color: "#FFE44D", strokeColor: "#3B0764", strokeWidth: 6, shadow: true, motion: "slide-up"},
  ];
  const created = await json<{jobId: string}>("/api/video-ad/renders", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      clips: assets.map((asset, index) => ({id: `sequence-clip-${index}`, assetId: asset.id, metadata: asset.metadata})),
      items: sequenceItems,
      graphics: [],
      aspectMode: "contain",
      outputRatio: "9:16",
    }),
  });
  if (!(await processNextJob())) throw new Error("sequence worker did not claim a job");
  const done = await json<{status: string; downloadUrl: string; progress: number}>("/api/video-ad/renders/" + created.jobId);
  if (done.status !== "completed" || done.progress !== 1 || !done.downloadUrl) {
    throw new Error("sequence render failed: " + JSON.stringify(done));
  }
  const download = await fetch(origin + done.downloadUrl);
  if (!download.ok) throw new Error("sequence download failed");
  const output = path.join(artifacts, "output-sequence.mp4");
  await writeFile(output, new Uint8Array(await download.arrayBuffer()));
  return {output, jobId: created.jobId};
};

type Probe = {
  streams: Array<{codec_type: string; codec_name: string; width?: number; height?: number; pix_fmt?: string; r_frame_rate?: string}>;
  format: {duration: string};
};
const probe = async (file: string): Promise<Probe> => {
  const {stdout} = await exec(ffprobe.path, ["-v", "error", "-show_streams", "-show_format", "-print_format", "json", file]);
  return JSON.parse(stdout) as Probe;
};
const frame = async (video: string, name: string, seconds: number) => {
  const output = path.join(artifacts, name + ".png");
  await exec(ffmpeg, ["-y", "-ss", String(seconds), "-i", video, "-frames:v", "1", output]);
  return output;
};

const main = async () => {
let server: ChildProcess | null = null;
try {
  await mkdir(artifacts, {recursive: true});
  const audioSource = path.join(artifacts, "source-audio.mp4");
  const silentSource = path.join(artifacts, "source-silent.mp4");
  const graphicSource = path.join(artifacts, "source-copy.png");
  await exec(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", audioSource]);
  await exec(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", silentSource]);
  await exec(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=c=black@0.0:s=360x100,format=rgba,drawbox=x=10:y=10:w=340:h=80:color=yellow@1:t=fill:replace=1", "-frames:v", "1", graphicSource]);

  const nextBin = require.resolve("next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "start", "-p", "3100"], {
    cwd: root,
    env: {...process.env, VIDEO_AD_RENDER_ORIGIN: origin},
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer();

  const audioAsset = await upload(audioSource);
  const silentAsset = await upload(silentSource);
  const pngAsset = await uploadGraphic(graphicSource);
  if (!audioAsset.metadata.hasAudio || silentAsset.metadata.hasAudio) throw new Error("audio detection failed");
  if (audioAsset.metadata.width !== 640 || audioAsset.metadata.height !== 360) throw new Error("metadata detection failed");

  const baseline = await render(audioAsset, "cover", "9:16", "output-cover-baseline.mp4");
  const cover = await render(audioAsset, "cover", "9:16", "output-cover-audio.mp4", [graphicItem(pngAsset)]);
  const contain = await render(silentAsset, "contain", "16:9", "output-contain-silent.mp4");
  const sequence = await renderSequence([audioAsset, silentAsset]);
  const {stderr: psnrLog} = await exec(ffmpeg, ["-i", baseline.output, "-i", cover.output, "-lavfi", "psnr", "-f", "null", "NUL"]);
  const psnrAverage = /average:([^ ]+)/.exec(psnrLog)?.[1];
  if (!psnrAverage || psnrAverage === "inf") throw new Error("PNG graphic did not change rendered pixels");
  const coverMeta = await probe(cover.output);
  const containMeta = await probe(contain.output);
  const sequenceMeta = await probe(sequence.output);

  for (const [label, meta, file, expectedWidth, expectedHeight] of [["cover", coverMeta, cover.output, 720, 1280], ["contain", containMeta, contain.output, 1280, 720]] as const) {
    const video = meta.streams.find((stream) => stream.codec_type === "video");
    if (!video || video.codec_name !== "h264" || video.width !== expectedWidth || video.height !== expectedHeight || video.pix_fmt !== "yuv420p") {
      throw new Error(label + " output spec failed: " + JSON.stringify(video));
    }
    if (Math.abs(Number(meta.format.duration) - 3) > 1 / 30 + .002) throw new Error(label + " duration is out of tolerance");
    await exec(ffmpeg, ["-v", "error", "-i", file, "-f", "null", "NUL"]);
  }
  if (!coverMeta.streams.some((s) => s.codec_type === "audio" && s.codec_name === "aac")) throw new Error("AAC track was not preserved");
  if (containMeta.streams.some((s) => s.codec_type === "audio")) throw new Error("silent output gained an audio track");
  const sequenceVideo = sequenceMeta.streams.find((stream) => stream.codec_type === "video");
  if (!sequenceVideo || sequenceVideo.codec_name !== "h264" || sequenceVideo.width !== 720 || sequenceVideo.height !== 1280 || sequenceVideo.pix_fmt !== "yuv420p") {
    throw new Error("sequence output spec failed: " + JSON.stringify(sequenceVideo));
  }
  if (Math.abs(Number(sequenceMeta.format.duration) - 6) > 1 / 30 + .002) throw new Error("sequence duration is out of tolerance");
  if (!sequenceMeta.streams.some((s) => s.codec_type === "audio" && s.codec_name === "aac")) throw new Error("sequence AAC track was not preserved");
  await exec(ffmpeg, ["-v", "error", "-i", sequence.output, "-f", "null", "NUL"]);

  const frames = await Promise.all([
    frame(cover.output, "pop-enter", .23), frame(cover.output, "pop-hold", .62), frame(cover.output, "pop-exit", .98),
    frame(cover.output, "slide-enter", 1.08), frame(cover.output, "slide-hold", 1.48), frame(cover.output, "slide-exit", 1.98),
    frame(cover.output, "fade-enter", 2.03), frame(cover.output, "fade-hold", 2.42), frame(cover.output, "fade-exit", 2.82),
    frame(contain.output, "contain-layout", 1.48),
    frame(sequence.output, "sequence-before-cut", 2.8),
    frame(sequence.output, "sequence-cut-boundary", 3.0),
    frame(sequence.output, "sequence-after-cut", 3.35),
    frame(sequence.output, "sequence-text-exit", 3.62),
  ]);
  const report = {
    passed: true,
    uploads: {audio: audioAsset.metadata, silent: silentAsset.metadata, graphic: pngAsset},
    outputs: {baseline, cover: {...cover, metadata: coverMeta}, contain: {...contain, metadata: containMeta}, sequence: {...sequence, metadata: sequenceMeta}, pngPixelDifferencePsnr: psnrAverage},
    frames,
  };
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  server?.kill();
}
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
