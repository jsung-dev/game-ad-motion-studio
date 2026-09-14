import { processNextJob } from "../lib/video-ad/render-worker";

const once = process.argv.includes("--once");
const pollArgument = process.argv.find((argument) => argument.startsWith("--poll="));
const pollMs = Math.max(250, Number(pollArgument?.split("=")[1] ?? 1000));

const main = async () => {
  console.log(`[video-ad worker] 시작 (PID ${process.pid}, poll ${pollMs}ms)`);
  while (true) {
    const processed = await processNextJob();
    if (once) return;
    if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
