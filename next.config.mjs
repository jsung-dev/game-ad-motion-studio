/** @type {import('next').NextConfig} */
const nextConfig = {
  // Preserve ffprobe-static platform binary path at runtime.
  serverExternalPackages: ["ffprobe-static"],
  outputFileTracingIncludes: {
    "/api/video-ad/renders": ["./.remotion/**/*"],
  },
};
export default nextConfig;
