/** @type {import('next').NextConfig} */
const nextConfig = {
  // Preserve ffprobe-static platform binary path at runtime.
  serverExternalPackages: ["ffprobe-static", "@remotion/bundler", "@remotion/vercel", "@vercel/sandbox"],
};
export default nextConfig;
