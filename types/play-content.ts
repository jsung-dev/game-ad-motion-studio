export type CategoryIcon = "mind" | "heart" | "balance" | "quiz" | "game";

/** Supabase `categories` table shape. */
export type PlayCategory = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: CategoryIcon;
  sort_order: number;
};

export type ArtworkMotif = "orbit" | "steps" | "split" | "grid" | "burst";

/** Supabase `play_contents` table shape. */
export type PlayContent = {
  id: string;
  category_id: PlayCategory["id"];
  slug: string;
  title: string;
  summary: string;
  participant_count: number;
  duration_minutes: number;
  thumbnail_gradient: string;
  thumbnail_accent: string;
  thumbnail_motif: ArtworkMotif;
  is_featured: boolean;
  sort_order: number;
};
