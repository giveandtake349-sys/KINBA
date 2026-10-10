/**
 * Single source of truth for the JHILIK reaction vocabulary.
 *
 * The site exposes exactly ONE user-facing reaction: Pookie/Love (❤️).
 * Historical multi-reaction values ("like", "fire", "clap") are still
 * accepted at the API boundary for backward compatibility and are
 * normalized to the primary reaction — they are never deleted and never
 * written again. Do not redefine this list elsewhere.
 */
export const REACTION_TYPES = ["love"] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

/** The single supported reaction (Pookie/Love). */
export const PRIMARY_REACTION: ReactionType = "love";

/** Historical values still present in existing rows. Read-only. */
export const LEGACY_REACTION_TYPES = ["like", "fire", "clap"] as const;

/** Values still accepted at the API boundary (coerced to PRIMARY_REACTION). */
export const REACTION_INPUT_TYPES = ["love", "like", "fire", "clap"] as const;

/** True only for the single supported reaction (the write target). */
export function isValidReaction(value: string): value is ReactionType {
  return (REACTION_TYPES as readonly string[]).includes(value);
}

/** True for the primary reaction or any historical value (read/toggle compatibility). */
export function isAcceptedReaction(value: string): boolean {
  return (REACTION_INPUT_TYPES as readonly string[]).includes(value);
}

/** Map any accepted value to the primary reaction; null for unknown values. */
export function normalizeReaction(
  value: string | null | undefined
): ReactionType | null {
  return value != null && isAcceptedReaction(value) ? PRIMARY_REACTION : null;
}

/** Display metadata for reaction chips (labels/glyphs shared by all surfaces). */
export type ReactionOption = {
  id: ReactionType;
  label: string;
  glyph: string;
};

export const REACTION_OPTIONS: ReadonlyArray<ReactionOption> = [
  { id: "love", label: "Pookie", glyph: "❤️" },
];
