import { rm } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";

const root = process.cwd();
const output = path.join(root, ".remotion");
await rm(output, { recursive: true, force: true });
await bundle({
  entryPoint: path.join(root, "remotion", "index.ts"),
  publicDir: path.join(root, "public"),
  outDir: output,
  onProgress: () => undefined,
});
console.log(`Remotion bundle created at ${output}`);
