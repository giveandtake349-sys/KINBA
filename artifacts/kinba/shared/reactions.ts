/**
 * Single source of truth for the multi-reaction vocabulary
 * (comments + Hype Room messages). Do not redefine this list elsewhere.
 */
export const REACTION_TYPES = ["like", "love", "fire", "clap"] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export function isValidReaction(value: string): value is ReactionType {
  return (REACTION_TYPES as readonly string[]).includes(value);
}

/** Display metadata for reaction chips (labels/glyphs shared by all surfaces). */
export type ReactionOption = {
  id: ReactionType;
  label: string;
  glyph: string;
};

export const REACTION_OPTIONS: ReadonlyArray<ReactionOption> = [
  { id: "like", label: "Like", glyph: "👍" },
  { id: "love", label: "Love", glyph: "❤️" },
  { id: "fire", label: "Fire", glyph: "🔥" },
  { id: "clap", label: "Clap", glyph: "👏" },
];
