/**
 * JHILIK — Client-side mention token parser.
 *
 * Pure, React-free helpers shared by the comment composer (inline "@"
 * insertion) and the Hype Room composer (chip flow). Rules mirror the
 * username contract in shared/username.ts:
 * - A mention token starts with "@" at the very start of the text or right
 *   after whitespace (never part of an email address).
 * - The typed query is the full [A-Za-z0-9_]* run immediately before the
 *   caret; the token's word range extends past the caret so edits and picks
 *   never leave residue behind.
 * - Rendered mention segments only linkify @handles that match the
 *   3–64 character username pattern (shorter runs stay plain text).
 */

export interface MentionToken {
  /** Index of the "@" character. */
  start: number;
  /** Exclusive end of the full token word (extends past the caret). */
  end: number;
  /** Text between "@" and the caret — what the user has typed so far. */
  query: string;
}

const WORD_CHAR = /[A-Za-z0-9_]/;

/**
 * Detect an active "@query" token immediately before `cursor`.
 * Returns null when the caret is not inside a mention token.
 */
export function findMentionToken(
  text: string,
  cursor: number
): MentionToken | null {
  if (cursor <= 0 || cursor > text.length) return null;
  let start = cursor;
  while (start > 0 && WORD_CHAR.test(text[start - 1] ?? "")) start--;
  if (start === 0 || text[start - 1] !== "@") return null;
  const atIndex = start - 1;
  const beforeAt = atIndex > 0 ? text[atIndex - 1] : "";
  if (atIndex > 0 && !/\s/.test(beforeAt)) return null;
  let end = cursor;
  while (end < text.length && WORD_CHAR.test(text[end] ?? "")) end++;
  return { start: atIndex, end, query: text.slice(start, cursor) };
}

/**
 * Replace an active token range with `handle` (already "@"-prefixed when
 * the picked user has a username) plus a trailing space so the member can
 * keep typing. `handle` must not contain whitespace.
 */
export function applyMentionPick(
  text: string,
  token: { start: number; end: number },
  handle: string,
  maxLength = Number.POSITIVE_INFINITY
): { text: string; cursor: number } {
  const before = text.slice(0, token.start);
  const after = text.slice(token.end);
  const needsSpace = after.length === 0 || !/^\s/.test(after);
  const insertion = needsSpace ? `${handle} ` : handle;
  const next = `${before}${insertion}${after}`;
  const cursor = before.length + insertion.length;
  return { text: next.slice(0, maxLength), cursor: Math.min(cursor, maxLength) };
}

/**
 * Remove an active token (used when the typed "@query" is converted into a
 * persistent mention chip on the Hype Room surface). Collapses the boundary
 * whitespace the token consumed so "hello @ali" → "hello", not "hello ".
 */
export function removeMentionToken(
  text: string,
  token: { start: number; end: number }
): { text: string; cursor: number } {
  const before = text.slice(0, token.start);
  const after = text.slice(token.end);
  const beforeClean = before.replace(/\s+$/, "");
  const afterClean =
    beforeClean === "" ? after.replace(/^\s+/, "") : after;
  return { text: `${beforeClean}${afterClean}`, cursor: beforeClean.length };
}

export interface MentionSegment {
  type: "text" | "mention";
  content: string;
  /** Only for mention segments: the handle without the leading "@". */
  username?: string;
}

/**
 * Split text into plain-text and @mention segments for linkified rendering.
 * Matches the shared username pattern (3–64 of [A-Za-z0-9_]) and skips
 * email-style occurrences ("foo@bar") where "@" follows a non-space word
 * character. Deliberately avoids lookbehind for WebView compatibility.
 */
export function segmentTextWithMentions(
  text: string | null | undefined
): MentionSegment[] {
  if (!text) return [{ type: "text", content: "" }];
  const regex = /@([A-Za-z0-9_]{3,64})(?![A-Za-z0-9_])/g;
  const segments: MentionSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    const username = match[1] ?? "";
    const prevChar = index > 0 ? text[index - 1] : "";
    if (index > 0 && /[\w@]/.test(prevChar)) continue;
    if (index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, index) });
    }
    segments.push({
      type: "mention",
      content: match[0],
      username,
    });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  if (segments.length === 0) {
    return [{ type: "text", content: text }];
  }
  return segments;
}
