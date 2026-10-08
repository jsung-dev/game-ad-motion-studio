import type { PlayCategory, PlayContent } from "@/types/play-content";

export const categories: PlayCategory[] = [
  { id: "psychology", slug: "psychology", name: "심리테스트", description: "나도 몰랐던 나를 발견해요", icon: "mind", sort_order: 1 },
  { id: "romance", slug: "romance", name: "연애", description: "관계 속 마음을 들여다봐요", icon: "heart", sort_order: 2 },
  { id: "balance", slug: "balance", name: "밸런스 게임", description: "둘 중 하나, 당신의 선택은?", icon: "balance", sort_order: 3 },
  { id: "quiz", slug: "quiz", name: "퀴즈", description: "가볍게 겨루는 지식 한 판", icon: "quiz", sort_order: 4 },
  { id: "minigame", slug: "minigame", name: "미니게임", description: "짧고 짜릿하게 즐겨요", icon: "game", sort_order: 5 },
];

const visualSets = [
  ["linear-gradient(135deg, #ff6b24 0%, #e83e17 46%, #41105f 100%)", "#ffd95a", "orbit"],
  ["linear-gradient(145deg, #2b38d4 0%, #5268ff 48%, #c7ff48 100%)", "#dfff57", "steps"],
  ["linear-gradient(140deg, #111318 0%, #393f49 52%, #ff3c65 100%)", "#ff476d", "split"],
  ["linear-gradient(135deg, #ffc928 0%, #ff823d 51%, #23155c 100%)", "#251058", "grid"],
  ["linear-gradient(145deg, #00a979 0%, #006d70 50%, #071f3f 100%)", "#91ffbe", "burst"],
] as const;

const countSeeds = [12840, 8730, 6440];
const durationSeeds = [3, 5, 2];

export const playContents: PlayContent[] = categories.flatMap((category, categoryIndex) =>
  [1, 2, 3].map((number, itemIndex) => {
    const visual = visualSets[(categoryIndex + itemIndex) % visualSets.length];
    return {
      id: `${category.id}-${String(number).padStart(2, "0")}`,
      category_id: category.id,
      slug: `${category.slug}-placeholder-${String(number).padStart(2, "0")}`,
      title: `임시 콘텐츠 ${String(number).padStart(2, "0")}`,
      summary: `${category.name} 콘텐츠가 들어갈 자리예요.`,
      participant_count: countSeeds[itemIndex] + categoryIndex * 1170,
      duration_minutes: durationSeeds[itemIndex] + (categoryIndex % 2),
      thumbnail_gradient: visual[0],
      thumbnail_accent: visual[1],
      thumbnail_motif: visual[2],
      is_featured: categoryIndex === 0 && itemIndex === 0,
      sort_order: number,
    };
  }),
);

export function getCategory(categoryId: string) {
  return categories.find((category) => category.id === categoryId);
}
