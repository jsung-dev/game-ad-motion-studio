import { createClient } from "@supabase/supabase-js";
import { assertSafeId } from "./storage";

export const CLOUD_VIDEO_BUCKET = "video-ad-videos";
export const CLOUD_GRAPHIC_BUCKET = "video-ad-graphics";

export type CloudAssetKind = "video" | "graphic";

export class CloudStorageConfigurationError extends Error {}

export const getCloudStorage = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new CloudStorageConfigurationError("클라우드 업로드 설정이 완료되지 않았습니다.");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

export const cloudObject = (kind: CloudAssetKind, id: string) => {
  const safeId = assertSafeId(id);
  return kind === "video"
    ? { bucket: CLOUD_VIDEO_BUCKET, path: `${safeId}/input.mp4` }
    : { bucket: CLOUD_GRAPHIC_BUCKET, path: `${safeId}/input.png` };
};

export const createCloudReadUrl = async (kind: CloudAssetKind, id: string, expiresIn = 300) => {
  const target = cloudObject(kind, id);
  const { data, error } = await getCloudStorage().storage
    .from(target.bucket)
    .createSignedUrl(target.path, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
};
