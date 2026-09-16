import assert from "node:assert/strict";
import { createSeedanceTask, getSeedanceTask } from "../lib/video-ad/magnific";

type RequestLog = {
  url: string;
  body: Record<string, unknown> | null;
};

const requests: RequestLog[] = [];
const originalFetch = globalThis.fetch;
process.env.MAGNIFIC_API_KEY = "test-key";

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  requests.push({
    url: String(input),
    body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null,
  });
  return new Response(JSON.stringify({
    data: { task_id: `task-${requests.length}`, status: "CREATED" },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

const run = async () => {
try {
  await createSeedanceTask({
    model: "seedance-2-pro",
    prompt: "test 2.0",
    duration: 4,
    aspectRatio: "social_story_9_16",
    resolution: "720p",
    soundEffects: true,
  });
  await getSeedanceTask("seedance-2-pro", "720p", "two-zero-task");

  await createSeedanceTask({
    model: "seedance-2-5-pro",
    prompt: "test 2.5",
    duration: 4,
    aspectRatio: "social_story_9_16",
    resolution: "720p",
    soundEffects: true,
    referenceImages: ["https://example.com/reference.png"],
    referenceVideos: ["https://example.com/reference.mp4"],
  });
  await getSeedanceTask("seedance-2-5-pro", "720p", "two-five-task");

  assert.equal(requests[0]?.url, "https://api.magnific.com/v1/ai/video/seedance-2-pro-720p");
  assert.equal(requests[1]?.url, "https://api.magnific.com/v1/ai/video/seedance-2-pro/two-zero-task");
  assert.equal(requests[2]?.url, "https://api.magnific.com/v1/ai/video/seedance-2-5-pro-720p");
  assert.equal(requests[3]?.url, "https://api.magnific.com/v1/ai/video/seedance-2-5-pro-720p/two-five-task");

  const twoZeroBody = requests[0]?.body ?? {};
  const twoFiveBody = requests[2]?.body ?? {};
  assert.equal(Object.hasOwn(twoZeroBody, "output_format"), false);
  assert.equal(Object.hasOwn(twoZeroBody, "reference_images"), false);
  assert.equal(Object.hasOwn(twoZeroBody, "reference_videos"), false);
  assert.equal(twoFiveBody.output_format, "mp4");
  assert.deepEqual(twoFiveBody.reference_images, ["https://example.com/reference.png"]);
  assert.deepEqual(twoFiveBody.reference_videos, ["https://example.com/reference.mp4"]);

  console.log("Seedance model request test passed.");
} finally {
  globalThis.fetch = originalFetch;
}
};

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

