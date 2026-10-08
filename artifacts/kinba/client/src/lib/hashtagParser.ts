/**
 * JHILIK Phase 2B — Client-side Hashtag Parser
 *
 * Mirrors server/lib/hashtags.ts exactly for consistent behavior.
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
 * Replace hashtags in text with clickable link components.
 * Returns an array of React nodes (text strings and link elements).
 * This is a pure helper that doesn't depend on React - the caller
 * is responsible for rendering the links appropriately.
 */
export interface HashtagSegment {
  type: 'text' | 'hashtag';
  content: string;
  normalized?: string; // only for hashtag type
}

export function segmentTextWithHashtags(text: string | null | undefined): HashtagSegment[] {
  if (!text) return [{ type: 'text', content: '' }];

  const normalizedText = text.normalize("NFC");
  const regex = /#[\p{L}\p{N}][\p{L}\p{N}_-]*/gu;
  
  const segments: HashtagSegment[] = [];
  let lastIndex = 0;

  const matches = [...normalizedText.matchAll(regex)];

  for (const match of matches) {
    const index = match.index ?? 0;
    const matchedText = match[0];

    // Add text before the hashtag
    if (index > lastIndex) {
      segments.push({
        type: 'text',
        content: normalizedText.slice(lastIndex, index),
      });
    }

    // Add the hashtag
    const withoutHash = matchedText.slice(1);
    const normalized = withoutHash.toLowerCase();
    
    segments.push({
      type: 'hashtag',
      content: matchedText, // includes the # for display
      normalized,
    });

    lastIndex = index + matchedText.length;
  }

  // Add remaining text
  if (lastIndex < normalizedText.length) {
    segments.push({
      type: 'text',
      content: normalizedText.slice(lastIndex),
    });
  }

  // If no hashtags found, return the whole text as one segment
  if (segments.length === 0) {
    return [{ type: 'text', content: normalizedText }];
  }

  return segments;
}