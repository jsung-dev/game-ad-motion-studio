const MAGNIFIC_BASE_URL = "https://api.magnific.com";

export type SeedanceResolution = "480p" | "720p" | "1080p";
export type SeedanceAspectRatio =
  | "film_horizontal_21_9"
  | "widescreen_16_9"
  | "classic_4_3"
  | "square_1_1"
  | "traditional_3_4"
  | "social_story_9_16"
  | "film_vertical_9_21";

export type SeedanceRequest = {
  prompt: string;
  duration: number;
  aspectRatio: SeedanceAspectRatio;
  resolution: SeedanceResolution;
  soundEffects: boolean;
  /** A temporary, publicly reachable URL for Seedance image-to-video mode. */
  image?: string;
};

export type MagnificTask = {
  taskId: string;
  status: "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  generated: string[];
};

export class MagnificConfigurationError extends Error {}
export class MagnificApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const apiKey = () => {
  const value = process.env.MAGNIFIC_API_KEY?.trim();
  if (!value) {
    throw new MagnificConfigurationError(
      "Magnific API 키가 설정되지 않았습니다. 서버 환경변수 MAGNIFIC_API_KEY를 등록해 주세요.",
    );
  }
  return value;
};

const endpoint = (resolution: SeedanceResolution, taskId?: string) => {
  const base = `${MAGNIFIC_BASE_URL}/v1/ai/video/seedance-2-5-pro-${resolution}`;
  return taskId ? `${base}/${encodeURIComponent(taskId)}` : base;
};

const parseError = (body: unknown, fallback: string) => {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  const problem = record.problem;
  if (problem && typeof problem === "object") {
    const problemRecord = problem as Record<string, unknown>;
    const message = typeof problemRecord.message === "string" ? problemRecord.message : fallback;
    const invalidParams = Array.isArray(problemRecord.invalid_params)
      ? problemRecord.invalid_params
          .map((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).reason === "string"
            ? (item as Record<string, unknown>).reason
            : null)
          .filter(Boolean)
      : [];
    return invalidParams.length ? `${message}: ${invalidParams.join(", ")}` : message;
  }
  return fallback;
};

export const parseMagnificTask = (body: unknown): MagnificTask => {
  if (!body || typeof body !== "object") throw new Error("Magnific 응답 형식이 올바르지 않습니다.");
  const root = body as Record<string, unknown>;
  const data = root.data && typeof root.data === "object"
    ? root.data as Record<string, unknown>
    : root;
  const taskId = data.task_id;
  const status = data.status;
  if (typeof taskId !== "string" || !["CREATED", "IN_PROGRESS", "COMPLETED", "FAILED"].includes(String(status))) {
    throw new Error("Magnific 작업 정보를 확인할 수 없습니다.");
  }
  return {
    taskId,
    status: status as MagnificTask["status"],
    generated: Array.isArray(data.generated)
      ? data.generated.filter((value): value is string => typeof value === "string")
      : [],
  };
};

const callMagnific = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      "x-magnific-api-key": apiKey(),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const fallback = response.status === 401
      ? "Magnific API 키가 유효하지 않습니다."
      : `Magnific 요청에 실패했습니다. (${response.status})`;
    throw new MagnificApiError(parseError(body, fallback), response.status);
  }
  return parseMagnificTask(body);
};

export const createSeedanceTask = (request: SeedanceRequest) =>
  callMagnific(endpoint(request.resolution), {
    method: "POST",
    body: JSON.stringify({
      prompt: request.prompt,
      duration: request.duration,
      aspect_ratio: request.aspectRatio,
      sound_effects: request.soundEffects,
      no_music: false,
      output_format: "mp4",
      seed: -1,
      enable_safety_checker: true,
      ...(request.image ? { image: request.image } : {}),
    }),
  });

export const getSeedanceTask = (resolution: SeedanceResolution, taskId: string) =>
  callMagnific(endpoint(resolution, taskId));

