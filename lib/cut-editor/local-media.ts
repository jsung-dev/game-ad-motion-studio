export type LocalVideoSource = {
  url: string;
  duration: number;
  width: number;
  height: number;
};

export type LocalImageSource = {
  url: string;
  width: number;
  height: number;
};

const extension = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();

export const revokeLocalMediaUrl = (url: string) => {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
};

export const loadLocalVideo = async (file: File): Promise<LocalVideoSource> => {
  if (extension(file.name) !== ".mp4") throw new Error("MP4 파일만 추가할 수 있습니다.");
  if (file.size <= 0) throw new Error("빈 영상 파일은 추가할 수 없습니다.");
  const url = URL.createObjectURL(file);
  try {
    const metadata = await new Promise<Omit<LocalVideoSource, "url">>((resolve, reject) => {
      const video = document.createElement("video");
      const clear = () => {
        video.removeAttribute("src");
        video.load();
      };
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => {
        const duration = video.duration;
        const width = video.videoWidth;
        const height = video.videoHeight;
        clear();
        if (!Number.isFinite(duration) || duration <= 0 || !width || !height) {
          reject(new Error("영상 길이나 해상도를 확인할 수 없습니다."));
          return;
        }
        resolve({ duration, width, height });
      };
      video.onerror = () => {
        clear();
        reject(new Error("브라우저에서 재생할 수 있는 MP4 파일이 아닙니다."));
      };
      video.src = url;
    });
    return { url, ...metadata };
  } catch (error) {
    revokeLocalMediaUrl(url);
    throw error;
  }
};

export const loadLocalPng = async (file: File): Promise<LocalImageSource> => {
  if (extension(file.name) !== ".png") throw new Error("PNG 파일만 추가할 수 있습니다.");
  if (file.size <= 0) throw new Error("빈 PNG 파일은 추가할 수 없습니다.");
  const url = URL.createObjectURL(file);
  try {
    const metadata = await new Promise<Omit<LocalImageSource, "url">>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        image.src = "";
        if (!width || !height) {
          reject(new Error("PNG 크기를 확인할 수 없습니다."));
          return;
        }
        resolve({ width, height });
      };
      image.onerror = () => {
        image.src = "";
        reject(new Error("브라우저에서 읽을 수 있는 PNG 파일이 아닙니다."));
      };
      image.src = url;
    });
    return { url, ...metadata };
  } catch (error) {
    revokeLocalMediaUrl(url);
    throw error;
  }
};
