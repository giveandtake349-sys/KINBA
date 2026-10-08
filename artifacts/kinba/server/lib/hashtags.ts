/**
 * JHILIK Phase 2B — Canonical Hashtag Parser
 *
 * Single source of truth for hashtag extraction, normalization, and deduplication.
 * Used by all content mutation paths (videos, comments, announcements, hype rooms, drops).
 *
 * Rules (matching legacy client parser /#[\p{L}\p{N}_-]+/gu):
 * - Hashtag must begin with a Unicode letter or number after "#"
 * - Unicode letters/numbers supported (\p{L}, \p{N})
 * - Underscore and hyphen supported
 * - Punctuation terminates a tag (not part of the tag)
 * - Malformed tags like "#_hello" are rejected (must start with letter/number)
 * - Duplicate hashtags in the same content are deduplicated (first-seen casing wins)
 * - Normalization uses Unicode NFC
 * - Canonical lookup key = NFC(lowercase(tag))
 * - Display form = first-seen original casing (without the leading "#")
 */

export interface ExtractedHashtag {
  /** Canonical lookup key: NFC-normalized lowercase without "#" */
  normalized: string;
  /** First-seen display form: original casing without "#" */
  display: string;
}

/**
 * Extract and normalize hashtags from text.
 * Returns deduplicated array preserving first-seen display casing.
 */
export function extractHashtags(text: string | null | undefined): ExtractedHashtag[] {
  if (!text) return [];

  // Unicode NFC normalization before parsing
  const normalizedText = text.normalize("NFC");

  // Legacy regex: /#[\p{L}\p{N}_-]+/gu
  // Must start with letter/number after #, then allow letters/numbers/underscore/hyphen
  const matches = normalizedText.match(/#[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];

  const seen = new Map<string, string>(); // normalized -> display (first seen)

  for (const match of matches) {
    const withoutHash = match.slice(1); // remove leading "#"
    const canonical = withoutHash.toLowerCase(); // NFC already applied to text
    if (!seen.has(canonical)) {
      seen.set(canonical, withoutHash);
    }
  }

  return Array.from(seen.entries()).map(([normalized, display]) => ({
    normalized,
    display,
  }));
}

/**
 * Extract just the normalized keys (for internal lookups).
 */
export function extractHashtagKeys(text: string | null | undefined): string[] {
  return extractHashtags(text).map(h => h.normalized);
}

/**
 * Check if a string is a valid hashtag format (without the #).
 * Used for validation if needed.
 */
export function isValidHashtagFormat(tag: string): boolean {
  // Must start with letter/number, then only letters/numbers/underscore/hyphen
  return /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(tag);
}

/**
 * Extract hashtags from video title + description
 */
export function extractVideoHashtags(title: string | null | undefined, description: string | null | undefined) {
  const combined = `${title ?? ""} ${description ?? ""}`.trim();
  return extractHashtags(combined);
}

/**
 * Extract hashtags from a single text field
 */
export function extractTextHashtags(text: string | null | undefined) {
  return extractHashtags(text);
}

/**
 * Extract hashtags from Hype Room title + topic + description
 */
export function extractHypeRoomHashtags(title: string | null | undefined, topic: string | null | undefined, description: string | null | undefined) {
  const combined = `${title ?? ""} ${topic ?? ""} ${description ?? ""}`.trim();
  return extractHashtags(combined);
}

/**
 * Extract hashtags from Drop title + description
 */
export function extractDropHashtags(title: string | null | undefined, description: string | null | undefined) {
  const combined = `${title ?? ""} ${description ?? ""}`.trim();
  return extractHashtags(combined);
}