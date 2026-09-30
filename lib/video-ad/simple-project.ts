import type { SeedanceAspectRatio } from "./magnific";
import type { GraphicAsset, MotionPreset, OutputRatio } from "./types";

export type SimpleStep = 1 | 2 | 3 | 4 | 5;
export type StudioMode = "simple" | "expert";

export type SimpleProjectState = {
  step: SimpleStep;
  characterName: string;
  continuityNote: string;
  characterAsset: GraphicAsset | null;
  subject: string;
  goal: string;
  mood: string;
  cta: string;
  aspectRatio: SeedanceAspectRatio;
  storyboardCardIds: string[];
  copyText: string;
  copyMotion: MotionPreset;
  copyItemId: string | null;
};

export const SIMPLE_PROJECT_KEY = "video-ad:simple-project";

export const createDefaultSimpleProject = (): SimpleProjectState => ({
  step: 1,
  characterName: "",
  continuityNote: "",
  characterAsset: null,
  subject: "",
  goal: "",
  mood: "",
  cta: "",
  aspectRatio: "social_story_9_16",
  storyboardCardIds: [],
  copyText: "",
  copyMotion: "pop",
  copyItemId: null,
});

const withContinuityNote = (prompt: string, continuityNote: string) => {
  const note = continuityNote.trim();
  return note ? `${prompt} 캐릭터 외형 유지: ${note}.` : prompt;
};

/**
 * 사용자가 입력한 광고 브리프를 기존 컷 프롬프트에 옮길 수 있는 편집용 초안으로 만든다.
 * 외부 AI를 호출하지 않는 로컬 템플릿이다.
 */
export const createStoryboardTemplates = (state: SimpleProjectState): string[] => {
  const character = state.characterName.trim() || "등록한 캐릭터";
  const subject = state.subject.trim() || "게임의 핵심 재미";
  const goal = state.goal.trim() || "플레이하고 싶은 마음을 높이는 것";
  const mood = state.mood.trim() || "역동적이고 선명한 분위기";
  const cta = state.cta.trim() || "지금 플레이";

  return [
    withContinuityNote(
      `[후킹] ${mood}로 시작한다. ${character}가 등장해 ${subject}에 대한 궁금증을 즉시 만드는 강한 첫 장면.`,
      state.continuityNote,
    ),
    withContinuityNote(
      `[액션·장점] ${character}가 ${subject}의 대표 액션이나 장점을 직접 보여준다. 장면의 목표는 ${goal}이며, 동작과 카메라 움직임을 명확하게 표현한다.`,
      state.continuityNote,
    ),
    withContinuityNote(
      `[CTA·마무리] ${mood}를 유지하며 ${character}와 핵심 결과를 함께 보여준다. 마지막에 “${cta}” 메시지가 자연스럽게 이어질 수 있도록 여백을 둔다.`,
      state.continuityNote,
    ),
  ];
};

const OUTPUT_RATIO_BY_SEEDANCE_RATIO: Record<SeedanceAspectRatio, OutputRatio> = {
  film_horizontal_21_9: "21:9",
  widescreen_16_9: "16:9",
  classic_4_3: "4:3",
  square_1_1: "1:1",
  traditional_3_4: "3:4",
  social_story_9_16: "9:16",
  // 현재 편집 출력 규격에는 9:21이 없으므로 가장 가까운 세로 규격을 사용한다.
  film_vertical_9_21: "9:16",
};

export const seedanceAspectRatioToOutputRatio = (ratio: SeedanceAspectRatio): OutputRatio =>
  OUTPUT_RATIO_BY_SEEDANCE_RATIO[ratio];

const SEEDANCE_RATIO_BY_OUTPUT_RATIO: Record<OutputRatio, SeedanceAspectRatio> = {
  "1:1": "square_1_1",
  "21:9": "film_horizontal_21_9",
  "16:9": "widescreen_16_9",
  "4:3": "classic_4_3",
  "3:4": "traditional_3_4",
  "9:16": "social_story_9_16",
};

export const outputRatioToSeedanceAspectRatio = (ratio: OutputRatio): SeedanceAspectRatio =>
  SEEDANCE_RATIO_BY_OUTPUT_RATIO[ratio];